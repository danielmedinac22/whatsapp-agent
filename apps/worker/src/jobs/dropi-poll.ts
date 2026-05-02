import { eq, inArray } from "@wa/db";
import { agentSettings, dropiOrders, type DropiOrder } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { listAllOrders, type DropiOrderRow } from "../dropi/orders";
import { normalizeDropiStatus } from "../dropi/normalize";
import { maybeNotifyDropiStatus } from "../dropi/notify";
import { DROPI_POLL_QUEUE, getBoss } from "./queue";

type DropiStatus = DropiOrder["status"];

// Orders in these statuses no longer change — exclude from active set,
// but only AFTER they've been notified at least once. A row that landed
// directly on `entregado` (e.g. backfill) is still picked up so notify fires.
const QUIESCENT: DropiStatus[] = ["entregado", "anulada"];

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function processRow(
  row: DropiOrderRow,
  s: typeof agentSettings.$inferSelect,
): Promise<{ updated: boolean; notified: boolean }> {
  const { status: newStatus } = normalizeDropiStatus(row.status);

  const [existing] = await db
    .select()
    .from(dropiOrders)
    .where(eq(dropiOrders.dropiOrderId, row.id))
    .limit(1);
  if (!existing) return { updated: false, notified: false };

  const statusChanged = existing.status !== newStatus;
  const guideChanged = existing.guideNumber !== row.guide_number;
  const carrierChanged = existing.carrier !== row.carrier;
  const anyChange = statusChanged || guideChanged || carrierChanged;

  if (anyChange) {
    await db
      .update(dropiOrders)
      .set({
        status: newStatus,
        rawStatus: row.status,
        guideNumber: row.guide_number,
        guidePdfPath: row.guide_pdf_path,
        guidePdfFile: row.guide_pdf_file,
        carrier: row.carrier,
        rawPayload: row.raw,
        lastPolledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dropiOrders.id, existing.id));
  } else {
    await db
      .update(dropiOrders)
      .set({ lastPolledAt: new Date() })
      .where(eq(dropiOrders.id, existing.id));
  }

  // Re-read to get current row (status, last_notified_status, etc.) and
  // delegate the notify decision to the shared helper.
  const [refreshed] = await db
    .select()
    .from(dropiOrders)
    .where(eq(dropiOrders.id, existing.id))
    .limit(1);
  if (!refreshed) return { updated: anyChange, notified: false };

  const r = await maybeNotifyDropiStatus(refreshed, s);
  return { updated: anyChange, notified: r.notified };
}

export interface DropiPollResult {
  fetched: number;
  changed: number;
  notified: number;
  errors: number;
}

export async function runDropiPoll(): Promise<DropiPollResult> {
  const [s] = await db
    .select()
    .from(agentSettings)
    .where(eq(agentSettings.id, 1))
    .limit(1);
  if (!s?.dropiEnabled) {
    return { fetched: 0, changed: 0, notified: 0, errors: 0 };
  }

  // Active set: anything not yet quiescent-and-already-notified.
  // i.e. include terminal rows whose terminal status hasn't been notified yet,
  // so a backfilled `entregado` still triggers notify on first poll cycle.
  const all = await db
    .select({
      id: dropiOrders.dropiOrderId,
      status: dropiOrders.status,
      lastNotifiedStatus: dropiOrders.lastNotifiedStatus,
    })
    .from(dropiOrders);
  const active = all.filter(
    (a) =>
      !QUIESCENT.includes(a.status) || a.lastNotifiedStatus !== a.status,
  );
  if (active.length === 0) {
    return { fetched: 0, changed: 0, notified: 0, errors: 0 };
  }

  const windowDays = s.dropiMatchWindowDays ?? 5;
  const until = new Date();
  // Polling looks at a wider window than sync to catch slow-moving orders.
  const from = new Date(until.getTime() - Math.max(windowDays * 2, 14) * 86_400_000);

  let rows: DropiOrderRow[] = [];
  try {
    rows = await listAllOrders({ from: fmtDate(from), until: fmtDate(until) });
  } catch (err) {
    logger.error({ err }, "dropi poll: listAllOrders failed");
    throw err;
  }

  const activeSet = new Set(active.map((a) => a.id));
  const relevant = rows.filter((r) => activeSet.has(r.id));

  let changed = 0;
  let notified = 0;
  let errors = 0;
  for (const row of relevant) {
    try {
      const r = await processRow(row, s);
      if (r.updated) changed++;
      if (r.notified) notified++;
    } catch (err) {
      logger.error({ err, dropiOrderId: row.id }, "dropi poll: row failed");
      errors++;
    }
  }

  logger.info(
    { fetched: rows.length, considered: relevant.length, changed, notified, errors },
    "dropi poll complete",
  );
  return { fetched: rows.length, changed, notified, errors };
}

export async function startDropiPollWorker() {
  const boss = await getBoss();
  await boss.work(DROPI_POLL_QUEUE, async (raw) => {
    const list = (Array.isArray(raw) ? raw : [raw]) as Array<{ id?: string }>;
    for (const job of list) {
      try {
        await runDropiPoll();
      } catch (err) {
        logger.error({ err, jobId: job?.id }, "dropi poll job failed");
        throw err;
      }
    }
  });
  logger.info("dropi poll worker started");
}

export async function scheduleDropiPoll(): Promise<void> {
  const boss = await getBoss();
  const [s] = await db
    .select()
    .from(agentSettings)
    .where(eq(agentSettings.id, 1))
    .limit(1);
  const minutes = s?.dropiPollIntervalMin ?? 10;
  const cron = `*/${Math.max(1, minutes)} * * * *`;
  await boss.schedule(DROPI_POLL_QUEUE, cron, {});
  logger.info({ cron }, "dropi poll scheduled");
}

export async function enqueueDropiPollNow(): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(DROPI_POLL_QUEUE, {});
}

void inArray;
