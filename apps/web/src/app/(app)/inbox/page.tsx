import { auth } from "@/auth";
import { db } from "@/lib/db";
import { listApprovedWaTemplates, listConversations } from "@/lib/queries";
import {
  dropiConnection,
  eq,
  getSalesAgentSettings,
  resolveRowMark,
  type Inbox,
} from "@wa/db";
import { resolvePanelOperation } from "@/lib/operation";
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

/**
 * Qué bandeja pide la URL.
 *
 * `?b=ventas` es la de Sebastián; **cualquier otra cosa es la de siempre**, y
 * eso incluye no poner el parámetro. Es deliberado que el enlace de Katherine
 * no lleve parámetro: su URL de hoy tiene que seguir significando lo mismo
 * mañana, aunque lo que traiga cambie cuando exista vendedor.
 */
function bandejaPedida(b: string | undefined, conVendedor: boolean): Inbox | undefined {
  if (!conVendedor) return undefined;
  return b === "ventas" ? "ventas" : "operaciones";
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; c?: string; b?: string; v?: string }>;
}) {
  const session = await auth();
  const { q, c, b, v } = await searchParams;
  // El CDN del PDF de la guía sale de la logística de la operación del panel.
  // Antes leía `dropi_connection` por `id = 1`: el último `id = 1` del panel, y
  // el que le habría puesto el CDN guatemalteco a las guías colombianas.
  const op = await resolvePanelOperation();

  // El vendedor decide si esta operación tiene dos bandejas o una. Sin fila,
  // `listConversations` no filtra ni deriva nada y la pantalla es la de hoy.
  const seller = await getSalesAgentSettings(op);
  const inbox = bandejaPedida(b, seller !== null);

  const [items, [conn], approvedTemplates] = await Promise.all([
    listConversations(op, { search: q, pinnedId: c, inbox }),
    db
      .select({ assetsBaseUrl: dropiConnection.assetsBaseUrl })
      .from(dropiConnection)
      .where(eq(dropiConnection.operationId, op.id))
      .limit(1),
    listApprovedWaTemplates(op),
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
        deliveryFailed: i.lastOutboundFailed,
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
        assignedTo: i.assignedTo,
        // La fila solo marca el reconocimiento cuando NO es limpio: la regla
        // vive en `@wa/db` y aquí solo se le pasan los hechos.
        mark: i.routing
          ? resolveRowMark({
              adReferralAt: i.conversation.adReferralAt,
              adId: i.conversation.adId,
              adHeadline: i.conversation.adHeadline,
              productName: null,
              productIdentified: i.conversation.productId !== null,
              escalations: i.routing.escalations,
            })
          : null,
      }))}
      approvedTemplates={approvedTemplates}
      query={q ?? ""}
      selectedId={c ?? null}
      bandeja={inbox ?? null}
      vista={v === "atencion" || v === "agente" ? v : null}
      sellerName={seller ? seller.displayName.trim() || "el vendedor" : null}
      currentUserId={session?.user.id ?? null}
    />
  );
}
