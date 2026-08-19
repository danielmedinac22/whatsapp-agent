/**
 * La cola que hace que **una venta cerrada no se pierda en silencio**.
 *
 * Es alcance contractual, no mejor esfuerzo. El motivo está en el ticket: el
 * cliente ya se despidió creyendo que compró, así que un fallo callado es peor
 * que no vender — nadie lo descubre hasta que el cliente escribe molesto, y para
 * entonces la venta ya se pagó en publicidad.
 *
 * ## Por qué la cola es pg-boss y no una tabla
 *
 * Un cierre encolado necesita durar reinicios, reintentar con espera creciente
 * y terminar en algún lado cuando se agota. Eso es exactamente lo que pg-boss ya
 * hace en este repo para el outbox, el seguimiento y el remarketing — y lo hace
 * en **su propio esquema** (`pgboss`), así que no hace falta una tabla nueva ni
 * una migración. El cierre entero viaja en `data` del job: es lo que permite
 * reconstruir el pedido en cada intento en vez de guardar un payload congelado
 * que quedaría desactualizado si el admin cambia el límite de descuento entre
 * el fallo y el reintento.
 *
 * ## Las tres cosas que la hacen no perder ventas
 *
 * 1. **El reintento no duplica.** Cada intento vuelve a pasar por
 *    `createStoreOrder`, que **lee antes de escribir** buscando la llave de
 *    idempotencia del cierre. Un intento que falló después de haber creado el
 *    pedido —el caso feo: la tienda creó y se cayó la respuesta— encuentra el
 *    pedido y devuelve `already_exists`.
 * 2. **Solo se reintenta lo que mejora reintentando.** Un `429` sí; una
 *    variante que no existe, no. Lo decide `shopify/failure.ts`, y un fallo
 *    permanente salta directo a una persona en vez de hacer esperar al cliente
 *    seis rondas para llegar al mismo sitio.
 * 3. **Agotados los reintentos, el caso no desaparece**: cae a la cola de
 *    muertos, queda visible para el equipo con el motivo, y suena una alerta.
 */

import { requireOperationById, type OperationId } from "@wa/db";
import { logger } from "../lib/logger";
import { enqueueOutbound } from "./outbound";
import { ADMIN_ALERTA_TEMPLATE, sanitizeParam } from "../kapso/templates";
import { getDropiConnection } from "../dropi/config";
import { getBoss } from "./queue";
import type { SalesClosing } from "../sales/order";

/**
 * Las colas viven acá y no en `jobs/queue.ts` a propósito: ese archivo es
 * superficie compartida de la ola y `createQueue` es idempotente, así que
 * crearlas al arrancar el worker de este módulo da lo mismo sin obligar a otra
 * rama a resolver un conflicto. Cuando la ola cierre, mudarlas es mecánico.
 */
export const SALES_ORDER_QUEUE = "sales-order-create";

/** A dónde caen los cierres que agotaron sus reintentos. */
export const SALES_ORDER_DEAD_QUEUE = "sales-order-dead";

/**
 * Seis intentos con espera creciente cubren de sobra una caída de la tienda:
 * arrancan al minuto y el último cae varias horas después. Más intentos no
 * agregan nada —si la tienda lleva horas caída, el problema no es el reintento—
 * y sí retrasan el momento en que un humano se entera.
 */
const RETRY_LIMIT = 6;
const RETRY_DELAY_SECONDS = 60;

/**
 * Lo que hace falta para volver a intentar el cierre entero, y nada más.
 *
 * No lleva el pedido ya construido: lleva **el cierre**, y cada intento lo
 * reconstruye contra la configuración vigente. Un payload congelado se pelearía
 * con el límite de descuento que el admin acaba de bajar.
 */
export interface SalesOrderJob {
  operationId: OperationId;
  contactId: string;
  conversationId: string;
  closing: SalesClosing;
  /** Por qué entró a la cola. Es lo que el equipo ve en la lista. */
  reason: string;
}

/**
 * Encola un cierre que no logró crear su pedido.
 *
 * `singletonKey` es la llave de idempotencia del cierre: dos fallos del mismo
 * cierre no producen dos entradas en la cola, que después serían dos intentos
 * simultáneos compitiendo por crear el mismo pedido.
 */
export async function enqueueSalesOrder(
  job: SalesOrderJob,
  idempotencyKey: string,
): Promise<string | null> {
  const boss = await getBoss();
  await ensureQueues();
  const id = await boss.send(SALES_ORDER_QUEUE, job as unknown as object, {
    singletonKey: idempotencyKey,
    retryLimit: RETRY_LIMIT,
    retryDelay: RETRY_DELAY_SECONDS,
    retryBackoff: true,
    deadLetter: SALES_ORDER_DEAD_QUEUE,
  });
  logger.warn(
    {
      jobId: id,
      operationId: job.operationId,
      conversationId: job.conversationId,
      reason: job.reason,
    },
    "cierre encolado: el pedido no se pudo crear en la tienda",
  );
  return id;
}

let queuesReady: Promise<void> | null = null;

/** `createQueue` es idempotente; esto solo evita repetirlo en cada encolado. */
async function ensureQueues(): Promise<void> {
  if (!queuesReady) {
    queuesReady = (async () => {
      const boss = await getBoss();
      await boss.createQueue(SALES_ORDER_QUEUE, {
        name: SALES_ORDER_QUEUE,
        deadLetter: SALES_ORDER_DEAD_QUEUE,
        retryLimit: RETRY_LIMIT,
        retryDelay: RETRY_DELAY_SECONDS,
        retryBackoff: true,
      });
      await boss.createQueue(SALES_ORDER_DEAD_QUEUE, {
        name: SALES_ORDER_DEAD_QUEUE,
        // Los muertos se guardan un mes: son casos que una persona tiene que
        // mirar, y borrarlos a los catorce días por defecto sería perder
        // justamente lo que la cola existe para no perder.
        retentionDays: 30,
      });
    })();
  }
  return queuesReady;
}

/**
 * La alerta al equipo.
 *
 * Va al mismo teléfono de administración al que ya llegan los escalamientos y
 * por el mismo camino —el outbox, con plantilla de respaldo por si la ventana
 * con el admin está cerrada—, porque un segundo canal de alertas es un segundo
 * canal que un día deja de funcionar sin que nadie lo note.
 *
 * `dedupKey` lleva la llave del cierre y el momento: el mismo cierre no suena
 * dos veces por el mismo motivo, pero **sí vuelve a sonar al agotarse**, que es
 * información nueva.
 */
async function alertTeam(input: {
  operationId: OperationId;
  customerLabel: string;
  customerWaId: string | null;
  headline: string;
  detail: string;
  dedupKey: string;
}): Promise<void> {
  try {
    const op = await requireOperationById(input.operationId);
    const conn = await getDropiConnection(op);
    const adminPhone = conn?.adminPhone;
    if (!adminPhone) {
      logger.warn(
        { operationId: input.operationId },
        "cierre: no hay teléfono de administración configurado — no se pudo alertar",
      );
      return;
    }
    const phoneLine = input.customerWaId ? `\n📱 +${input.customerWaId}` : "";
    await enqueueOutbound({
      to: adminPhone.replace(/\D/g, ""),
      body:
        `🚨 *${input.headline}*\n\n` +
        `*${input.customerLabel}*${phoneLine}\n\n_${input.detail}_\n\n` +
        `El cliente ya se despidió creyendo que compró. Revisa la Conexión de la tienda.`,
      source: "escalation",
      dedupKey: input.dedupKey,
      fallbackTemplate: {
        name: ADMIN_ALERTA_TEMPLATE,
        params: [
          sanitizeParam(input.customerLabel),
          sanitizeParam(`${input.headline} — ${input.detail}`),
          sanitizeParam(input.customerWaId ?? "desconocido"),
        ],
      },
    });
  } catch (err) {
    logger.error({ err }, "cierre: no se pudo enviar la alerta al equipo");
  }
}

export interface SalesOrderAlert {
  operationId: OperationId;
  customerLabel: string;
  customerWaId: string | null;
  detail: string;
  idempotencyKey: string;
}

/** Suena cuando un cierre entra a la cola. */
export async function alertClosingQueued(a: SalesOrderAlert): Promise<void> {
  await alertTeam({
    operationId: a.operationId,
    customerLabel: a.customerLabel,
    customerWaId: a.customerWaId,
    headline: "Un cierre no llegó a la tienda",
    detail: `${a.detail}. Quedó en la cola de reintentos.`,
    dedupKey: `cierre-encolado-${a.idempotencyKey}`,
  });
}

/** Suena cuando un cierre agota sus reintentos y queda para una persona. */
export async function alertClosingDead(a: SalesOrderAlert): Promise<void> {
  await alertTeam({
    operationId: a.operationId,
    customerLabel: a.customerLabel,
    customerWaId: a.customerWaId,
    headline: "Un cierre agotó sus reintentos",
    detail: `${a.detail}. Hay que crear el pedido a mano.`,
    dedupKey: `cierre-muerto-${a.idempotencyKey}`,
  });
}

/**
 * El worker de la cola.
 *
 * El reintento **vuelve a pasar por el orquestador entero** en vez de repetir
 * solo la llamada a la tienda: así hereda la comprobación de idempotencia, el
 * modo seco y el clamp del descuento, sin un segundo camino que se
 * desincronice del primero.
 *
 * La importación del orquestador es diferida a propósito: `sales/closing.ts`
 * importa este módulo para encolar, y una importación circular en el arranque
 * del worker deja uno de los dos a medio inicializar.
 */
export async function startSalesOrderWorker(): Promise<void> {
  const boss = await getBoss();
  await ensureQueues();

  const workerId = await boss.work<SalesOrderJob>(
    SALES_ORDER_QUEUE,
    async (raw) => {
      const list = (Array.isArray(raw) ? raw : [raw]) as Array<{
        id?: string;
        data?: SalesOrderJob;
      }>;
      const { retrySalesClosing } = await import("../sales/closing");
      for (const job of list) {
        const data = (job?.data ?? job) as SalesOrderJob;
        // Un `throw` acá es lo que hace que pg-boss reintente; cuando el fallo
        // es permanente el orquestador NO lanza y el job se completa, porque
        // reintentar seis veces algo que no mejora solo retrasa al humano.
        await retrySalesClosing(data);
      }
    },
  );

  const deadWorkerId = await boss.work<SalesOrderJob>(
    SALES_ORDER_DEAD_QUEUE,
    async (raw) => {
      const list = (Array.isArray(raw) ? raw : [raw]) as Array<{
        data?: SalesOrderJob;
      }>;
      const { announceDeadClosing } = await import("../sales/closing");
      for (const job of list) {
        const data = (job?.data ?? job) as SalesOrderJob;
        await announceDeadClosing(data).catch((err) =>
          logger.error({ err }, "cierre muerto: no se pudo avisar"),
        );
      }
    },
  );

  logger.info(
    { workerId, deadWorkerId },
    "sales order worker started (cola de cierres)",
  );
}
