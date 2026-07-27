import { Hono } from "hono";
import { eq } from "@wa/db";
import { agentSettings, conversations, shopifyOrders } from "@wa/db";
import { shopifyOrderWebhook } from "@wa/shared";
import { db } from "../db";
import { logger } from "../lib/logger";
import { verifyShopifyHmac } from "../shopify/verify";
import { scheduleFollowup } from "../jobs/followup";
import { scheduleRemarketing } from "../jobs/remarketing";
import { normalizePhone } from "../lib/phone";
import { upsertContactByWaId } from "../inbound/contacts";

export const shopify = new Hono();

shopify.post("/webhook", async (c) => {
  const raw = await c.req.text();
  const hmac = c.req.header("x-shopify-hmac-sha256");
  if (!verifyShopifyHmac(raw, hmac ?? null)) {
    logger.warn("shopify webhook: invalid hmac");
    return c.json({ error: "invalid hmac" }, 401);
  }

  const json = JSON.parse(raw);
  const parsed = shopifyOrderWebhook.safeParse(json);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, "shopify webhook: bad shape");
    return c.json({ error: parsed.error.issues }, 400);
  }
  const order = parsed.data;

  const phoneRaw =
    order.customer?.phone ??
    order.phone ??
    order.shipping_address?.phone ??
    null;
  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    logger.warn({ orderId: order.id }, "shopify order has no phone, skipping");
    return c.json({ ok: true, ignored: true });
  }

  const customerName = [order.customer?.first_name, order.customer?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim() || order.shipping_address?.name || null;

  // Cloud API addressing is just the E.164 wa_id — no LID/PN resolution and
  // no dependency on a live socket (the old 503-when-disconnected is gone).
  const contact = await upsertContactByWaId(phone, { name: customerName });

  let [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.contactId, contact.id))
    .limit(1);
  if (!conv) {
    [conv] = await db
      .insert(conversations)
      .values({ contactId: contact.id })
      .returning();
  }

  // Idempotent insert by Shopify order_id
  const existing = await db
    .select()
    .from(shopifyOrders)
    .where(eq(shopifyOrders.orderId, order.id))
    .limit(1);
  if (existing[0]) {
    logger.info({ orderId: order.id }, "shopify order already received");
    return c.json({ ok: true, duplicate: true });
  }

  const [settings] = await db
    .select()
    .from(agentSettings)
    .where(eq(agentSettings.id, 1))
    .limit(1);
  const followupDelay = settings?.followupDelayMs ?? 5 * 60_000;
  const remarketingDelay = settings?.remarketingDelayMs ?? 3 * 60 * 60_000;
  const followupAt = new Date(Date.now() + followupDelay);
  const remarketingAt = new Date(Date.now() + remarketingDelay);

  const [stored] = await db
    .insert(shopifyOrders)
    .values({
      orderId: order.id,
      customerPhone: phone,
      customerName,
      contactId: contact.id,
      totalPrice: order.total_price ?? null,
      currency: order.currency ?? null,
      rawPayload: json,
      status: "followup_scheduled",
      followupScheduledFor: followupAt,
      remarketingScheduledFor: remarketingAt,
    })
    .returning();

  const followupJobId = await scheduleFollowup(stored!.id, followupDelay);
  const remarketingJobId = await scheduleRemarketing(
    stored!.id,
    remarketingDelay,
  );

  await db
    .update(shopifyOrders)
    .set({
      followupJobId: followupJobId ?? null,
      remarketingJobId: remarketingJobId ?? null,
    })
    .where(eq(shopifyOrders.id, stored!.id));

  logger.info(
    {
      orderId: order.id,
      contactId: contact.id,
      followupJobId,
      remarketingJobId,
      followupAt,
      remarketingAt,
    },
    "shopify order accepted, follow-up + remarketing scheduled",
  );

  return c.json({ ok: true });
});

void conversations;
