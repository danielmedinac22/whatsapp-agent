import { db } from "./db";
import {
  contacts,
  conversations,
  messages,
  templates,
  agentSettings,
  shopifyOrders,
  asc,
  desc,
  eq,
  sql,
} from "@wa/db";

export type ConversationListItem = {
  conversation: typeof conversations.$inferSelect;
  contact: typeof contacts.$inferSelect;
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
  return rows;
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
