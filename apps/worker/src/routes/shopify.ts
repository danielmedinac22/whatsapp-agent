import { Hono } from "hono";
import { eq } from "@wa/db";
import {
  agentSettings,
  contacts,
  conversations,
  shopifyOrders,
} from "@wa/db";
import { shopifyOrderWebhook } from "@wa/shared";
import { db } from "../db";
import { logger } from "../lib/logger";
import { verifyShopifyHmac } from "../shopify/verify";
import { scheduleFollowup } from "../jobs/followup";
import { scheduleRemarketing } from "../jobs/remarketing";
import { getSocket } from "../baileys/session";

export const shopify = new Hono();

function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d+]/g, "");
  if (!digits) return null;
  return digits.startsWith("+") ? digits.slice(1) : digits;
}

function jidFromPhone(phone: string): string {
  return `${phone}@s.whatsapp.net`;
}

async function resolveJid(phone: string): Promise<string> {
  const sock = getSocket();
  if (!sock) {
    logger.warn({ phone }, "no socket — falling back to s.whatsapp.net jid");
    return jidFromPhone(phone);
  }
  try {
    const results = await sock.onWhatsApp(`+${phone}`);
    const hit = results?.[0];
    if (hit?.exists && hit.jid) {
      logger.info({ phone, resolved: hit.jid }, "resolved phone to jid");
      return hit.jid;
    }
    logger.warn({ phone }, "phone not on whatsapp — using s.whatsapp.net fallback");
  } catch (err) {
    logger.warn({ err, phone }, "onWhatsApp lookup failed — using fallback");
  }
  return jidFromPhone(phone);
}

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

  // Resolve the actual JID via Baileys — handles LID-only accounts.
  const jid = await resolveJid(phone);
  let [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.jid, jid))
    .limit(1);
  if (!contact) {
    [contact] = await db
      .insert(contacts)
      .values({ jid, phone, name: customerName })
      .returning();
  } else if (customerName && !contact.name) {
    await db
      .update(contacts)
      .set({ name: customerName })
      .where(eq(contacts.id, contact.id));
  }

  let [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.contactId, contact!.id))
    .limit(1);
  if (!conv) {
    [conv] = await db
      .insert(conversations)
      .values({ contactId: contact!.id })
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
      contactId: contact!.id,
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
      contactId: contact!.id,
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
