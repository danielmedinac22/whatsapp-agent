import { and, eq, gte } from "@wa/db";
import {
  contacts,
  conversations,
  messages,
  shopifyOrders,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { contactWaId } from "../lib/phone";
import { extractOrderVariables } from "../shopify/extract";
import {
  RECORDATORIO_PEDIDO_TEMPLATE,
  renderTemplateBody,
  sanitizeParam,
} from "../kapso/templates";
import { enqueueOutbound } from "./outbound";
import { REMARKETING_QUEUE, getBoss } from "./queue";

interface RemarketingPayload {
  orderId: string;
}

async function handleRemarketing({ orderId }: RemarketingPayload) {
  const [order] = await db
    .select()
    .from(shopifyOrders)
    .where(eq(shopifyOrders.id, orderId))
    .limit(1);
  if (!order) {
    logger.warn({ orderId }, "remarketing: order not found");
    return;
  }
  if (order.confirmedAt || order.remarketingSentAt) {
    logger.info(
      { orderId },
      "remarketing: already confirmed or sent, skipping",
    );
    return;
  }
  if (!order.contactId) {
    logger.warn({ orderId }, "remarketing: no contact linked");
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

  // Customer answered at any point since order — never remarket; mark confirmed.
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
      logger.info(
        { orderId },
        "remarketing: customer already replied, skipping",
      );
      if (!order.confirmedAt) {
        await db
          .update(shopifyOrders)
          .set({ status: "confirmed", confirmedAt: new Date() })
          .where(eq(shopifyOrders.id, order.id));
      }
      return;
    }
  }

  const to = contactWaId(contact);
  if (!to) {
    logger.warn({ orderId, contactId: contact.id }, "remarketing: contact has no wa_id");
    return;
  }

  // Business-initiated reminder outside the 24h window → Meta template.
  const vars = extractOrderVariables(order.rawPayload);
  const params = [
    sanitizeParam(
      String(vars.nombre || order.customerName || contact.name || "").trim() ||
        "👋",
    ),
    sanitizeParam(`#${order.orderId}`),
  ];

  await enqueueOutbound({
    to,
    body: renderTemplateBody(RECORDATORIO_PEDIDO_TEMPLATE, params),
    source: "remarketing",
    sourceRef: order.id,
    dedupKey: `remarketing:${order.id}`,
    conversationId: conv?.id ?? null,
    template: { name: RECORDATORIO_PEDIDO_TEMPLATE, params },
  });

  await db
    .update(shopifyOrders)
    .set({ remarketingSentAt: new Date() })
    .where(eq(shopifyOrders.id, order.id));

  await db
    .update(contacts)
    .set({ agentMode: true })
    .where(eq(contacts.id, contact.id));

  logger.info({ orderId, contactId: contact.id }, "remarketing enqueued");
}

export async function scheduleRemarketing(orderId: string, delayMs: number) {
  const boss = await getBoss();
  const id = await boss.send(
    REMARKETING_QUEUE,
    { orderId },
    { startAfter: Math.max(1, Math.floor(delayMs / 1000)) },
  );
  return id;
}

export async function startRemarketingWorker() {
  const boss = await getBoss();
  const workerId = await boss.work<RemarketingPayload>(
    REMARKETING_QUEUE,
    async (raw) => {
      const list = (Array.isArray(raw) ? raw : [raw]) as Array<{
        id?: string;
        data?: RemarketingPayload;
      }>;
      logger.info(
        { count: list.length, sample: list[0]?.data ?? list[0] },
        "remarketing worker invoked",
      );
      for (const job of list) {
        const data = (job?.data ?? job) as RemarketingPayload;
        try {
          await handleRemarketing(data);
        } catch (err) {
          logger.error({ err, jobId: job?.id }, "remarketing job failed");
          throw err;
        }
      }
    },
  );
  logger.info({ workerId }, "remarketing worker started");
}
