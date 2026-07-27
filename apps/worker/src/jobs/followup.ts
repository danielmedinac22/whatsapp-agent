import { eq, and, gte } from "@wa/db";
import {
  agentSettings,
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
  CONFIRMACION_PEDIDO_TEMPLATE,
  renderTemplateBody,
  sanitizeParam,
} from "../kapso/templates";
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

  await enqueueOutbound({
    to,
    body: renderTemplateBody(CONFIRMACION_PEDIDO_TEMPLATE, params),
    source: "followup",
    sourceRef: order.id,
    dedupKey: `followup:${order.id}`,
    conversationId: conv?.id ?? null,
    template: { name: CONFIRMACION_PEDIDO_TEMPLATE, params },
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
