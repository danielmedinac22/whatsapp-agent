import { db } from "@/lib/db";
import { listConversations } from "@/lib/queries";
import { dropiConnection, eq } from "@wa/db";
import { InboxClient } from "./inbox-client";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const [items, [conn]] = await Promise.all([
    listConversations(),
    db
      .select({ assetsBaseUrl: dropiConnection.assetsBaseUrl })
      .from(dropiConnection)
      .where(eq(dropiConnection.id, 1))
      .limit(1),
  ]);

  const assetsBase = (conn?.assetsBaseUrl ?? "").replace(/\/$/, "");
  const buildPdfUrl = (path: string | null): string | null => {
    if (!assetsBase || !path) return null;
    return `${assetsBase}/${path.replace(/^\//, "")}`;
  };

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
        confirmationStatus: i.conversation.confirmationStatus,
        confirmationSource: i.conversation.confirmationSource,
        lastAt:
          (
            i.conversation.lastInboundAt ??
            i.conversation.lastOutboundAt ??
            i.conversation.createdAt
          ).toISOString(),
        dropiStatus: i.dropi?.status ?? null,
        dropiHasNovedad: i.dropi?.hasNovedad ?? false,
        dropiGuide: i.dropi?.guideNumber ?? null,
        dropiCarrier: i.dropi?.carrier ?? null,
        dropiPdfUrl: buildPdfUrl(i.dropi?.guidePdfPath ?? null),
      }))}
    />
  );
}
