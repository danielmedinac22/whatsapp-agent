import { eq, and, isNull, gte, lte, sql, like } from "@wa/db";
import {
  dropiOrders,
  getAgentSettings,
  listActiveOperations,
  shopifyOrders,
  type AgentSettings,
  type DropiOrder,
  type Operation,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { listAllOrders, type DropiOrderRow } from "../dropi/orders";
import { deriveDropiState } from "../dropi/normalize";
import { maybeNotifyDropiStatus } from "../dropi/notify";
import {
  belongsToOperation,
  pickShopifyMatch,
  type ShopifyMatch,
} from "../dropi/match-shopify";
import { normalizePhone } from "../lib/match";
import { DROPI_SYNC_QUEUE, getBoss } from "./queue";

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface MatchInput {
  /** La operación cuya logística trajo este pedido. Sin ella no hay cruce. */
  operation: Operation;
  customerPhone: string | null;
  customerName: string | null;
  shopOrderNumber: string | null;
  createdAt: Date | null;
  windowDays: number;
}

async function findShopifyByOrderNumber(
  op: Operation,
  shopOrderNumber: string,
): Promise<{ shopifyOrderRowId: string; contactId: string | null } | null> {
  const [row] = await db
    .select({
      id: shopifyOrders.id,
      contactId: shopifyOrders.contactId,
      currency: shopifyOrders.currency,
    })
    .from(shopifyOrders)
    .where(eq(shopifyOrders.orderId, shopOrderNumber))
    .limit(1);
  if (!row) return null;
  // El número de pedido es único por tienda, no entre tiendas: aunque sea
  // exacto, el pedido tiene que ser de esta operación.
  if (!belongsToOperation(row, op)) {
    logger.warn(
      { shopOrderNumber, operation: op.countryCode },
      "dropi sync: pedido de tienda con número exacto pero de otra operación, descartado",
    );
    return null;
  }
  return { shopifyOrderRowId: row.id, contactId: row.contactId ?? null };
}

async function findShopifyMatch(
  input: MatchInput,
): Promise<ShopifyMatch | null> {
  const op = input.operation;

  // 1. Prefer exact match by Shopify order number when Dropi exposes it.
  if (input.shopOrderNumber) {
    const direct = await findShopifyByOrderNumber(op, input.shopOrderNumber);
    if (direct) {
      return { ...direct, confidence: "high" };
    }
  }

  const phone = normalizePhone(input.customerPhone);
  if (!phone) return null;
  const center = input.createdAt ?? new Date();
  const lo = new Date(center.getTime() - input.windowDays * 86_400_000);
  const hi = new Date(center.getTime() + input.windowDays * 86_400_000);

  // Phones may differ by country-code prefix between Dropi (raw, e.g. "59467118")
  // and Shopify (normalized with code, e.g. "50259467118"). Match by the last 8
  // digits — enough to disambiguate within a small order set.
  const suffix = phone.replace(/\D/g, "").slice(-8);
  if (!suffix) return null;

  const candidates = await db
    .select()
    .from(shopifyOrders)
    .where(
      and(
        like(shopifyOrders.customerPhone, `%${suffix}`),
        gte(shopifyOrders.receivedAt, lo),
        lte(shopifyOrders.receivedAt, hi),
      ),
    );

  // 2. El sufijo de teléfono no distingue países: dos clientes de operaciones
  //    distintas pueden compartir los últimos ocho dígitos. Quién gana lo
  //    decide `pickShopifyMatch`, que recibe la operación y descarta lo ajeno.
  const outcome = pickShopifyMatch({
    operation: op,
    customerName: input.customerName,
    candidates,
  });
  if (outcome.rejected > 0) {
    logger.info(
      {
        operation: op.countryCode,
        rejected: outcome.rejected,
        phoneSuffix: suffix,
      },
      "dropi sync: candidatos de tienda descartados por no ser de esta operación",
    );
  }
  return outcome.match;
}

function parseCreatedAt(s: string | null): Date | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

async function upsertDropiOrder(
  op: Operation,
  row: DropiOrderRow,
  windowDays: number,
) {
  const state = deriveDropiState(row.status, row.raw);
  const phone = normalizePhone(row.customer_phone);
  const createdAt = parseCreatedAt(row.created_at);

  // Por (operación, id de Dropi): el número de pedido es único dentro de una
  // cuenta de Dropi, no entre cuentas.
  const [existing] = await db
    .select()
    .from(dropiOrders)
    .where(
      and(
        eq(dropiOrders.operationId, op.id),
        eq(dropiOrders.dropiOrderId, row.id),
      ),
    )
    .limit(1);

  let match: ShopifyMatch | null = null;
  const needsMatch =
    !existing ||
    (!existing.shopifyOrderRowId && existing.matchConfidence !== "manual");
  if (needsMatch) {
    match = await findShopifyMatch({
      operation: op,
      customerPhone: phone,
      customerName: row.customer_name,
      shopOrderNumber: row.shop_order_number,
      createdAt,
      windowDays,
    });
  }

  const patch: Partial<DropiOrder> = {
    status: state.status,
    rawStatus: row.status,
    lastMovementRaw: state.lastMovement,
    lastMovementAt: state.lastMovementAt,
    rawPayload: row.raw,
    customerPhone: phone,
    customerName: row.customer_name,
    guideNumber: row.guide_number,
    guidePdfPath: row.guide_pdf_path,
    guidePdfFile: row.guide_pdf_file,
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
      operationId: op.id,
      dropiOrderId: row.id,
      ...patch,
    })
    .returning({ id: dropiOrders.id });
  return inserted!.id;
}

export interface DropiSyncResult {
  fetched: number;
  upserted: number;
  matched: number;
  errors: number;
}

/**
 * Corre la sincronización de cada operación activa, una por una. Un fallo en
 * una no puede llevarse por delante a las demás: el total que devuelve es la
 * suma de las que corrieron.
 */
export async function runDropiSync(opts?: {
  windowDays?: number;
  pageSize?: number;
}): Promise<DropiSyncResult> {
  const ops = await listActiveOperations();
  if (ops.length === 0) {
    logger.warn("dropi sync: no hay operaciones activas, nada que sincronizar");
    return { fetched: 0, upserted: 0, matched: 0, errors: 0 };
  }

  const total: DropiSyncResult = {
    fetched: 0,
    upserted: 0,
    matched: 0,
    errors: 0,
  };
  const failures: unknown[] = [];
  for (const op of ops) {
    try {
      // La configuración es la de esta operación. El lote 05 la leyó en ámbito
      // global porque `dropiEnabled` pertenece a la conexión de Dropi y esa
      // conexión todavía no declaraba su operación; desde el ticket 04 sí.
      const s = await getAgentSettings(op);
      if (!s?.dropiEnabled) {
        logger.info(
          { operation: op.countryCode },
          "dropi sync: disabled in agent_settings, skipping",
        );
        continue;
      }
      const r = await runDropiSyncForOperation(op, s, opts);
      total.fetched += r.fetched;
      total.upserted += r.upserted;
      total.matched += r.matched;
      total.errors += r.errors;
    } catch (err) {
      logger.error(
        { err, operation: op.countryCode },
        "dropi sync: la operación falló completa",
      );
      failures.push(err);
      total.errors++;
    }
  }
  // Si ninguna operación pudo correr, esto es un fallo del sync y no un
  // resultado vacío: lo propaga igual que cuando había una sola conexión, para
  // que el job se reintente y el panel muestre el error.
  if (failures.length === ops.length) {
    throw failures[0];
  }
  return total;
}

/**
 * Sincroniza los pedidos de la logística de UNA operación: los trae de su
 * cuenta Dropi, los cruza contra los pedidos de tienda de esa misma operación
 * y notifica lo que corresponda.
 */
export async function runDropiSyncForOperation(
  op: Operation,
  s: AgentSettings,
  opts?: { windowDays?: number; pageSize?: number },
): Promise<DropiSyncResult> {
  const windowDays = opts?.windowDays ?? s.dropiMatchWindowDays ?? 5;

  const until = new Date();
  const from = new Date(until.getTime() - windowDays * 86_400_000);

  let rows: DropiOrderRow[] = [];
  try {
    rows = await listAllOrders(
      op,
      { from: fmtDate(from), until: fmtDate(until) },
      opts?.pageSize ?? 50,
    );
  } catch (err) {
    logger.error(
      { err, operation: op.countryCode },
      "dropi sync: listAllOrders failed",
    );
    throw err;
  }

  let upserted = 0;
  let matched = 0;
  let notified = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const id = await upsertDropiOrder(op, row, windowDays);
      upserted++;
      const [r] = await db
        .select()
        .from(dropiOrders)
        .where(eq(dropiOrders.id, id))
        .limit(1);
      if (!r) continue;
      if (r.shopifyOrderRowId) matched++;
      const n = await maybeNotifyDropiStatus(op, r, s);
      if (n.notified) notified++;
    } catch (err) {
      logger.error(
        { err, dropiOrderId: row.id, operation: op.countryCode },
        "dropi sync: upsert failed",
      );
      errors++;
    }
  }
  logger.info(
    {
      operation: op.countryCode,
      fetched: rows.length,
      upserted,
      matched,
      notified,
      errors,
      windowDays,
    },
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

/**
 * Cada cuánto corre el cron de la sincronización.
 *
 * El cron es **uno solo por proceso** y el intervalo es por operación, así que
 * se toma el menor de los configurados: nadie queda sincronizado más lento de
 * lo que pidió. Con una sola operación es exactamente el valor de antes.
 */
async function syncIntervalMinutes(): Promise<number> {
  const ops = await listActiveOperations();
  const configurados: number[] = [];
  for (const op of ops) {
    const s = await getAgentSettings(op);
    if (s?.dropiSyncIntervalMin) configurados.push(s.dropiSyncIntervalMin);
  }
  return configurados.length > 0 ? Math.min(...configurados) : 15;
}

export async function scheduleDropiSync(): Promise<void> {
  const boss = await getBoss();
  const minutes = await syncIntervalMinutes();
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
