import { and, desc, eq, isNull, or } from "@wa/db";
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
 * Suprime followup/remarketing y envía el ACK al primer mensaje del cliente.
 *
 * Marca shopifyOrders.status = "confirmed" y confirmedAt como señal interna
 * "el cliente respondió, ya no le mandes plantillas automáticas". NO es la
 * misma señal que la etiqueta del Inbox (conversations.confirmationStatus),
 * que se decide por el classifier (apps/worker/src/agent/confirmation-classifier.ts)
 * y refleja una confirmación real del cliente.
 */
export async function handleInboundConfirmation({
  contact,
  conversation,
}: Input): Promise<boolean> {
  // Match by contactId first; fall back to customerPhone so we still close the
  // loop when the order was upserted with a PN-JID contact (e.g. socket down at
  // webhook time) and the inbound message arrives later under the LID contact.
  const matchByContact = eq(shopifyOrders.contactId, contact.id);
  const matchByPhone = contact.phone
    ? eq(shopifyOrders.customerPhone, contact.phone)
    : null;
  const identityMatch = matchByPhone
    ? or(matchByContact, matchByPhone)!
    : matchByContact;

  const [order] = await db
    .select()
    .from(shopifyOrders)
    .where(and(identityMatch, isNull(shopifyOrders.confirmedAt)))
    .orderBy(desc(shopifyOrders.receivedAt))
    .limit(1);

  if (!order) return false;

  // Re-link the order to the current contact when it was previously tied to a
  // different PN/LID identity for the same phone.
  const shouldRelink = order.contactId !== contact.id;
  if (shouldRelink) {
    logger.info(
      {
        orderId: order.id,
        previousContactId: order.contactId,
        contactId: contact.id,
      },
      "confirmation-ack: re-linking order to current contact",
    );
  }

  await db
    .update(shopifyOrders)
    .set({
      status: "confirmed",
      confirmedAt: new Date(),
      ...(shouldRelink ? { contactId: contact.id } : {}),
    })
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
