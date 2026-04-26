import { listConversations } from "@/lib/queries";
import { InboxClient } from "./inbox-client";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const items = await listConversations();
  return (
    <InboxClient
      initial={items.map((i) => ({
        id: i.conversation.id,
        contactId: i.contact.id,
        jid: i.contact.jid,
        name: i.contact.name ?? i.contact.pushName ?? i.contact.phone ?? i.contact.jid,
        agentMode: i.contact.agentMode,
        preview: i.conversation.lastMessagePreview,
        unread: i.conversation.unreadCount,
        lastAt:
          (
            i.conversation.lastInboundAt ??
            i.conversation.lastOutboundAt ??
            i.conversation.createdAt
          ).toISOString(),
      }))}
    />
  );
}
