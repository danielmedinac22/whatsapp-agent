import { auth } from "@/auth";
import {
  getAssetsBaseUrl,
  listApprovedWaTemplates,
  listConversations,
  type BandejaPedida,
} from "@/lib/queries";
import {
  actividadDe,
  getSalesAgentSettings,
  parseRecognitionOutcome,
  salesAgentIsConfigured,
  resolveRowMark,
} from "@wa/db";
import { resolvePanelOperation } from "@/lib/operation";
import { InboxClient } from "./inbox-client";

export const dynamic = "force-dynamic";

/**
 * Qué bandeja pide la URL, con la línea de corte del vendedor pegada.
 *
 * `?b=ventas` es la de Sebastián; **cualquier otra cosa es la de siempre**, y
 * eso incluye no poner el parámetro. Es deliberado que el enlace de Katherine
 * no lleve parámetro: su URL de hoy tiene que seguir significando lo mismo
 * mañana, aunque lo que traiga cambie cuando exista vendedor.
 *
 * `undefined` es «esta operación tiene una sola bandeja», y sale de que no haya
 * vendedor configurado. El corte viaja adentro porque sin él la bandeja de
 * ventas queda vacía y nada deja de compilar — ver {@link BandejaPedida}.
 */
function bandejaPedida(
  b: string | undefined,
  vendedor: { activatedAt: Date | null } | null,
): BandejaPedida | undefined {
  if (vendedor === null) return undefined;
  return {
    inbox: b === "ventas" ? "ventas" : "operaciones",
    activatedAt: vendedor.activatedAt,
  };
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; c?: string; b?: string; v?: string }>;
}) {
  const session = await auth();
  const { q, c, b, v } = await searchParams;
  // El CDN del PDF de la guía sale de la logística de la operación del panel
  // (`getAssetsBaseUrl`). Antes leía `dropi_connection` por `id = 1`: el último
  // `id = 1` del panel, y el que le habría puesto el CDN guatemalteco a las
  // guías colombianas.
  const op = await resolvePanelOperation();

  // El vendedor decide si esta operación tiene dos bandejas o una. Sin vendedor
  // —el listón único: nombre visible no vacío, no la existencia de la fila—
  // `listConversations` no filtra ni deriva nada y la pantalla es la de hoy.
  const seller = await getSalesAgentSettings(op);
  const bandeja = bandejaPedida(b, salesAgentIsConfigured(seller) ? seller : null);

  const [items, assetsBase, approvedTemplates] = await Promise.all([
    listConversations(op, { search: q, pinnedId: c, bandeja }),
    getAssetsBaseUrl(op),
    listApprovedWaTemplates(op),
  ]);

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
        lastAt: actividadDe(i.conversation).toISOString(),
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
        sinResponder: i.sinResponder,
        // La fila solo marca el reconocimiento cuando NO es limpio: la regla
        // vive en `@wa/db` y aquí solo se le pasan los hechos. «Ambiguo» sale
        // de lo que la cascada dejó registrado (`0026`); antes era
        // indistinguible de «no encontré nada» y las dos se marcaban igual.
        //
        // **Se calcula siempre, también sin vendedor**, que es lo que hace que
        // Katherine vea las escaladas: antes dependía de que hubiera bandeja, y
        // sin vendedor no hay bandeja. Las otras dos marcas necesitan un clic de
        // anuncio, y `ad_referral_at` es `null` en las 1.760 conversaciones de
        // producción; el día que lleguen anuncios habrá vendedor, porque es el
        // vendedor quien los atiende.
        mark: resolveRowMark({
          adReferralAt: i.conversation.adReferralAt,
          productIdentified: i.conversation.productId !== null,
          recognitionOutcome: parseRecognitionOutcome(
            i.conversation.productRecognition,
          ),
          escalations: i.routing.escalations,
        }),
      }))}
      approvedTemplates={approvedTemplates}
      query={q ?? ""}
      selectedId={c ?? null}
      bandeja={bandeja?.inbox ?? null}
      vista={v === "sin-responder" || v === "en-automatico" ? v : null}
      // El mismo listón que decide la bandeja, y por lo mismo: `null` es lo que
      // apaga el nombre del vendedor en los eventos del hilo y el botón de
      // «TRABAJARLA YO». Con la fila a medio llenar esto decía «el vendedor» y
      // encendía los dos, que es la mentira que el ticket vino a sacar.
      sellerName={salesAgentIsConfigured(seller) ? seller.displayName.trim() : null}
      currentUserId={session?.user.id ?? null}
    />
  );
}
