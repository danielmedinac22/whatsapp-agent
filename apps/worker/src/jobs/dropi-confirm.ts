import { eq, and } from "@wa/db";
import {
  dropiOrders,
  getAgentSettings,
  requireOperationById,
  resolveOperationForContact,
  shopifyOrders,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { confirmOrder } from "../dropi/orders";
import { DropiHttpError } from "../dropi/client";
import { DROPI_CONFIRM_QUEUE, getBoss } from "./queue";

interface DropiConfirmPayload {
  shopifyOrderRowId: string;
}

const RETRY_DELAY_S = 15 * 60;

async function handleDropiConfirm({ shopifyOrderRowId }: DropiConfirmPayload) {
  // El pedido primero, porque de él sale la operación. El lote 05 leía la
  // configuración en ámbito global porque `dropiEnabled` y `dropiDryRun`
  // pertenecen a la conexión de Dropi y esa conexión todavía no decía de qué
  // operación era; desde el ticket 04 sí lo dice, así que la banderita se lee
  // en la operación que va a recibir la confirmación — la misma que se usa dos
  // pasos más abajo para el PUT. No hay dos fuentes de verdad: hay una sola,
  // consultada antes.
  const [shop] = await db
    .select()
    .from(shopifyOrders)
    .where(eq(shopifyOrders.id, shopifyOrderRowId))
    .limit(1);
  if (!shop) {
    logger.warn({ shopifyOrderRowId }, "dropi confirm: shopify order not found");
    return;
  }

  const op = await resolveOperationForContact(shop.contactId);
  const s = await getAgentSettings(op);
  if (!s?.dropiEnabled) {
    logger.info(
      { shopifyOrderRowId, operation: op.countryCode },
      "dropi confirm: disabled, skipping",
    );
    return;
  }

  const [match] = await db
    .select()
    .from(dropiOrders)
    .where(eq(dropiOrders.shopifyOrderRowId, shopifyOrderRowId))
    .limit(1);

  if (!match) {
    logger.info(
      { shopifyOrderRowId, shopOrderId: shop.orderId },
      "dropi confirm: no Dropi mapping yet, will retry after next sync",
    );
    const boss = await getBoss();
    await boss.send(
      DROPI_CONFIRM_QUEUE,
      { shopifyOrderRowId },
      { startAfter: RETRY_DELAY_S },
    );
    return;
  }

  if (match.confirmPutAt) {
    logger.info(
      { dropiOrderId: match.dropiOrderId },
      "dropi confirm: already confirmed, skipping",
    );
    return;
  }

  if (s.dropiDryRun) {
    logger.info(
      { dropiOrderId: match.dropiOrderId, shopOrderId: shop.orderId },
      "dropi confirm: DRY RUN — would PUT status=PENDIENTE",
    );
    await db
      .update(dropiOrders)
      .set({ confirmDryRunAt: new Date(), updatedAt: new Date() })
      .where(eq(dropiOrders.id, match.id));
    return;
  }

  // La confirmación viaja a la logística de la operación del pedido.
  try {
    await confirmOrder(op, match.dropiOrderId);
  } catch (err) {
    if (err instanceof DropiHttpError && err.status >= 400 && err.status < 500) {
      logger.error(
        { err, dropiOrderId: match.dropiOrderId },
        "dropi confirm: 4xx, not retrying",
      );
      throw err;
    }
    logger.warn(
      { err, dropiOrderId: match.dropiOrderId },
      "dropi confirm: transient error, will retry",
    );
    throw err;
  }

  await db
    .update(dropiOrders)
    .set({
      confirmPutAt: new Date(),
      status: "pendiente",
      rawStatus: "PENDIENTE",
      updatedAt: new Date(),
    })
    .where(eq(dropiOrders.id, match.id));

  logger.info(
    { dropiOrderId: match.dropiOrderId, shopOrderId: shop.orderId },
    "dropi confirm: PUT PENDIENTE OK",
  );
}

/**
 * Synchronous confirm by dropi_orders.id (UUID).
 * Used by the manual "Confirmar en Dropi" button in /pedidos.
 * Returns the new status or throws.
 */
export async function confirmDropiOrderById(
  dropiRowId: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: true; dryRun: boolean; alreadyDone: boolean }> {
  const [match] = await db
    .select()
    .from(dropiOrders)
    .where(eq(dropiOrders.id, dropiRowId))
    .limit(1);
  if (!match) throw new Error("Pedido Dropi no encontrado");

  // Por operación, igual que el job de arriba: la fila de logística ya dice de
  // qué operación es, así que la bandera se lee en la suya.
  const op = await requireOperationById(match.operationId);
  const s = await getAgentSettings(op);
  if (!s?.dropiEnabled) {
    throw new Error("Integración Dropi deshabilitada (toggle en /agente)");
  }

  if (match.confirmPutAt) {
    return { ok: true, dryRun: false, alreadyDone: true };
  }

  if (s.dropiDryRun && !opts.force) {
    await db
      .update(dropiOrders)
      .set({ confirmDryRunAt: new Date(), updatedAt: new Date() })
      .where(eq(dropiOrders.id, match.id));
    logger.info(
      { dropiOrderId: match.dropiOrderId },
      "dropi confirm (manual): DRY RUN",
    );
    return { ok: true, dryRun: true, alreadyDone: false };
  }

  try {
    await confirmOrder(op, match.dropiOrderId);
  } catch (err) {
    logger.error(
      { err, dropiOrderId: match.dropiOrderId, operation: op.countryCode },
      "dropi confirm (manual): PUT failed",
    );
    throw err;
  }

  await db
    .update(dropiOrders)
    .set({
      confirmPutAt: new Date(),
      status: "pendiente",
      rawStatus: "PENDIENTE",
      updatedAt: new Date(),
    })
    .where(eq(dropiOrders.id, match.id));

  return { ok: true, dryRun: false, alreadyDone: false };
}

export async function enqueueDropiConfirm(
  shopifyOrderRowId: string,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(
    DROPI_CONFIRM_QUEUE,
    { shopifyOrderRowId },
    { singletonKey: `dropi-confirm:${shopifyOrderRowId}` },
  );
}

export async function startDropiConfirmWorker() {
  const boss = await getBoss();
  await boss.work<DropiConfirmPayload>(DROPI_CONFIRM_QUEUE, async (raw) => {
    const list = (Array.isArray(raw) ? raw : [raw]) as Array<{
      id?: string;
      data?: DropiConfirmPayload;
    }>;
    for (const job of list) {
      const data = (job?.data ?? job) as DropiConfirmPayload;
      try {
        await handleDropiConfirm(data);
      } catch (err) {
        logger.error({ err, jobId: job?.id }, "dropi confirm job failed");
        throw err;
      }
    }
  });
  logger.info("dropi confirm worker started");
}

// Silence unused.
void and;
