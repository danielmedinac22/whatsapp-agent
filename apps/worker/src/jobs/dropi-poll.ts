import { and, eq, inArray } from "@wa/db";
import {
  dropiOrders,
  getAgentSettings,
  listActiveOperations,
  type AgentSettings,
  type DropiOrder,
  type Operation,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { listAllOrders, type DropiOrderRow } from "../dropi/orders";
import { deriveDropiState } from "../dropi/normalize";
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
  op: Operation,
  row: DropiOrderRow,
  s: AgentSettings,
): Promise<{ updated: boolean; notified: boolean }> {
  const state = deriveDropiState(row.status, row.raw);
  const newStatus = state.status;

  // El id de Dropi es único dentro de una cuenta, no entre cuentas: dos
  // operaciones pueden traer el mismo número. La fila se busca por (operación,
  // id de Dropi), que es el único de la tabla desde la `0021`. Antes de esa
  // columna, lo más cerca que se podía estar era comparar la moneda del pedido
  // de tienda cruzado — y eso dejaba fuera a los pedidos sin cruzar.
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
  if (!existing) return { updated: false, notified: false };

  const statusChanged = existing.status !== newStatus;
  const guideChanged = existing.guideNumber !== row.guide_number;
  const carrierChanged = existing.carrier !== row.carrier;
  const movementChanged = existing.lastMovementRaw !== state.lastMovement;
  const anyChange =
    statusChanged || guideChanged || carrierChanged || movementChanged;

  if (anyChange) {
    await db
      .update(dropiOrders)
      .set({
        status: newStatus,
        rawStatus: row.status,
        lastMovementRaw: state.lastMovement,
        lastMovementAt: state.lastMovementAt,
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

  const r = await maybeNotifyDropiStatus(op, refreshed, s);
  return { updated: anyChange, notified: r.notified };
}

export interface DropiPollResult {
  fetched: number;
  changed: number;
  notified: number;
  errors: number;
}

/**
 * Sondea cada operación activa. Igual que la sincronización: una operación
 * caída no calla a las demás, pero si ninguna pudo correr el fallo se propaga.
 */
export async function runDropiPoll(): Promise<DropiPollResult> {
  const ops = await listActiveOperations();
  if (ops.length === 0) {
    logger.warn("dropi poll: no hay operaciones activas, nada que sondear");
    return { fetched: 0, changed: 0, notified: 0, errors: 0 };
  }

  const total: DropiPollResult = {
    fetched: 0,
    changed: 0,
    notified: 0,
    errors: 0,
  };
  const failures: unknown[] = [];
  for (const op of ops) {
    try {
      // La configuración es la de esta operación: `dropiEnabled` y las
      // plantillas de logística que salgan de aquí son las suyas. El lote 05
      // tuvo que leerlas en ámbito global porque la conexión de Dropi todavía
      // no declaraba su operación; desde el ticket 04 sí lo hace.
      const s = await getAgentSettings(op);
      if (!s?.dropiEnabled) continue;
      const r = await runDropiPollForOperation(op, s);
      total.fetched += r.fetched;
      total.changed += r.changed;
      total.notified += r.notified;
      total.errors += r.errors;
    } catch (err) {
      logger.error(
        { err, operation: op.countryCode },
        "dropi poll: la operación falló completa",
      );
      failures.push(err);
      total.errors++;
    }
  }
  if (failures.length === ops.length) {
    throw failures[0];
  }
  return total;
}

/**
 * Sondea la logística de UNA operación: pregunta por sus pedidos activos a su
 * cuenta Dropi y actualiza lo que cambió.
 */
export async function runDropiPollForOperation(
  op: Operation,
  s: AgentSettings,
): Promise<DropiPollResult> {
  // Active set: anything not yet quiescent-and-already-notified.
  // i.e. include terminal rows whose terminal status hasn't been notified yet,
  // so a backfilled `entregado` still triggers notify on first poll cycle.
  //
  // Acotado a los pedidos de esta operación: desde la `0021`, `dropi_orders`
  // dice de qué operación es cada fila, así que el sondeo de una ya no puede
  // toparse con el pedido guardado de otra que tenga el mismo id de Dropi.
  const all = await db
    .select({
      id: dropiOrders.dropiOrderId,
      status: dropiOrders.status,
      lastNotifiedStatus: dropiOrders.lastNotifiedStatus,
    })
    .from(dropiOrders)
    .where(eq(dropiOrders.operationId, op.id));
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
    rows = await listAllOrders(op, {
      from: fmtDate(from),
      until: fmtDate(until),
    });
  } catch (err) {
    logger.error(
      { err, operation: op.countryCode },
      "dropi poll: listAllOrders failed",
    );
    throw err;
  }

  const activeSet = new Set(active.map((a) => a.id));
  const relevant = rows.filter((r) => activeSet.has(r.id));

  let changed = 0;
  let notified = 0;
  let errors = 0;
  for (const row of relevant) {
    try {
      const r = await processRow(op, row, s);
      if (r.updated) changed++;
      if (r.notified) notified++;
    } catch (err) {
      logger.error(
        { err, dropiOrderId: row.id, operation: op.countryCode },
        "dropi poll: row failed",
      );
      errors++;
    }
  }

  logger.info(
    {
      operation: op.countryCode,
      fetched: rows.length,
      considered: relevant.length,
      changed,
      notified,
      errors,
    },
    "dropi poll complete",
  );
  return { fetched: rows.length, changed, notified, errors };
}

/**
 * Cada cuánto corre el cron del sondeo.
 *
 * El cron es **uno solo por proceso** y el intervalo es por operación, así que
 * se toma el menor de los configurados: nadie queda sondeado más lento de lo
 * que pidió, y el trabajo de cada operación lo acota `runDropiPollForOperation`.
 * Con una sola operación es exactamente el valor que se leía antes.
 */
async function pollIntervalMinutes(): Promise<number> {
  const ops = await listActiveOperations();
  const configurados: number[] = [];
  for (const op of ops) {
    const s = await getAgentSettings(op);
    if (s?.dropiPollIntervalMin) configurados.push(s.dropiPollIntervalMin);
  }
  return configurados.length > 0 ? Math.min(...configurados) : 10;
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
  const minutes = await pollIntervalMinutes();
  const cron = `*/${Math.max(1, minutes)} * * * *`;
  await boss.schedule(DROPI_POLL_QUEUE, cron, {});
  logger.info({ cron }, "dropi poll scheduled");
}

export async function enqueueDropiPollNow(): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(DROPI_POLL_QUEUE, {});
}

void inArray;
