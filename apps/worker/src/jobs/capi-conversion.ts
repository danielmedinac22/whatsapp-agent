/**
 * La cola que le devuelve la venta a Meta.
 *
 * Cuando Sebastián cierra un pedido que vino de un anuncio, esa conversión
 * tiene que llegarle a Meta para que la pauta que Vorare paga aprenda a quién
 * buscar. Este archivo es el único que dispara ese reporte, y lo hace **lejos
 * de la venta**: un barrido que mira pedidos ya cerrados y confirmados, no una
 * llamada colgada del cierre.
 *
 * ## Por qué un barrido y no un gancho en el cierre
 *
 * `sales/closing.ts` es el orquestador de la venta y llamar desde ahí habría
 * sido lo obvio. Tres razones lo desaconsejan y las tres apuntan al mismo lado:
 *
 * 1. **El ticket pide envío asíncrono.** Un fallo de Meta no puede bloquear ni
 *    demorar la respuesta al cliente que está esperando saber si compró. La
 *    telemetría nunca va delante de la persona.
 * 2. **El orden es parte del criterio**: el evento va después de que el pedido
 *    existe *y* de que el cliente recibió su confirmación. Desde el cierre lo
 *    segundo todavía no pasó — el mensaje recién se está encolando.
 * 3. **El pedido en la tienda es un hecho; el cierre es una intención.** El
 *    barrido lee `shopify_orders`, que solo tiene fila porque la tienda mandó
 *    su webhook confirmando que el pedido existe de verdad.
 *
 * ## Las dos colas y qué hace cada una
 *
 * - **El barrido** (`capi-conversion-sweep`) corre cada cinco minutos, busca
 *   los pedidos que faltan y encola uno por conversión. **No manda nada él
 *   mismo**: un barrido que también hace el trabajo mezcla el ritmo del reloj
 *   con el de los reintentos.
 * - **El envío** (`capi-conversion-send`) reporta una conversión. Reintenta con
 *   espera creciente cuando —y solo cuando— reintentar es seguro.
 *
 * ## Lo que este archivo NO hace, y es a propósito
 *
 * **No escala a un humano.** Ni cuando Meta rechaza, ni cuando se agotan los
 * reintentos. Es criterio explícito del ticket: esto es telemetría, no una
 * venta, y despertar a alguien de madrugada por una conversión no reportada es
 * gastar la única atención que después va a hacer falta para un cierre que no
 * llegó a la tienda. Lo que sí hace es **dejarlo visible**, en el libro y en el
 * estado del reporte.
 */

import {
  and,
  capiConversions,
  contacts,
  conversations,
  eq,
  gte,
  isNotNull,
  outboundMessages,
  shopifyOrders,
  sql,
  type OperationId,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { extractOrderTags } from "../shopify/extract";
import { getKapsoConnection } from "../kapso/connection";
import { listActiveOperations, requireOperationById } from "../operations";
import { operationCapiFacts } from "../capi/purchase-event";
import {
  MAX_EVENT_AGE_MS,
  SALES_ORDER_TAG,
  planConversion,
  type ConversionPlan,
  type ReportableOrder,
} from "../capi/plan";
import {
  capiDispatch,
  offReasonText,
  type CapiDispatchSetting,
} from "../capi/send-mode";
import { sendConversion } from "../capi/send";
import {
  claimConversion,
  ledgerKey,
  markFailed,
  markSent,
  markUnconfirmed,
} from "../capi/conversion-record";
import type { SweepCounts } from "../capi/health";
import { getBoss } from "./queue";
import type { SalesQueueSpec } from "./sales-order";

/**
 * Las colas viven acá y no en `jobs/queue.ts` por el mismo motivo que las de
 * `sales-order.ts`: ese archivo es superficie compartida de la ola y
 * `createQueue` es idempotente, así que crearlas al arrancar este módulo da lo
 * mismo sin obligar a otra rama a resolver un conflicto.
 */
export const CAPI_SWEEP_QUEUE = "capi-conversion-sweep";
export const CAPI_SEND_QUEUE = "capi-conversion-send";
export const CAPI_SEND_DEAD_QUEUE = "capi-conversion-dead";

/**
 * Cinco minutos. El evento no es urgente —Meta acepta hasta siete días de
 * antigüedad— y lo que sí importa es que el pedido y su confirmación ya hayan
 * ocurrido, que tarda minutos. Barrer más seguido solo agrega consultas.
 */
const SWEEP_CRON = "*/5 * * * *";

/**
 * Seis intentos con espera creciente desde el minuto. Cubren de sobra un
 * apagón de la Graph API. Más intentos no agregan nada: si Meta lleva horas
 * caída, el problema no es el reintento.
 */
const RETRY_LIMIT = 6;
const RETRY_DELAY_SECONDS = 60;

/** Cuántos pedidos mira un barrido. Techo para que una consulta no se dispare. */
const SWEEP_LIMIT = 200;

/** Lo que viaja en el job de envío: lo mínimo para reconstruirlo todo. */
export interface CapiSendJob {
  operationId: OperationId;
  /** `shopify_orders.order_id`. */
  orderId: string;
}

// ────────────────────────────────────────────────────────────────────────────
// El barrido
// ────────────────────────────────────────────────────────────────────────────

/**
 * Los pedidos de una operación que podrían tener que reportarse.
 *
 * La consulta acota por los tres lados que sirven, y en SQL para no traerse las
 * 1.735 filas de Guatemala:
 *
 * - **Por ventana**: solo lo que Meta todavía aceptaría. Es lo que impide que
 *   encender el interruptor después de un mes apagado dispare un mes de
 *   conversiones atrasadas.
 * - **Por origen**: la etiqueta del vendedor, sobre la carga cruda del webhook.
 *   `raw_payload->>'tags'` sirve para las dos formas en que llegan las
 *   etiquetas —cadena con comas o arreglo—, porque en las dos el texto contiene
 *   la etiqueta. Igual se vuelve a comprobar en `planConversion`, que es donde
 *   está escrita la regla.
 * - **Por atribución**: la conversación tiene identificador de clic. Sin él no
 *   hay conversión que atribuir, y es el caso de las 1.739 conversaciones de
 *   hoy.
 *
 * El `not exists` contra el libro es lo que hace que un pedido ya reportado no
 * vuelva a mirarse — ni siquiera para decidir que no hay que mandarlo.
 */
async function candidateOrders(input: {
  operationId: OperationId;
  ledgerPrefix: string;
  now: Date;
}): Promise<Array<ReportableOrder & { conversationId: string | null }>> {
  const desde = new Date(input.now.getTime() - MAX_EVENT_AGE_MS);

  const rows = await db
    .select({
      orderId: shopifyOrders.orderId,
      totalPrice: shopifyOrders.totalPrice,
      receivedAt: shopifyOrders.receivedAt,
      rawPayload: shopifyOrders.rawPayload,
      ctwaClid: conversations.ctwaClid,
      conversationId: conversations.id,
    })
    .from(shopifyOrders)
    .innerJoin(contacts, eq(contacts.id, shopifyOrders.contactId))
    .innerJoin(conversations, eq(conversations.contactId, contacts.id))
    .where(
      and(
        eq(shopifyOrders.operationId, input.operationId),
        gte(shopifyOrders.receivedAt, desde),
        isNotNull(conversations.ctwaClid),
        sql`${shopifyOrders.rawPayload}->>'tags' like ${`%${SALES_ORDER_TAG}%`}`,
        sql`not exists (select 1 from capi_conversions cc where cc.dedup_key = ${input.ledgerPrefix} || 'purchase:' || ${input.operationId} || ':' || ${shopifyOrders.orderId})`,
      ),
    )
    .limit(SWEEP_LIMIT);

  const enriched = [];
  for (const row of rows) {
    enriched.push({
      orderId: row.orderId,
      totalPrice: row.totalPrice,
      receivedAt: row.receivedAt,
      tags: extractOrderTags(row.rawPayload),
      ctwaClid: row.ctwaClid,
      conversationId: row.conversationId,
      confirmedToCustomerAt: await customerConfirmedAt(
        row.conversationId,
        extractOrderTags(row.rawPayload),
      ),
    });
  }
  return enriched;
}

/**
 * Cuándo salió el mensaje que le dijo al cliente que su pedido quedó
 * registrado, o `null` si todavía no salió.
 *
 * La llave la escribe `sales/closing.ts` como `cierre-creado-{llave}`, y esa
 * llave viaja además **como etiqueta del pedido** (`order-payload.ts` la agrega
 * al final de las etiquetas para poder buscar el pedido en la tienda). Así que
 * el pedido trae consigo con qué encontrar su propio mensaje de confirmación,
 * sin acoplar este módulo al cierre ni pedirle una columna nueva a nadie.
 *
 * Se exige `sent_at` y no la mera existencia de la fila: encolado no es
 * enviado, y el criterio del ticket dice **recibió**.
 */
async function customerConfirmedAt(
  conversationId: string,
  tags: readonly string[],
): Promise<Date | null> {
  const closingKey = tags.find((t) => /^ventas-[0-9a-f]{24}$/i.test(t.trim()));
  if (!closingKey) return null;

  const [row] = await db
    .select({ sentAt: outboundMessages.sentAt })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.conversationId, conversationId),
        eq(outboundMessages.dedupKey, `cierre-creado-${closingKey.trim()}`),
        isNotNull(outboundMessages.sentAt),
      ),
    )
    .limit(1);
  return row?.sentAt ?? null;
}

/**
 * Un pedido concreto, listo para planear. **Sin el filtro del libro**, y esa
 * ausencia es lo importante.
 *
 * El barrido excluye todo pedido que ya tenga fila —incluida una `pending`—
 * porque no debe volver a encolar lo que ya está en curso ni resucitar solo lo
 * que quedó a medias. Pero el **reintento** de la cola necesita exactamente lo
 * contrario: su fila ya existe, la escribió su propio primer intento, y filtrar
 * por ella dejaría todo fallo temporal convertido en una conversión perdida
 * para siempre — el reintento no encontraría nada que hacer, el job se
 * completaría contento, y la fila se quedaría en `pending` sin que nadie
 * volviera a mirarla.
 *
 * Se descubrió ensayando el camino entero contra una base desechable, no
 * leyéndolo: el tipado y los tests de funciones puras no podían verlo porque el
 * error estaba en **qué filas llegaban**, no en qué se decidía con ellas.
 *
 * Así la deduplicación queda donde tiene que estar y en un solo lugar:
 * `claimConversion`, que sabe distinguir «mi propia fila en curso» de «esto ya
 * se decidió».
 */
async function loadOrderForReport(input: {
  operationId: OperationId;
  orderId: string;
}): Promise<(ReportableOrder & { conversationId: string | null }) | null> {
  const [row] = await db
    .select({
      orderId: shopifyOrders.orderId,
      totalPrice: shopifyOrders.totalPrice,
      receivedAt: shopifyOrders.receivedAt,
      rawPayload: shopifyOrders.rawPayload,
      ctwaClid: conversations.ctwaClid,
      conversationId: conversations.id,
    })
    .from(shopifyOrders)
    .innerJoin(contacts, eq(contacts.id, shopifyOrders.contactId))
    .innerJoin(conversations, eq(conversations.contactId, contacts.id))
    .where(
      and(
        eq(shopifyOrders.operationId, input.operationId),
        eq(shopifyOrders.orderId, input.orderId),
      ),
    )
    .limit(1);
  if (!row) return null;

  const tags = extractOrderTags(row.rawPayload);
  return {
    orderId: row.orderId,
    totalPrice: row.totalPrice,
    receivedAt: row.receivedAt,
    tags,
    ctwaClid: row.ctwaClid,
    conversationId: row.conversationId,
    confirmedToCustomerAt: await customerConfirmedAt(row.conversationId, tags),
  };
}

/**
 * Lo que la consulta de candidatos deja fuera **antes** de que nadie decida.
 *
 * Hay que contarlo aparte y no es ceremonia. El barrido acota en SQL por
 * etiqueta y por identificador de clic para no traerse los 1.735 pedidos de
 * Guatemala cada cinco minutos — y el efecto secundario es que esos pedidos
 * **no llegan a `planConversion`**, así que no aparecerían en ningún conteo.
 * El estado del reporte diría «no hubo pedidos en el período» sobre una
 * operación que factura 470 al mes.
 *
 * Eso es exactamente el hallazgo registrado del proyecto —«el estado vacío
 * aprueba por la razón equivocada»— pero al revés y peor: una pantalla que
 * miente sobre lo que miró. Dos `count(*)` indexados cuestan nada y son la
 * diferencia entre «no había nada que reportar» y «no miré».
 */
async function excludedByQuery(input: {
  operationId: OperationId;
  now: Date;
}): Promise<{ notSalesOrder: number; noClickId: number }> {
  const desde = new Date(input.now.getTime() - MAX_EVENT_AGE_MS);
  const esDeVentas = sql`${shopifyOrders.rawPayload}->>'tags' like ${`%${SALES_ORDER_TAG}%`}`;

  const [row] = await db
    .select({
      pedidos: sql<number>`count(*)::int`,
      deVentas: sql<number>`count(*) filter (where ${esDeVentas})::int`,
      conClic: sql<number>`count(*) filter (where ${esDeVentas} and ${conversations.ctwaClid} is not null)::int`,
    })
    .from(shopifyOrders)
    .leftJoin(contacts, eq(contacts.id, shopifyOrders.contactId))
    .leftJoin(conversations, eq(conversations.contactId, contacts.id))
    .where(
      and(
        eq(shopifyOrders.operationId, input.operationId),
        gte(shopifyOrders.receivedAt, desde),
      ),
    );

  const pedidos = row?.pedidos ?? 0;
  const deVentas = row?.deVentas ?? 0;
  const conClic = row?.conClic ?? 0;
  // Los dos son disjuntos entre sí y con lo que cuenta `planConversion`, que
  // solo ve pedidos de ventas con clic y sin fila en el libro. Sumarlos no
  // cuenta nada dos veces.
  return {
    notSalesOrder: Math.max(0, pedidos - deVentas),
    noClickId: Math.max(0, deVentas - conClic),
  };
}

/** Cuenta los planes por su forma, para el log y para el estado del reporte. */
function tallyPlans(plans: readonly ConversionPlan[]): SweepCounts {
  const counts: SweepCounts = { report: 0, wait: {}, skip: {} };
  for (const plan of plans) {
    if (plan.kind === "report") counts.report += 1;
    else if (plan.kind === "wait") {
      counts.wait[plan.reason] = (counts.wait[plan.reason] ?? 0) + 1;
    } else {
      counts.skip[plan.reason] = (counts.skip[plan.reason] ?? 0) + 1;
    }
  }
  return counts;
}

/** Un pedido que hay que reportar, con de dónde salió su clic. */
export interface ReportableEntry {
  orderId: string;
  conversationId: string | null;
  plan: Extract<ConversionPlan, { kind: "report" }>;
}

/**
 * Qué le toca a cada pedido candidato de una operación. **Solo decide: no
 * manda ni escribe.**
 *
 * Lo usan los dos lados —el barrido para encolar, y el estado del reporte para
 * contestar «¿está funcionando?»— y por eso no tiene efectos. Que el tablero y
 * el trabajo salgan de la misma función es lo que impide que el tablero diga
 * una cosa mientras el worker hace otra.
 */
export async function planOperationConversions(input: {
  operationId: OperationId;
  setting: CapiDispatchSetting;
  now: Date;
}): Promise<{
  counts: SweepCounts;
  reportable: Array<ReportableEntry>;
}> {
  const operation = await requireOperationById(input.operationId);
  const connection = await getKapsoConnection(operation);
  const facts = operationCapiFacts(operation, connection);

  // Con el interruptor apagado no hay modo con el que armar la llave del libro,
  // y tampoco hace falta: se mira igual para poder contar, con el prefijo del
  // envío real, que es el que le interesa a quien pregunta si esto funciona.
  const prefix = input.setting.mode === "test" ? "test:" : "";

  const orders = await candidateOrders({
    operationId: input.operationId,
    ledgerPrefix: prefix,
    now: input.now,
  });

  const plans: ConversionPlan[] = [];
  const reportable: ReportableEntry[] = [];
  for (const order of orders) {
    const plan = planConversion({ order, operation: facts, now: input.now });
    plans.push(plan);
    if (plan.kind === "report") {
      reportable.push({
        orderId: order.orderId,
        conversationId: order.conversationId,
        plan,
      });
    }
  }

  const counts = tallyPlans(plans);
  const fuera = await excludedByQuery({
    operationId: input.operationId,
    now: input.now,
  });
  if (fuera.notSalesOrder > 0) {
    counts.skip["not-a-sales-order"] =
      (counts.skip["not-a-sales-order"] ?? 0) + fuera.notSalesOrder;
  }
  if (fuera.noClickId > 0) {
    counts.skip["no-click-id"] =
      (counts.skip["no-click-id"] ?? 0) + fuera.noClickId;
  }

  return { counts, reportable };
}

/**
 * Un barrido.
 *
 * **Con el interruptor apagado mira igual y no encola nada.** Mirar cuesta una
 * consulta indexada y es lo que hace que el estado del reporte pueda decir
 * cuántas ventas están esperando en vez de un cero mudo; encolar sería empezar
 * a trabajar sin permiso. La línea de log con el motivo es lo que aparece en
 * los registros del worker el día que alguien pregunte por qué no llega nada.
 */
export async function runCapiSweep(now: Date = new Date()): Promise<void> {
  const setting = capiDispatch();

  for (const op of await listActiveOperations()) {
    try {
      const { counts, reportable } = await planOperationConversions({
        operationId: op.id,
        setting,
        now,
      });

      if (setting.mode === "off") {
        // Solo se dice algo cuando había algo que decir: un log cada cinco
        // minutos diciendo «cero y apagado» es ruido que entierra el día que sí
        // importa.
        if (counts.report > 0 || Object.keys(counts.wait).length > 0) {
          logger.warn(
            { operacion: op.countryCode, counts, motivo: offReasonText(setting.reason) },
            "capi: hay ventas sin reportar y el reporte está apagado",
          );
        }
        continue;
      }

      for (const { orderId } of reportable) {
        await enqueueCapiSend({ operationId: op.id, orderId });
      }

      if (reportable.length > 0 || Object.keys(counts.wait).length > 0) {
        logger.info(
          { operacion: op.countryCode, modo: setting.mode, counts },
          "capi: barrido de conversiones",
        );
      }
    } catch (err) {
      // Un fallo en una operación no puede impedir el barrido de las demás,
      // igual que en la siembra de plantillas del arranque.
      logger.error(
        { err, operacion: op.countryCode },
        "capi: falló el barrido de una operación",
      );
    }
  }
}

/**
 * Encola el reporte de una conversión.
 *
 * `singletonKey` evita que dos barridos seguidos dejen dos jobs del mismo
 * pedido compitiendo. **No es la deduplicación** —esa es el libro, que dura más
 * que la retención de una cola—: es solo higiene de cola.
 */
async function enqueueCapiSend(job: CapiSendJob): Promise<void> {
  const boss = await getBoss();
  await ensureQueues();
  await boss.send(CAPI_SEND_QUEUE, job as unknown as object, {
    singletonKey: `${job.operationId}:${job.orderId}`,
    retryLimit: RETRY_LIMIT,
    retryDelay: RETRY_DELAY_SECONDS,
    retryBackoff: true,
    deadLetter: CAPI_SEND_DEAD_QUEUE,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// El envío
// ────────────────────────────────────────────────────────────────────────────

/**
 * Reporta una conversión, o decide que no hay que reportarla.
 *
 * **Lanza solo cuando reintentar es seguro.** Es cómo se le dice a pg-boss que
 * lo vuelva a intentar, y no lanzar es cómo se le dice que pare. Las tres
 * salidas de `capi/failure.ts` se traducen así, y la del medio es la que este
 * diseño existe para poder tener:
 *
 * - `retry` → se lanza. La petición no salió, o Meta contestó «no lo tomé».
 * - `stop` → no se lanza. Meta lo rechazó por algo que el tiempo no cura.
 * - `unconfirmed` → **no se lanza**. La petición salió y no hubo respuesta:
 *   puede haber llegado, y reintentar es cómo se fabrica la conversión
 *   duplicada que no se puede deshacer.
 *
 * El plan se **vuelve a calcular** en cada intento en vez de viajar dentro del
 * job. Un payload congelado se pelearía con un dataset que alguien acaba de
 * configurar entre el fallo y el reintento — y peor, seguiría apuntando al
 * destino viejo.
 */
export async function reportConversion(job: CapiSendJob): Promise<void> {
  const setting = capiDispatch();
  if (setting.mode === "off") {
    logger.info(
      { orderId: job.orderId, motivo: offReasonText(setting.reason) },
      "capi: el envío quedó sin efecto porque el reporte está apagado",
    );
    return;
  }

  const order = await loadOrderForReport({
    operationId: job.operationId,
    orderId: job.orderId,
  });
  if (!order) {
    logger.warn({ orderId: job.orderId }, "capi: el pedido ya no está");
    return;
  }

  const operation = await requireOperationById(job.operationId);
  const connection = await getKapsoConnection(operation);
  const plan = planConversion({
    order,
    operation: operationCapiFacts(operation, connection),
    now: new Date(),
  });

  if (plan.kind !== "report") {
    // Dejó de ser reportable entre el barrido y ahora, o nunca lo fue: le falta
    // la confirmación al cliente, o le falta configuración a la operación. Se
    // deja para el próximo barrido en vez de mandarlo a medias.
    logger.info(
      { orderId: job.orderId, plan: plan.kind, motivo: plan.reason },
      "capi: el pedido no está para reportar todavía",
    );
    return;
  }

  const key = ledgerKey(setting.mode, plan.deduplicationKey);

  const claim = await claimConversion({
    operationId: job.operationId,
    ledgerKey: key,
    orderId: job.orderId,
    conversationId: order.conversationId,
    datasetId: plan.datasetId,
    mode: setting.mode,
    value: plan.event.custom_data.value,
    currency: plan.event.custom_data.currency,
    eventTimeUnix: plan.event.event_time,
  });

  if (claim.kind === "already") {
    logger.info(
      { orderId: job.orderId, estado: claim.status, llave: key },
      "capi: esta conversión ya tiene desenlace — no se manda otra vez",
    );
    return;
  }

  const outcome = await sendConversion(
    { datasetId: plan.datasetId, event: plan.event, orderId: job.orderId },
    setting,
  );

  switch (outcome.kind) {
    case "sent":
      await markSent(claim.id);
      return;

    case "off":
      // Inalcanzable: el modo se leyó una vez arriba. Se atiende igual para no
      // dejar la fila en `pending` si algún día deja de serlo.
      await markFailed(claim.id, offReasonText(outcome.reason));
      return;

    case "failed": {
      const { disposition, reason } = outcome.failure;
      if (disposition === "unconfirmed") {
        await markUnconfirmed(claim.id, reason);
        logger.error(
          { orderId: job.orderId, operacion: operation.countryCode, reason },
          "capi: conversión en duda — no se reintenta para no contarla dos veces",
        );
        return;
      }
      if (disposition === "stop") {
        await markFailed(claim.id, reason);
        logger.error(
          { orderId: job.orderId, operacion: operation.countryCode, reason },
          "capi: Meta rechazó la conversión de forma permanente",
        );
        return;
      }
      // `retry`: la fila queda en `pending` y pg-boss vuelve a intentar.
      throw new Error(reason);
    }
  }
}

/**
 * Una conversión agotó sus reintentos.
 *
 * Se registra y se sigue. **No escala a una persona**: es criterio del ticket y
 * es la diferencia con un cierre que no llegó a la tienda, donde sí hay un
 * cliente esperando. Acá lo que se perdió es una señal de atribución.
 */
export async function announceDeadConversion(job: CapiSendJob): Promise<void> {
  const setting = capiDispatch();
  if (setting.mode === "off") return;
  const key = ledgerKey(
    setting.mode,
    `purchase:${job.operationId}:${job.orderId}`,
  );
  const [row] = await db
    .select({ id: capiConversions.id })
    .from(capiConversions)
    .where(eq(capiConversions.dedupKey, key))
    .limit(1);
  if (row) {
    await markFailed(row.id, "agotó los reintentos sin que Meta la aceptara");
  }
  logger.error(
    { orderId: job.orderId, llave: key },
    "capi: la conversión agotó sus reintentos y no se reportó",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Arranque
// ────────────────────────────────────────────────────────────────────────────

/**
 * Las colas del reporte, **en el orden en que hay que crearlas**.
 *
 * El orden no es preferencia: `pg-boss` guarda la cola de descarte como clave
 * foránea, así que **una cola no se puede crear apuntando a otra que todavía no
 * existe**. Crear primero la de envío falla con `queue_dead_letter_fkey` y deja
 * al worker sin ninguna de las tres.
 *
 * Esto no se dedujo: le pasó de verdad a la cola de cierres en su primer
 * despliegue, y lo peor no fue el error sino que el arranque lo atrapaba y
 * seguía — la cola simplemente no existía. Acá el efecto sería que ninguna
 * conversión se reporta nunca **y el estado del reporte diría que todo está
 * bien**, porque no habría fallas que contar. Por eso el orden vive como una
 * lista y `queuesDeclaredBeforeTheirDeadLetter` lo fija con un test.
 */
export const CAPI_QUEUE_SPECS: readonly SalesQueueSpec[] = [
  {
    // Primero la de descarte: es la que la otra referencia.
    name: CAPI_SEND_DEAD_QUEUE,
    // Un mes, como los cierres muertos. Una conversión que no se reportó es
    // una señal perdida, y borrarla a los catorce días es perder también el
    // rastro de que se perdió.
    retentionDays: 30,
  },
  {
    name: CAPI_SEND_QUEUE,
    deadLetter: CAPI_SEND_DEAD_QUEUE,
    retryLimit: RETRY_LIMIT,
    retryDelay: RETRY_DELAY_SECONDS,
    retryBackoff: true,
  },
  // El barrido no descarta en ninguna: si un barrido falla, el siguiente vuelve
  // a mirar lo mismo cinco minutos después.
  { name: CAPI_SWEEP_QUEUE },
];

let queuesReady: Promise<void> | null = null;

/**
 * `createQueue` es idempotente; esto solo evita repetirlo en cada encolado.
 *
 * Un fallo **borra la promesa memorizada**, para que el siguiente intento
 * vuelva a probar en vez de quedarse con el error para siempre.
 */
async function ensureQueues(): Promise<void> {
  if (!queuesReady) {
    queuesReady = (async () => {
      const boss = await getBoss();
      // En el orden declarado, que es el que la base acepta.
      for (const spec of CAPI_QUEUE_SPECS) {
        await boss.createQueue(spec.name, { ...spec });
      }
    })().catch((err) => {
      queuesReady = null;
      throw err;
    });
  }
  return queuesReady;
}

export async function startCapiConversionWorker(): Promise<void> {
  const boss = await getBoss();
  await ensureQueues();

  const sweepId = await boss.work(CAPI_SWEEP_QUEUE, async () => {
    await runCapiSweep();
  });

  const sendId = await boss.work<CapiSendJob>(CAPI_SEND_QUEUE, async (raw) => {
    const list = (Array.isArray(raw) ? raw : [raw]) as Array<{
      data?: CapiSendJob;
    }>;
    for (const job of list) {
      await reportConversion((job?.data ?? job) as CapiSendJob);
    }
  });

  const deadId = await boss.work<CapiSendJob>(
    CAPI_SEND_DEAD_QUEUE,
    async (raw) => {
      const list = (Array.isArray(raw) ? raw : [raw]) as Array<{
        data?: CapiSendJob;
      }>;
      for (const job of list) {
        await announceDeadConversion((job?.data ?? job) as CapiSendJob).catch(
          (err) => logger.error({ err }, "capi: no se pudo registrar la muerta"),
        );
      }
    },
  );

  logger.info(
    { sweepId, sendId, deadId },
    "capi conversion worker started (reporte de conversiones a Meta)",
  );
}

export async function scheduleCapiSweep(): Promise<void> {
  const boss = await getBoss();
  await ensureQueues();
  await boss.schedule(CAPI_SWEEP_QUEUE, SWEEP_CRON, {});
  logger.info({ cron: SWEEP_CRON }, "capi conversion sweep scheduled");
}
