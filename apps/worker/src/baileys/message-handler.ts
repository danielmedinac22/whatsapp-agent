import type { WAMessage, WASocket } from "baileys";
import { and, eq } from "@wa/db";
import {
  contacts,
  conversations,
  messages,
  type Contact,
  type Conversation,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { events } from "../lib/events";
import { onAgentInbound } from "../agent/runner";

function extractText(m: WAMessage): string {
  const msg = m.message;
  if (!msg) return "";
  return (
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    msg.documentMessage?.caption ??
    ""
  );
}

async function ensureContact(jid: string, pushName?: string): Promise<Contact> {
  const phone = jid.split("@")[0]?.split(":")[0] ?? null;
  const existing = await db
    .select()
    .from(contacts)
    .where(eq(contacts.jid, jid))
    .limit(1);
  if (existing[0]) {
    if (pushName && existing[0].pushName !== pushName) {
      await db
        .update(contacts)
        .set({ pushName })
        .where(eq(contacts.id, existing[0].id));
    }
    return existing[0];
  }
  const [created] = await db
    .insert(contacts)
    .values({ jid, phone, pushName, name: pushName ?? phone })
    .returning();
  return created!;
}

async function ensureConversation(contactId: string): Promise<Conversation> {
  const existing = await db
    .select()
    .from(conversations)
    .where(eq(conversations.contactId, contactId))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(conversations)
    .values({ contactId })
    .returning();
  return created!;
}

export async function onMessages(
  _sock: WASocket,
  upsert: { messages: WAMessage[]; type: string },
) {
  for (const m of upsert.messages) {
    if (!m.key.remoteJid) continue;
    if (m.key.remoteJid === "status@broadcast") continue;
    if (m.key.remoteJid.endsWith("@g.us")) continue; // ignore groups for now

    const direction = m.key.fromMe ? "out" : "in";
    const body = extractText(m);
    if (!body && !m.message?.imageMessage && !m.message?.audioMessage)
      continue;

    const contact = await ensureContact(
      m.key.remoteJid,
      m.pushName ?? undefined,
    );
    const conv = await ensureConversation(contact.id);

    const [stored] = await db
      .insert(messages)
      .values({
        conversationId: conv.id,
        direction,
        waId: m.key.id ?? null,
        body,
        status: direction === "out" ? "sent" : "delivered",
      })
      .onConflictDoNothing({ target: messages.waId })
      .returning();

    if (!stored) continue;

    const now = new Date();
    await db
      .update(conversations)
      .set({
        lastMessagePreview: body.slice(0, 200),
        ...(direction === "in"
          ? {
              lastInboundAt: now,
              unreadCount: (conv.unreadCount ?? 0) + 1,
            }
          : { lastOutboundAt: now }),
      })
      .where(eq(conversations.id, conv.id));

    await db
      .update(contacts)
      .set({ lastMessageAt: now })
      .where(eq(contacts.id, contact.id));

    events.emitEvent({
      type: "message.created",
      conversationId: conv.id,
      messageId: stored.id,
    });

    if (direction === "in" && contact.agentMode) {
      onAgentInbound({
        contact,
        conversation: conv,
        body,
      }).catch((err) => logger.error({ err }, "agent runner failed"));
    }
  }
  void and; // suppress unused warning when build re-orders
}
