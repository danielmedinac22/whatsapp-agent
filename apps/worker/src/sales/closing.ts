/**
 * El cierre: de una conversación con datos a un pedido en la tienda.
 *
 * Es el único orquestador de este camino y el único punto del sistema que
 * dispara una escritura sobre la tienda del cliente. Todo lo que **decide** vive
 * en funciones puras a su alrededor —el constructor de orden, el mapeo del
 * payload, la clasificación del fallo, la redacción de los mensajes— y acá solo
 * quedan los efectos, en el orden en que tienen que ocurrir.
 *
 * ## Las cuatro reglas que lo gobiernan
 *
 * 1. **Un dato malo se le dice al cliente en el momento**, con qué corregir y
 *    todo junto. Un dato malo *del sistema* —país sin listas, carrito vacío— no
 *    se le dice al cliente: escala, porque él no lo puede arreglar.
 * 2. **Dos disparos del mismo cierre producen un solo pedido.** La llave sale
 *    del lead y de lo que compró, viaja como etiqueta y se comprueba **leyendo
 *    antes de escribir**.
 * 3. **Un descuento fuera de rango no rechaza la venta**: el pedido sale al
 *    precio válido y el caso escala a un asesor. La venta ya se pagó en
 *    publicidad; el margen se protege clampeando, no perdiéndola.
 * 4. **Un fallo no se pierde en silencio.** Va a la cola de reintentos con sus
 *    datos completos y suena una alerta. Si el fallo no mejora reintentando, va
 *    derecho a la bandeja de casos para una persona.
 *
 * ## Lo que hoy pasa de verdad
 *
 * `shopify_connection` tiene **cero filas** en producción y el interruptor de
 * escritura arranca apagado, así que hoy este camino termina en «la tienda no
 * está conectada» — que es un estado con pantalla, no un error. Es a propósito:
 * cuando lleguen las credenciales, la primera escritura la decide una persona
 * encendiendo el interruptor, contra un pedido desechable, y no un despliegue.
 */

import {
  contacts,
  conversations,
  eq,
  requireOperationById,
  requireOperationOrSole,
  type Contact,
  type Conversation,
  type Operation,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { contactWaId } from "../lib/phone";
import { enqueueOutbound } from "../jobs/outbound";
import {
  alertClosingDead,
  alertClosingQueued,
  enqueueSalesOrder,
  SALES_ORDER_DEAD_QUEUE,
  type SalesOrderJob,
} from "../jobs/sales-order";
import { getBoss } from "../jobs/queue";
import { escalateToHuman } from "../agent/escalation";
import { createStoreOrder, type StoreOrderOutcome } from "../shopify/order-create";
import { getSalesAgentSettings } from "./settings";
import {
  buildSalesOrder,
  cartOf,
  salesOrderStore,
  type SalesClosing,
  type SalesOrderDraft,
  type SalesOrderError,
  type SalesOrderResult,
} from "./order";
import {
  closingCorrectionMessage,
  closingErrorAudience,
  funnelHandoffMessage,
  orderRegisteredMessage,
} from "./closing-messages";
import { getShopifyConnection } from "../shopify/admin";

/** Cómo terminó el cierre, desde el punto de vista de quien lo disparó. */
export type CloseSaleResult =
  /** Faltan datos del cliente. `message` es lo que hay que mandarle. */
  | { kind: "invalid"; errors: readonly SalesOrderError[]; message: string }
  /** El cierre es imposible por un problema del sistema. Ya escaló. */
  | { kind: "escalated"; errors: readonly SalesOrderError[] }
  | { kind: "created"; orderName: string; discountClamped: boolean }
  /** Ya existía: segundo disparo del mismo cierre. No se creó nada nuevo. */
  | { kind: "duplicate"; orderName: string }
  /** El interruptor está en seco: no se escribió nada y no se le mintió a nadie. */
  | { kind: "dry_run" }
  /** No se pudo crear. Quedó encolado (o parqueado) y el equipo ya fue avisado. */
  | { kind: "queued"; reason: string; willRetry: boolean };

export interface CloseSaleInput {
  contact: Contact;
  conversation: Conversation;
  closing: SalesClosing;
}

/**
 * El cierre de una venta.
 *
 * Es la puerta que el vendedor usa cuando ya tiene los datos del cliente. Toda
 * la orquestación pasa por acá —también los reintentos de la cola— para que no
 * existan dos caminos que se desincronicen.
 */
export async function closeSale(
  input: CloseSaleInput,
): Promise<CloseSaleResult> {
  const operation = await requireOperationOrSole(input.conversation.operationId);
  return attemptClosing({
    operation,
    contact: input.contact,
    conversation: input.conversation,
    closing: input.closing,
    fromQueue: false,
  });
}

interface Attempt {
  operation: Operation;
  contact: Contact;
  conversation: Conversation;
  closing: SalesClosing;
  /** Un reintento no vuelve a encolar: lo hace pg-boss lanzando. */
  fromQueue: boolean;
}

async function attemptClosing(a: Attempt): Promise<CloseSaleResult> {
  const settings = await getSalesAgentSettings(a.operation.id);
  const connection = await getShopifyConnection(a.operation);
  const store = salesOrderStore(a.operation, connection);

  // Sin tienda no hay pedido, y **no es un error del cliente**: es el estado de
  // hoy. La venta no se descarta — se encola con sus datos completos y el
  // equipo se entera, que es exactamente lo que el ticket 04 pide.
  if (!store) {
    return park(a, {
      reason: connection
        ? "la conexión de la tienda está incompleta"
        : "la tienda no está conectada",
      // Conectar la tienda es trabajo de una persona; reintentar no la conecta.
      // Pero el cierre tiene que sobrevivir a que la conecten mañana, así que
      // se reintenta igual: es el único fallo «permanente» que el tiempo cura.
      willRetry: true,
    });
  }

  const result: SalesOrderResult = buildSalesOrder({
    store,
    closing: a.closing,
    settings: {
      discountLimitPct: settings?.discountLimitPct ?? 0,
      sellerName: settings?.displayName ?? "",
    },
  });

  if (!result.ok) return handleInvalid(a, result.errors);

  const outcome = await createStoreOrder(a.operation, result.order);
  return handleOutcome(a, result.order, result.discount.clamped, outcome);
}

/**
 * Datos que no cuadran.
 *
 * Se parte por a quién le habla el error: lo que el cliente puede corregir se
 * le pregunta, y lo que no —el país sin listas, el carrito vacío— escala. Un
 * cierre con las dos clases de error escala **y** deja de preguntarle al
 * cliente, porque aunque conteste bien seguiría sin poderse crear.
 */
async function handleInvalid(
  a: Attempt,
  errors: readonly SalesOrderError[],
): Promise<CloseSaleResult> {
  const delEquipo = errors.filter((e) => closingErrorAudience(e) === "team");
  if (delEquipo.length > 0) {
    logger.error(
      { conversationId: a.conversation.id, errors: delEquipo },
      "cierre: el pedido no se puede construir por un problema del sistema",
    );
    await escalateToHuman({
      contact: a.contact,
      reason: "sales_out_of_rules",
      detail: `El cierre no se pudo armar: ${delEquipo
        .map((e) => e.code)
        .join(", ")}`,
    });
    return { kind: "escalated", errors };
  }

  const message = closingCorrectionMessage(errors);
  if (!message) {
    // Inalcanzable: sin errores del equipo y sin errores del cliente no habría
    // habido errores. Se comprueba igual para no mandar un mensaje vacío.
    return { kind: "escalated", errors };
  }
  await sendToLead(a, message, `cierre-datos-${shortRef(a, errors)}`);
  return { kind: "invalid", errors, message };
}

async function handleOutcome(
  a: Attempt,
  draft: SalesOrderDraft,
  discountClamped: boolean,
  outcome: StoreOrderOutcome,
): Promise<CloseSaleResult> {
  switch (outcome.kind) {
    case "created":
    case "already_exists": {
      // Los dos mandan el mismo mensaje y el `dedupKey` los une: un segundo
      // disparo del mismo cierre no le escribe dos veces al cliente, igual que
      // no le crea dos pedidos.
      await announceCreated(a, draft, outcome.order.name);
      if (discountClamped) await escalateForDiscount(a, draft);
      return outcome.kind === "created"
        ? { kind: "created", orderName: outcome.order.name, discountClamped }
        : { kind: "duplicate", orderName: outcome.order.name };
    }

    case "dry_run":
      // **No se le dice al cliente que su pedido quedó registrado.** No quedó:
      // el modo seco no escribió nada, y mentirle sería exactamente el fallo
      // silencioso que este ticket existe para evitar, solo que al revés.
      logger.info(
        {
          conversationId: a.conversation.id,
          shopDomain: outcome.shopDomain,
          idempotencyKey: draft.idempotencyKey,
        },
        "cierre en modo seco: no se creó pedido y no se le avisó al cliente",
      );
      return { kind: "dry_run" };

    case "not_connected":
      return park(a, {
        reason: "la tienda no está conectada",
        willRetry: true,
      });

    case "store_mismatch":
      // La tienda cambió entre construir y crear. Reintentar la volvería a
      // encontrar mal: esto lo mira una persona antes de que un pedido salga
      // al país equivocado.
      logger.error(
        {
          conversationId: a.conversation.id,
          expected: outcome.expected,
          found: outcome.found,
        },
        "cierre: la conexión viva ya no es la tienda del pedido",
      );
      return park(a, {
        reason: `la tienda conectada (${outcome.found}) no es la del pedido (${outcome.expected})`,
        willRetry: false,
      });

    case "failed":
      return park(a, {
        reason: outcome.failure.reason,
        willRetry: outcome.failure.disposition === "retry",
      });
  }
}

/**
 * El cliente se entera de que su pedido existe, y de que lo van a contactar.
 *
 * Son dos mensajes y no uno: el primero cierra la compra —con el número de
 * pedido, que es lo único que el cliente tiene en contraentrega— y el segundo
 * es el mensaje de embudo que el admin escribe en el panel. Juntarlos haría que
 * cambiar el texto del embudo obligara a tocar código.
 */
async function announceCreated(
  a: Attempt,
  draft: SalesOrderDraft,
  orderName: string,
): Promise<void> {
  const settings = await getSalesAgentSettings(a.operation.id);
  await sendToLead(
    a,
    orderRegisteredMessage({
      orderName,
      productSummary: describeLines(draft),
      total: draft.totals.total,
      currency: draft.currency,
      destination: describeDestination(draft),
      pickupAtOffice: draft.shipping.kind === "pickup_at_office",
    }),
    `cierre-creado-${draft.idempotencyKey}`,
  );
  await sendToLead(
    a,
    funnelHandoffMessage(settings?.funnelMessage ?? ""),
    `cierre-embudo-${draft.idempotencyKey}`,
  );
}

/**
 * El clamp escaló, y el pedido ya existe.
 *
 * El orden importa: primero se crea y se le avisa al cliente, después escala.
 * Al revés, `escalateToHuman` apaga el agente y el cliente se quedaría sin
 * saber si compró mientras un asesor decide si le honra un descuento.
 */
async function escalateForDiscount(
  a: Attempt,
  draft: SalesOrderDraft,
): Promise<void> {
  await escalateToHuman({
    contact: a.contact,
    reason: "sales_out_of_rules",
    detail: `Se pactó un descuento por encima del límite. El pedido se creó al precio autorizado (${draft.totals.total} ${draft.currency}).`,
  });
}

/**
 * El cierre no llegó a la tienda: se guarda con sus datos completos y suena.
 *
 * `willRetry` decide en cuál de las dos colas queda. Un fallo que el tiempo
 * cura entra a reintentos; uno que no —la tienda rechazó el pedido, la conexión
 * apunta a otra tienda— va derecho a la bandeja de casos para una persona, en
 * vez de hacer esperar al cliente seis rondas para llegar al mismo sitio.
 */
async function park(
  a: Attempt,
  opts: { reason: string; willRetry: boolean },
): Promise<CloseSaleResult> {
  const job: SalesOrderJob = {
    operationId: a.operation.id,
    contactId: a.contact.id,
    conversationId: a.conversation.id,
    closing: a.closing,
    reason: opts.reason,
  };
  const alert = {
    operationId: a.operation.id,
    customerLabel: a.contact.name ?? `+${contactWaId(a.contact) ?? "?"}`,
    customerWaId: contactWaId(a.contact),
    detail: opts.reason,
    idempotencyKey: closingRef(a.closing),
  };

  if (!opts.willRetry) {
    await parkAsDead(job);
    await alertClosingDead(alert);
    return { kind: "queued", reason: opts.reason, willRetry: false };
  }

  if (a.fromQueue) {
    // Ya está en la cola: quien reintenta es pg-boss, y lo hace porque el
    // llamador lanza. Volver a encolar acá crearía una segunda entrada.
    return { kind: "queued", reason: opts.reason, willRetry: true };
  }

  const jobId = await enqueueSalesOrder(job, closingRef(a.closing));
  if (jobId === null) {
    // **La cola no estaba.** Pasó de verdad: el primer despliegue dejó las colas
    // sin crear y nadie se enteró. Si el cierre no quedó encolado no se va a
    // reintentar solo, así que decir «quedó en la cola de reintentos» sería
    // mentirle al equipo sobre lo único que evita perder la venta. Se avisa como
    // lo que es —un caso que necesita una persona— y se dice que no habrá
    // reintento.
    await alertClosingDead(alert);
    return { kind: "queued", reason: opts.reason, willRetry: false };
  }
  await alertClosingQueued(alert);
  return { kind: "queued", reason: opts.reason, willRetry: true };
}

/**
 * Deja el caso en la cola de los que esperan a una persona.
 *
 * **No lanza.** Si la cola no está disponible, lo que no puede fallar es la
 * alerta que viene justo después: el caso perdido con aviso lo rescata alguien,
 * y el caso perdido sin aviso no lo rescata nadie.
 */
async function parkAsDead(job: SalesOrderJob): Promise<void> {
  try {
    const boss = await getBoss();
    await boss.send(SALES_ORDER_DEAD_QUEUE, job as unknown as object, {
      singletonKey: `${job.conversationId}:${job.closing.leadRef}`,
    });
  } catch (err) {
    logger.error(
      { err, conversationId: job.conversationId, reason: job.reason },
      "cierre: no se pudo guardar el caso para una persona; queda solo la alerta",
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Los dos puentes con la cola
// ────────────────────────────────────────────────────────────────────────────

/**
 * Un reintento de la cola.
 *
 * **Lanza cuando el fallo se puede reintentar**, que es cómo se le dice a
 * pg-boss que lo vuelva a intentar con espera creciente; cuando el fallo no
 * mejora reintentando, ya quedó parqueado para una persona y esto **no lanza**,
 * para que el job se cierre en vez de repetir seis veces lo mismo.
 */
export async function retrySalesClosing(job: SalesOrderJob): Promise<void> {
  const operation = await requireOperationById(job.operationId);
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, job.contactId))
    .limit(1);
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, job.conversationId))
    .limit(1);
  if (!contact || !conversation) {
    logger.error({ job }, "reintento de cierre: falta el contacto o la conversación");
    return;
  }

  const result = await attemptClosing({
    operation,
    contact,
    conversation,
    closing: job.closing,
    fromQueue: true,
  });

  if (result.kind === "queued" && result.willRetry) {
    throw new Error(`el cierre sigue sin poder crearse: ${result.reason}`);
  }
  logger.info(
    { conversationId: job.conversationId, outcome: result.kind },
    "reintento de cierre resuelto",
  );
}

/**
 * Un cierre agotó sus reintentos —o llegó derecho por ser un fallo permanente—
 * y queda esperando a una persona.
 *
 * El job **no se borra**: sigue en la cola de muertos con sus datos completos y
 * su motivo, que es lo que hace que «marcado para intervención humana» sea algo
 * que el equipo puede ver y no una frase.
 */
export async function announceDeadClosing(job: SalesOrderJob): Promise<void> {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, job.contactId))
    .limit(1);
  await alertClosingDead({
    operationId: job.operationId,
    customerLabel: contact?.name ?? `+${contact ? contactWaId(contact) : "?"}`,
    customerWaId: contact ? contactWaId(contact) : null,
    detail: job.reason,
    idempotencyKey: `${job.conversationId}:${job.closing.leadRef}`,
  });
  logger.error(
    { conversationId: job.conversationId, reason: job.reason },
    "cierre agotado: espera intervención humana",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Ayudantes
// ────────────────────────────────────────────────────────────────────────────

async function sendToLead(
  a: Attempt,
  body: string,
  dedupKey: string,
): Promise<void> {
  const to = contactWaId(a.contact);
  if (!to) {
    logger.warn(
      { contactId: a.contact.id },
      "cierre: el contacto no tiene wa_id, no se le puede escribir",
    );
    return;
  }
  await enqueueOutbound({
    to,
    body,
    // Habla el vendedor, dentro de la conversación: es el mismo origen con el
    // que Sebastián contesta el resto del tiempo.
    source: "agent",
    sourceRef: a.conversation.id,
    dedupKey,
    conversationId: a.conversation.id,
  }).catch((err) =>
    logger.error({ err, dedupKey }, "cierre: no se pudo encolar el mensaje"),
  );
}

/** «2 × Colágeno Hidrolizado, Serum REVITALHAIR». */
function describeLines(draft: SalesOrderDraft): string {
  return draft.lines
    .map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.title}` : l.title))
    .join(", ");
}

function describeDestination(draft: SalesOrderDraft): string {
  const s = draft.shipping;
  const lugar = `${s.city}, ${s.division}`;
  return s.kind === "delivery" ? `${s.address} — ${lugar}` : lugar;
}

/**
 * Una referencia estable del cierre para deduplicar antes de tener la llave.
 *
 * El carrito lo deriva `cartOf`, que es la **misma** cuenta con la que
 * `sales/order.ts` arma la llave de idempotencia. Estaba escrita dos veces y
 * ahora no: dos derivaciones que se separen dejan una grieta por la que el
 * mismo cierre colisiona en una y no en la otra, y eso se paga con un segundo
 * envío contraentrega.
 */
function closingRef(closing: SalesClosing): string {
  return `${closing.leadRef}:${cartOf(closing.lines)}`;
}

/** Para que dos correcciones distintas no se deduzcan como la misma. */
function shortRef(a: Attempt, errors: readonly SalesOrderError[]): string {
  return `${a.conversation.id}:${errors.map((e) => e.code).sort().join("+")}`;
}
