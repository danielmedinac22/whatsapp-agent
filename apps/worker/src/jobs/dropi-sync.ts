import { eq, and, isNull, gte, lte, sql } from "@wa/db";
import {
  agentSettings,
  contacts,
  dropiOrders,
  shopifyOrders,
  type DropiOrder,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { listAllOrders, type DropiOrderRow } from "../dropi/orders";
import { normalizeDropiStatus } from "../dropi/normalize";
import { nameSimilarity, normalizePhone } from "../lib/match";
import { DROPI_SYNC_QUEUE, getBoss } from "./queue";

const NAME_SIM_THRESHOLD = 0.8;

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface MatchInput {
  customerPhone: string | null;
  customerName: string | null;
  createdAt: Date | null;
  windowDays: number;
}

async function findShopifyMatch(input: MatchInput): Promise<{
  shopifyOrderRowId: string;
  contactId: string | null;
  confidence: "high" | "low";
} | null> {
  const phone = normalizePhone(input.customerPhone);
  if (!phone) return null;
  const center = input.createdAt ?? new Date();
  const lo = new Date(center.getTime() - input.windowDays * 86_400_000);
  const hi = new Date(center.getTime() + input.windowDays * 86_400_000);

  const candidates = await db
    .select()
    .from(shopifyOrders)
    .where(
      and(
        eq(shopifyOrders.customerPhone, phone),
        gte(shopifyOrders.receivedAt, lo),
        lte(shopifyOrders.receivedAt, hi),
      ),
    );

  if (candidates.length === 0) return null;

  if (candidates.length === 1) {
    const c = candidates[0]!;
    const sim = nameSimilarity(input.customerName, c.customerName);
    return {
      shopifyOrderRowId: c.id,
      contactId: c.contactId ?? null,
      confidence: sim >= NAME_SIM_THRESHOLD || !input.customerName ? "high" : "low",
    };
  }

  // Multiple candidates: pick best by name similarity.
  const scored = candidates
    .map((c) => ({
      c,
      sim: nameSimilarity(input.customerName, c.customerName),
    }))
    .sort((a, b) => b.sim - a.sim);
  const best = scored[0]!;
  const second = scored[1];
  const distinct =
    !second || best.sim - second.sim >= 0.15;
  if (best.sim >= NAME_SIM_THRESHOLD && distinct) {
    return {
      shopifyOrderRowId: best.c.id,
      contactId: best.c.contactId ?? null,
      confidence: "high",
    };
  }
  return {
    shopifyOrderRowId: best.c.id,
    contactId: best.c.contactId ?? null,
    confidence: "low",
  };
}

function parseCreatedAt(s: string | null): Date | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

async function upsertDropiOrder(row: DropiOrderRow, windowDays: number) {
  const { status } = normalizeDropiStatus(row.status);
  const phone = normalizePhone(row.customer_phone);
  const createdAt = parseCreatedAt(row.created_at);

  const [existing] = await db
    .select()
    .from(dropiOrders)
    .where(eq(dropiOrders.dropiOrderId, row.id))
    .limit(1);

  let match: Awaited<ReturnType<typeof findShopifyMatch>> = null;
  const needsMatch =
    !existing ||
    (!existing.shopifyOrderRowId && existing.matchConfidence !== "manual");
  if (needsMatch) {
    match = await findShopifyMatch({
      customerPhone: phone,
      customerName: row.customer_name,
      createdAt,
      windowDays,
    });
  }

  const patch: Partial<DropiOrder> = {
    status,
    rawStatus: row.status,
    rawPayload: row.raw,
    customerPhone: phone,
    customerName: row.customer_name,
    guideNumber: row.guide_number,
    carrier: row.carrier,
    updatedAt: new Date(),
  };
  if (match) {
    patch.shopifyOrderRowId = match.shopifyOrderRowId;
    patch.contactId = match.contactId;
    patch.matchConfidence = match.confidence;
  }

  if (existing) {
    await db
      .update(dropiOrders)
      .set(patch)
      .where(eq(dropiOrders.id, existing.id));
    return existing.id;
  }

  const [inserted] = await db
    .insert(dropiOrders)
    .values({
      dropiOrderId: row.id,
      ...patch,
    })
    .returning({ id: dropiOrders.id });
  return inserted!.id;
}

async function getSettings() {
  const [s] = await db
    .select()
    .from(agentSettings)
    .where(eq(agentSettings.id, 1))
    .limit(1);
  return s ?? null;
}

export interface DropiSyncResult {
  fetched: number;
  upserted: number;
  matched: number;
  errors: number;
}

export async function runDropiSync(opts?: {
  windowDays?: number;
  pageSize?: number;
}): Promise<DropiSyncResult> {
  const s = await getSettings();
  if (!s?.dropiEnabled) {
    logger.info("dropi sync: disabled in agent_settings, skipping");
    return { fetched: 0, upserted: 0, matched: 0, errors: 0 };
  }
  const windowDays = opts?.windowDays ?? s.dropiMatchWindowDays ?? 5;

  const until = new Date();
  const from = new Date(until.getTime() - windowDays * 86_400_000);

  let rows: DropiOrderRow[] = [];
  try {
    rows = await listAllOrders(
      { from: fmtDate(from), until: fmtDate(until) },
      opts?.pageSize ?? 50,
    );
  } catch (err) {
    logger.error({ err }, "dropi sync: listAllOrders failed");
    throw err;
  }

  let upserted = 0;
  let matched = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const id = await upsertDropiOrder(row, windowDays);
      upserted++;
      const [r] = await db
        .select({ shopifyOrderRowId: dropiOrders.shopifyOrderRowId })
        .from(dropiOrders)
        .where(eq(dropiOrders.id, id))
        .limit(1);
      if (r?.shopifyOrderRowId) matched++;
    } catch (err) {
      logger.error({ err, dropiOrderId: row.id }, "dropi sync: upsert failed");
      errors++;
    }
  }
  logger.info(
    { fetched: rows.length, upserted, matched, errors, windowDays },
    "dropi sync complete",
  );
  return { fetched: rows.length, upserted, matched, errors };
}

export async function startDropiSyncWorker() {
  const boss = await getBoss();
  // Runs whenever a job is enqueued. Cron handled separately by `scheduleDropiSync`.
  await boss.work(DROPI_SYNC_QUEUE, async (raw) => {
    const list = (Array.isArray(raw) ? raw : [raw]) as Array<{ id?: string }>;
    for (const job of list) {
      try {
        await runDropiSync();
      } catch (err) {
        logger.error({ err, jobId: job?.id }, "dropi sync job failed");
        throw err;
      }
    }
  });
  logger.info("dropi sync worker started");
}

export async function scheduleDropiSync(): Promise<void> {
  const boss = await getBoss();
  const s = await getSettings();
  const minutes = s?.dropiSyncIntervalMin ?? 15;
  // pg-boss schedule: cron-like. */N * * * *
  const cron = `*/${Math.max(1, minutes)} * * * *`;
  await boss.schedule(DROPI_SYNC_QUEUE, cron, {});
  logger.info({ cron }, "dropi sync scheduled");
}

export async function enqueueDropiSyncNow(): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(DROPI_SYNC_QUEUE, {});
}

// Silences unused imports for `isNull`/`sql` if we trim later.
void isNull;
void sql;
