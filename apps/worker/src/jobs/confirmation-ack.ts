import { and, desc, eq, isNull } from "@wa/db";
import {
  agentSettings,
  contacts,
  shopifyOrders,
  templates,
  type Contact,
  type Conversation,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { renderTemplate } from "../lib/template";
import { extractOrderVariables } from "../shopify/extract";
import { enqueueOutbound } from "./outbound";

interface Input {
  contact: Contact;
  conversation: Conversation;
}

/**
 * Cuando el cliente envía un mensaje y existe un pedido pendiente
 * (status != confirmed) para su contacto, marcamos el pedido como
 * confirmado y enviamos el acuse "pedido agendado".
 *
 * Los workers de followup/remarketing tienen guard sobre `confirmedAt`,
 * así que se auto-skipean cuando corren después.
 *
 * Devuelve true si disparó el flujo (para que el caller pueda decidir si
 * el agente LLM aún debe responder ese mismo mensaje).
 */
export async function handleInboundConfirmation({
  contact,
  conversation,
}: Input): Promise<boolean> {
  const [order] = await db
    .select()
    .from(shopifyOrders)
    .where(
      and(eq(shopifyOrders.contactId, contact.id), isNull(shopifyOrders.confirmedAt)),
    )
    .orderBy(desc(shopifyOrders.receivedAt))
    .limit(1);

  if (!order) return false;

  await db
    .update(shopifyOrders)
    .set({ status: "confirmed", confirmedAt: new Date() })
    .where(eq(shopifyOrders.id, order.id));

  const [s] = await db
    .select()
    .from(agentSettings)
    .where(eq(agentSettings.id, 1))
    .limit(1);

  if (s?.activateAgentOnConfirm && !contact.agentMode) {
    await db
      .update(contacts)
      .set({ agentMode: true })
      .where(eq(contacts.id, contact.id));
  }

  if (!s?.confirmationAckTemplateId) {
    logger.info(
      { orderId: order.id },
      "confirmation-ack: order confirmed but no ack template configured",
    );
    return true;
  }

  const [tpl] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, s.confirmationAckTemplateId))
    .limit(1);
  if (!tpl) {
    logger.warn(
      { orderId: order.id, templateId: s.confirmationAckTemplateId },
      "confirmation-ack: template missing",
    );
    return true;
  }

  const vars = extractOrderVariables(order.rawPayload);
  const text = renderTemplate(tpl.body, {
    ...vars,
    nombre: vars.nombre || order.customerName || contact.name || "",
    total: vars.total || order.totalPrice || "",
    pedido: order.orderId,
  });

  await enqueueOutbound({
    jid: contact.jid,
    body: text,
    source: "confirmation_ack",
    sourceRef: order.id,
    dedupKey: `confirmation_ack:${order.id}`,
    conversationId: conversation.id,
  });

  logger.info(
    { orderId: order.id, contactId: contact.id },
    "confirmation-ack: enqueued",
  );
  return true;
}
