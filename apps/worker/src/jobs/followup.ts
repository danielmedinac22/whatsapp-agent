import { eq, and, gte } from "@wa/db";
import {
  agentSettings,
  contacts,
  conversations,
  messages,
  shopifyOrders,
  templates,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { getSocket } from "../baileys/session";
import { renderTemplate } from "../lib/template";
import { extractOrderVariables } from "../shopify/extract";
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

  // Did the customer reply since the order was received?
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
    if (reply) {
      logger.info({ orderId }, "customer replied — skipping follow-up");
      const [s] = await db
        .select()
        .from(agentSettings)
        .where(eq(agentSettings.id, 1))
        .limit(1);
      await db
        .update(shopifyOrders)
        .set({ status: "confirmed", confirmedAt: new Date() })
        .where(eq(shopifyOrders.id, order.id));
      if (s?.activateAgentOnConfirm) {
        await db
          .update(contacts)
          .set({ agentMode: true })
          .where(eq(contacts.id, contact.id));
      }
      return;
    }
  }

  // Send follow-up template
  const [s] = await db
    .select()
    .from(agentSettings)
    .where(eq(agentSettings.id, 1))
    .limit(1);

  if (!s?.followupTemplateId) {
    logger.warn({ orderId }, "no follow-up template configured");
    await db
      .update(shopifyOrders)
      .set({ status: "no_response" })
      .where(eq(shopifyOrders.id, order.id));
    return;
  }
  const [tpl] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, s.followupTemplateId))
    .limit(1);
  if (!tpl) {
    logger.warn({ orderId }, "follow-up template missing");
    return;
  }

  const sock = getSocket();
  if (!sock) {
    logger.error({ orderId }, "no whatsapp socket — cannot send follow-up");
    return;
  }

  const vars = extractOrderVariables(order.rawPayload);
  const text = renderTemplate(tpl.body, {
    ...vars,
    nombre: vars.nombre || order.customerName || contact.name || "",
    total: vars.total || order.totalPrice || "",
    pedido: order.orderId,
  });

  await sock.sendMessage(contact.jid, { text });

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

  logger.info({ orderId, contactId: contact.id }, "follow-up sent");
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
      logger.info(
        { count: list.length, sample: list[0]?.data ?? list[0] },
        "follow-up worker invoked",
      );
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
