/**
 * El primer toque de un pedido: la confirmación de datos.
 *
 * ## Lo que cambió el 18-ago-2026, y lo que expresamente NO cambió
 *
 * Este job lleva 1.732 pedidos y un 88,4% de confirmación. Lo único que se le
 * agregó es **distinguir de dónde viene el pedido antes de decidir**, porque el
 * vendedor estrena un origen para el que las reglas de siempre son falsas.
 *
 * **Un pedido que no viene del vendedor recorre exactamente el camino de
 * antes**: el mismo heurístico de «el cliente ya respondió», la misma plantilla,
 * los mismos parámetros y la misma demora. No es una promesa: la decisión salió
 * a una función pura (`sales/followup-plan.ts`) y hay tests que la ejercen en
 * las cuatro combinaciones de origen y ventana.
 *
 * El heurístico es el riesgo R1 de la no-regresión: si hay un entrante posterior
 * al pedido, este job saltaba la plantilla y marcaba el pedido `confirmed`. Para
 * el pedido web es correcto. **Para el pedido de ventas es falso** —ahí la
 * conversación *es* el origen, el cliente acaba de hablar con el vendedor y
 * siempre habrá un entrante reciente—, y aplicado tal cual dejaría todo pedido
 * de ventas auto-confirmado sin que nadie verifique la dirección. En
 * contraentrega, la dirección sin verificar es la causa número uno de
 * devolución.
 */

import { eq, and, gte } from "@wa/db";
import {
  contacts,
  conversations,
  getAgentSettings,
  messages,
  requireOperationOrSole,
  shopifyOrders,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { contactWaId } from "../lib/phone";
import { extractOrderTags, extractOrderVariables } from "../shopify/extract";
import {
  CONFIRMACION_PEDIDO_TEMPLATE,
  renderTemplateBody,
  sanitizeParam,
} from "../kapso/templates";
import { getServiceWindow } from "../kapso/service-window";
import { decideFollowupAction } from "../sales/followup-plan";
import { salesPurchaseAckMessage } from "../sales/closing-messages";
import { enqueueOutbound } from "./outbound";
import { FOLLOWUP_QUEUE, getBoss } from "./queue";

interface FollowupPayload {
  orderId: string;
}

async function handleFollowup({ orderId }: FollowupPayload) {
  logger.info({ orderId }, "follow-up: handler entered");
  const [order] = await db
    .select()
    .from(shopifyOrders)
    .where(eq(shopifyOrders.id, orderId))
    .limit(1);
  if (!order) {
    logger.warn({ orderId }, "follow-up: order not found");
    return;
  }
  if (order.confirmedAt || order.followupSentAt) {
    logger.info({ orderId }, "follow-up: already handled, skipping");
    return;
  }
  if (!order.contactId) {
    logger.warn({ orderId }, "follow-up: no contact linked");
    return;
  }

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, order.contactId))
    .limit(1);
  if (!contact) return;

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.contactId, contact.id))
    .limit(1);

  // ¿Escribió el cliente después de que llegó el pedido? Es el insumo del
  // heurístico, y sigue siendo la misma consulta de siempre. Lo que cambia es
  // que ahora **no basta** para decidir: hay que saber también de dónde vino el
  // pedido.
  let customerRepliedSinceOrder = false;
  if (conv) {
    const [reply] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conv.id),
          eq(messages.direction, "in"),
          gte(messages.createdAt, order.receivedAt),
        ),
      )
      .limit(1);
    customerRepliedSinceOrder = Boolean(reply);
  }

  // La configuración es la de la operación dueña de esta conversación, y **solo
  // se pide si hay conversación**. Pedirla con `null` caería en «la operación
  // única», que hoy acierta porque hay una sola y mañana lanzaría: un pedido sin
  // conversación es raro pero existe, y no puede empezar a fallar el día que se
  // abra Colombia. Antes tampoco se pedía en ese caso.
  const settings = conv
    ? await getAgentSettings(await requireOperationOrSole(conv.operationId))
    : null;

  // La ventana se mide **ahora**, no cuando llegó el pedido: entre una cosa y
  // la otra pasaron los minutos de la demora, y para un pedido de ventas que se
  // atascó en la cola de reintentos pueden haber pasado más de veinticuatro
  // horas. Medirla al agendar sería decidir el mecanismo con un dato viejo.
  const window = conv ? await getServiceWindow(conv.id) : "unknown";

  const action = decideFollowupAction({
    tags: extractOrderTags(order.rawPayload),
    window,
    directDelayMs: settings?.followupDelayMs ?? 5 * 60_000,
    customerRepliedSinceOrder,
  });

  if (action.kind === "auto_confirm") {
    logger.info({ orderId }, "customer replied — skipping follow-up");
    await db
      .update(shopifyOrders)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(eq(shopifyOrders.id, order.id));
    if (settings?.activateAgentOnConfirm) {
      await db
        .update(contacts)
        .set({ agentMode: true })
        .where(eq(contacts.id, contact.id));
    }
    return;
  }

  const { plan } = action;

  const to = contactWaId(contact);
  if (!to) {
    logger.warn({ orderId, contactId: contact.id }, "follow-up: contact has no wa_id");
    return;
  }

  // Business-initiated first touch (the customer usually hasn't written yet)
  // → Meta pre-approved template, not free text.
  // Orden de confirmacion_datos_cod: nombre, producto, direccion, ciudad,
  // telefono, total (los params no pueden ir vacíos — Meta los rechaza).
  const vars = extractOrderVariables(order.rawPayload);
  const params = [
    sanitizeParam(
      String(vars.nombre || order.customerName || contact.name || "").trim() ||
        "👋",
    ),
    sanitizeParam(vars.producto || "tu pedido"),
    sanitizeParam(vars.direccion || "por confirmar"),
    sanitizeParam(vars.ciudad || "por confirmar"),
    sanitizeParam(vars.telefono || `+${contactWaId(contact) ?? "?"}`),
    sanitizeParam(
      String(vars.total || order.totalPrice || "").trim() || "0",
    ),
  ];

  // Plantilla es el camino de siempre y el de todo pedido que no venga del
  // vendedor. El texto libre solo lo desbloquea el origen de ventas con la
  // ventana abierta — y aun así lleva la plantilla de respaldo, porque un
  // rechazo por ventana cerrada no puede dejar al cliente sin el mensaje.
  const salesFreeText =
    plan.mechanism === "free_text" && plan.content === "sales_purchase_ack";

  await enqueueOutbound({
    to,
    body: salesFreeText
      ? salesPurchaseAckMessage({
          customerFirstName: String(
            vars.nombre || order.customerName || contact.name || "",
          ),
          productSummary: vars.producto || "tu pedido",
          destination:
            [vars.direccion, vars.ciudad].filter(Boolean).join(" — ") ||
            "la dirección que nos diste",
          total: String(vars.total || order.totalPrice || "").trim()
            ? `${vars.total || order.totalPrice}`
            : "el valor acordado",
        })
      : renderTemplateBody(CONFIRMACION_PEDIDO_TEMPLATE, params),
    source: "followup",
    sourceRef: order.id,
    dedupKey: `followup:${order.id}`,
    conversationId: conv?.id ?? null,
    ...(salesFreeText
      ? { fallbackTemplate: { name: plan.template, params } }
      : { template: { name: plan.template, params } }),
  });

  await db
    .update(shopifyOrders)
    .set({
      status: "followup_sent",
      followupSentAt: new Date(),
    })
    .where(eq(shopifyOrders.id, order.id));

  await db
    .update(contacts)
    .set({ agentMode: true })
    .where(eq(contacts.id, contact.id));

  logger.info({ orderId, contactId: contact.id }, "follow-up enqueued");
}

export async function scheduleFollowup(orderId: string, delayMs: number) {
  const boss = await getBoss();
  const id = await boss.send(
    FOLLOWUP_QUEUE,
    { orderId },
    { startAfter: Math.max(1, Math.floor(delayMs / 1000)) },
  );
  return id;
}

export async function startFollowupWorker() {
  const boss = await getBoss();
  const workerId = await boss.work<FollowupPayload>(
    FOLLOWUP_QUEUE,
    async (raw) => {
      const list = (Array.isArray(raw) ? raw : [raw]) as Array<{
        id?: string;
        data?: FollowupPayload;
      }>;
      for (const job of list) {
        const data = (job?.data ?? job) as FollowupPayload;
        try {
          await handleFollowup(data);
        } catch (err) {
          logger.error({ err, jobId: job?.id }, "follow-up job failed");
          throw err;
        }
      }
    },
  );
  logger.info({ workerId }, "follow-up worker started");
}
