import { db } from "@/lib/db";
import { listApprovedWaTemplates, listConversations } from "@/lib/queries";
import { dropiConnection, eq } from "@wa/db";
import { InboxClient } from "./inbox-client";

export const dynamic = "force-dynamic";

/** Actividad más reciente: el mayor de los tres, no el primero no-nulo. */
function lastActivity(
  lastInboundAt: Date | null,
  lastOutboundAt: Date | null,
  createdAt: Date,
): Date {
  return [lastInboundAt, lastOutboundAt, createdAt].reduce<Date>(
    (max, d) => (d && d > max ? d : max),
    createdAt,
  );
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [items, [conn], approvedTemplates] = await Promise.all([
    listConversations(q),
    db
      .select({ assetsBaseUrl: dropiConnection.assetsBaseUrl })
      .from(dropiConnection)
      .where(eq(dropiConnection.id, 1))
      .limit(1),
    listApprovedWaTemplates(),
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
        to:
          i.contact.waId ??
          i.contact.phone ??
          i.contact.jid.split("@")[0] ??
          "",
        name:
          i.contact.name ??
          i.contact.pushName ??
          i.contact.phone ??
          i.contact.waId ??
          i.contact.jid,
        agentMode: i.contact.agentMode,
        preview: i.conversation.lastMessagePreview,
        unread: i.conversation.unreadCount,
        confirmationStatus: i.conversation.confirmationStatus,
        confirmationSource: i.conversation.confirmationSource,
        lastAt: lastActivity(
          i.conversation.lastInboundAt,
          i.conversation.lastOutboundAt,
          i.conversation.createdAt,
        ).toISOString(),
        lastInboundAt: i.conversation.lastInboundAt?.toISOString() ?? null,
        dropiStatus: i.dropi?.status ?? null,
        dropiHasNovedad: i.dropi?.hasNovedad ?? false,
        dropiGuide: i.dropi?.guideNumber ?? null,
        dropiCarrier: i.dropi?.carrier ?? null,
        dropiPdfUrl: buildPdfUrl(i.dropi?.guidePdfPath ?? null),
        novedadReason: i.dropi?.novedadReason ?? null,
        orderNumber: i.shopify?.orderNumber ?? null,
        producto: i.shopify?.producto ?? null,
      }))}
      approvedTemplates={approvedTemplates}
      query={q ?? ""}
    />
  );
}
