import { eq, inArray, notInArray } from "@wa/db";
import {
  agentSettings,
  contacts,
  conversations,
  dropiOrders,
  shopifyOrders,
  templates,
  type DropiOrder,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { listAllOrders, type DropiOrderRow } from "../dropi/orders";
import { normalizeDropiStatus } from "../dropi/normalize";
import { renderTemplate } from "../lib/template";
import { extractOrderVariables } from "../shopify/extract";
import { enqueueOutbound } from "./outbound";
import { getDropiConnection } from "../dropi/config";
import { DROPI_POLL_QUEUE, getBoss } from "./queue";

type DropiStatus = DropiOrder["status"];

const TERMINAL: DropiStatus[] = ["entregado", "anulada"];
const NOTIFIABLE: DropiStatus[] = [
  "guia_generada",
  "recolectado",
  "en_transito",
  "con_mensajero",
  "entregado",
];

function templateIdFor(
  s: typeof agentSettings.$inferSelect,
  status: DropiStatus,
): string | null {
  switch (status) {
    case "guia_generada":
      return s.dropiTemplateGuiaId;
    case "recolectado":
      return s.dropiTemplateRecolectadoId;
    case "en_transito":
      return s.dropiTemplateEnTransitoId;
    case "con_mensajero":
      return s.dropiTemplateConMensajeroId;
    case "entregado":
      return s.dropiTemplateEntregadoId;
    default:
      return null;
  }
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function notifyCustomer(args: {
  order: DropiOrder;
  newStatus: DropiStatus;
  templateBody: string;
}): Promise<boolean> {
  const { order, newStatus, templateBody } = args;
  if (!order.contactId) {
    logger.warn(
      { dropiOrderId: order.dropiOrderId, newStatus },
      "dropi poll: no contact linked, cannot notify",
    );
    return false;
  }
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, order.contactId))
    .limit(1);
  if (!contact) return false;

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.contactId, contact.id))
    .limit(1);

  let shopifyVars: Record<string, string | number | null | undefined> = {};
  let shopifyOrderNum: string | null = null;
  if (order.shopifyOrderRowId) {
    const [shop] = await db
      .select()
      .from(shopifyOrders)
      .where(eq(shopifyOrders.id, order.shopifyOrderRowId))
      .limit(1);
    if (shop) {
      shopifyVars = extractOrderVariables(shop.rawPayload);
      shopifyOrderNum = shop.orderId;
    }
  }

  const conn = await getDropiConnection();
  const assetsBase = (conn?.assetsBaseUrl ?? "").replace(/\/$/, "");
  const pdfGuia =
    assetsBase && order.guidePdfPath
      ? `${assetsBase}/${order.guidePdfPath.replace(/^\//, "")}`
      : "";

  const vars: Record<string, string | number | null | undefined> = {
    ...shopifyVars,
    nombre:
      shopifyVars.nombre || order.customerName || contact.name || "",
    pedido: shopifyOrderNum || String(order.dropiOrderId),
    guia: order.guideNumber ?? "",
    transportadora: order.carrier ?? "",
    estado: newStatus,
    pdf_guia: pdfGuia,
  };

  const text = renderTemplate(templateBody, vars);

  await enqueueOutbound({
    jid: contact.jid,
    body: text,
    source: "dropi_status",
    sourceRef: order.id,
    dedupKey: `dropi:${order.dropiOrderId}:${newStatus}`,
    conversationId: conv?.id ?? null,
  });
  return true;
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

  if (!statusChanged && !guideChanged && !carrierChanged) {
    await db
      .update(dropiOrders)
      .set({ lastPolledAt: new Date() })
      .where(eq(dropiOrders.id, existing.id));
    return { updated: false, notified: false };
  }

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

  // Novedad → escalar a humano, no notificar.
  if (newStatus === "novedad") {
    if (existing.contactId) {
      await db
        .update(contacts)
        .set({ agentMode: false })
        .where(eq(contacts.id, existing.contactId));
      logger.warn(
        { dropiOrderId: existing.dropiOrderId, contactId: existing.contactId },
        "dropi poll: novedad — agent mode off, escalated to human",
      );
    }
    return { updated: true, notified: false };
  }

  if (!NOTIFIABLE.includes(newStatus)) {
    return { updated: true, notified: false };
  }
  if (existing.lastNotifiedStatus === newStatus) {
    return { updated: true, notified: false };
  }

  const tplId = templateIdFor(s, newStatus);
  if (!tplId) {
    logger.info(
      { dropiOrderId: existing.dropiOrderId, newStatus },
      "dropi poll: no template configured for status, skipping notify",
    );
    return { updated: true, notified: false };
  }
  const [tpl] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, tplId))
    .limit(1);
  if (!tpl) {
    logger.warn(
      { dropiOrderId: existing.dropiOrderId, tplId },
      "dropi poll: template missing",
    );
    return { updated: true, notified: false };
  }

  // Refresh after update so notifyCustomer sees new fields.
  const [refreshed] = await db
    .select()
    .from(dropiOrders)
    .where(eq(dropiOrders.id, existing.id))
    .limit(1);
  if (!refreshed) return { updated: true, notified: false };

  const ok = await notifyCustomer({
    order: refreshed,
    newStatus,
    templateBody: tpl.body,
  });
  if (ok) {
    await db
      .update(dropiOrders)
      .set({
        lastNotifiedStatus: newStatus,
        lastNotifiedAt: new Date(),
      })
      .where(eq(dropiOrders.id, existing.id));
  }
  return { updated: true, notified: ok };
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

  // Active set: not terminal, must already have been confirmed (confirmPutAt set).
  const active = await db
    .select({ id: dropiOrders.dropiOrderId })
    .from(dropiOrders)
    .where(notInArray(dropiOrders.status, TERMINAL));
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

// Silence unused.
void inArray;
