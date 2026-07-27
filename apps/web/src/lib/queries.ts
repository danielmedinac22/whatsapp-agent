import { db } from "./db";
import {
  contacts,
  conversations,
  messages,
  templates,
  agentSettings,
  shopifyOrders,
  dropiOrders,
  waTemplates,
  asc,
  desc,
  eq,
  inArray,
  sql,
} from "@wa/db";

export type DropiSummary = {
  status: typeof dropiOrders.$inferSelect.status;
  hasNovedad: boolean;
  guideNumber: string | null;
  carrier: string | null;
  guidePdfPath: string | null;
  novedadReason: string | null;
  updatedAt: Date;
};

export type ShopifySummary = {
  orderNumber: string;
  totalPrice: string | null;
};

export type ConversationListItem = {
  conversation: typeof conversations.$inferSelect;
  contact: typeof contacts.$inferSelect;
  dropi: DropiSummary | null;
  shopify: ShopifySummary | null;
};

export async function listConversations(): Promise<ConversationListItem[]> {
  const rows = await db
    .select({
      conversation: conversations,
      contact: contacts,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .orderBy(
      desc(
        sql`COALESCE(${conversations.lastInboundAt}, ${conversations.lastOutboundAt}, ${conversations.createdAt})`,
      ),
    )
    .limit(200);

  const contactIds = rows.map((r) => r.contact.id);
  if (contactIds.length === 0) {
    return rows.map((r) => ({ ...r, dropi: null, shopify: null }));
  }

  // Fetch all dropi orders for these contacts, ordered so the most recent
  // wins when we collapse to one summary per contact.
  const dropiRows = await db
    .select()
    .from(dropiOrders)
    .where(inArray(dropiOrders.contactId, contactIds))
    .orderBy(desc(dropiOrders.updatedAt));

  const byContact = new Map<string, DropiSummary>();
  for (const o of dropiRows) {
    if (!o.contactId) continue;
    const cur = byContact.get(o.contactId);
    if (!cur) {
      byContact.set(o.contactId, {
        status: o.status,
        hasNovedad: o.status === "novedad",
        guideNumber: o.guideNumber,
        carrier: o.carrier,
        guidePdfPath: o.guidePdfPath,
        novedadReason: o.novedadReasonRaw,
        updatedAt: o.updatedAt,
      });
    } else if (o.status === "novedad") {
      cur.hasNovedad = true;
    }
  }

  // Most recent Shopify order per contact — feeds the reopen-template options.
  const shopifyRows = await db
    .select({
      contactId: shopifyOrders.contactId,
      orderId: shopifyOrders.orderId,
      totalPrice: shopifyOrders.totalPrice,
      receivedAt: shopifyOrders.receivedAt,
    })
    .from(shopifyOrders)
    .where(inArray(shopifyOrders.contactId, contactIds))
    .orderBy(desc(shopifyOrders.receivedAt));
  const shopifyByContact = new Map<string, ShopifySummary>();
  for (const o of shopifyRows) {
    if (!o.contactId || shopifyByContact.has(o.contactId)) continue;
    shopifyByContact.set(o.contactId, {
      orderNumber: o.orderId,
      totalPrice: o.totalPrice,
    });
  }

  return rows.map((r) => ({
    ...r,
    dropi: byContact.get(r.contact.id) ?? null,
    shopify: shopifyByContact.get(r.contact.id) ?? null,
  }));
}

/** Catalog templates Meta has approved for the current WABA. */
export async function listApprovedWaTemplates(): Promise<string[]> {
  const rows = await db
    .select({ name: waTemplates.name })
    .from(waTemplates)
    .where(eq(waTemplates.status, "approved"));
  return rows.map((r) => r.name);
}

export async function getConversationById(id: string) {
  const [row] = await db
    .select({ conversation: conversations, contact: contacts })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(eq(conversations.id, id))
    .limit(1);
  return row ?? null;
}

export async function listMessages(conversationId: string, limit = 200) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .limit(limit);
}

export async function markRead(conversationId: string) {
  await db
    .update(conversations)
    .set({ unreadCount: 0 })
    .where(eq(conversations.id, conversationId));
}

export async function listTemplates() {
  return db.select().from(templates).orderBy(asc(templates.name));
}

export async function getAgentSettings() {
  const [row] = await db
    .select()
    .from(agentSettings)
    .where(eq(agentSettings.id, 1))
    .limit(1);
  return row ?? null;
}

export async function setAgentMode(contactId: string, on: boolean) {
  await db
    .update(contacts)
    .set({ agentMode: on })
    .where(eq(contacts.id, contactId));
}

export type ConfirmationStatus =
  | "unknown"
  | "pending"
  | "confirmed"
  | "not_confirmed";

export async function setConfirmationStatus(
  conversationId: string,
  status: ConfirmationStatus,
) {
  await db
    .update(conversations)
    .set({
      confirmationStatus: status,
      confirmationSource: "manual",
      confirmationUpdatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

export async function listShopifyOrders(limit = 50) {
  return db
    .select()
    .from(shopifyOrders)
    .orderBy(desc(shopifyOrders.receivedAt))
    .limit(limit);
}

export async function listShopifyOrdersWithDropi(limit = 200) {
  return db
    .select({
      shopify: shopifyOrders,
      dropi: dropiOrders,
    })
    .from(shopifyOrders)
    .leftJoin(
      dropiOrders,
      eq(dropiOrders.shopifyOrderRowId, shopifyOrders.id),
    )
    .orderBy(desc(shopifyOrders.receivedAt))
    .limit(limit);
}
