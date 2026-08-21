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
  salesAgentIsConfigured,
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

/**
 * **Si la vista previa de la fila la escribimos nosotros.**
 *
 * No compara mensajes: compara las dos fechas que la conversación ya guarda. Y
 * eso alcanza porque **la vista previa y `last_outbound_at` se escriben en la
 * misma sentencia** —`huellaDelSaliente`, en el worker, que las llama «el mismo
 * hecho dicho de tres maneras»—, y en la ingesta pasa lo propio con
 * `last_inbound_at`. Así que la más reciente de las dos dice de quién es el
 * texto, sin un viaje más a la base.
 *
 * Sin ningún saliente no es nuestra, y sin ningún entrante sí: una conversación
 * que solo tiene lo que le mandamos muestra lo que le mandamos.
 */
function elUltimoEsNuestro(c: {
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
}): boolean {
  if (c.lastOutboundAt === null) return false;
  if (c.lastInboundAt === null) return true;
  return c.lastOutboundAt.getTime() > c.lastInboundAt.getTime();
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; c?: string; b?: string; v?: string }>;
}) {
  const session = await auth();
  // `v` no se desestructura: desde PRO-11 la conversación abierta y el filtro
  // se leen de la dirección **en el cliente**, así que el servidor ya no los
  // necesita. El tipo sí los sigue declarando, porque siguen llegando en la URL.
  const { q, c, b } = await searchParams;
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
        // **Se calcula siempre, también sin vendedor**, que es lo que hace que
        // Katherine vea las escaladas: antes dependía de que hubiera bandeja, y
        // sin vendedor no hay bandeja.
        //
        // Era `mark: resolveRowMark(...)`, que devolvía además «ambiguo» y «sin
        // producto». Esas dos marcas dejaron de dibujarse en la fila —nunca se
        // encendieron: `product_recognition` y `ad_referral_at` son `null` en
        // las 1.770 conversaciones— y con ellas se fue la función entera, que
        // se quedaba con una sola rama viva. Lo que la cascada dudó se sigue
        // contando en el hilo, fechado, que es donde de verdad se lee.
        escalada: i.routing.escalations.length > 0,
        previewEsNuestro: elUltimoEsNuestro(i.conversation),
      }))}
      approvedTemplates={approvedTemplates}
      query={q ?? ""}
      // El nombre y el país, para la línea de contexto que va sobre el `h1`.
      // Van desde acá y no se piden en el cliente porque `resolvePanelOperation`
      // ya trajo la fila entera en este mismo render: es el dato que el Inbox
      // no tenía y por el que la pantalla desde la que salen mensajes a
      // Guatemala no decía en ningún sitio que era Guatemala.
      op={{ name: op.name, countryCode: op.countryCode }}
      // La conversación abierta y el filtro **se leen de la dirección en el
      // cliente** (`?c=` y `?v=`), no viajan como props: seleccionar un chat o
      // cambiar de filtro escribe la URL sin pedirle un render al servidor. Acá
      // `c` se sigue usando para anclar esa conversación en la lista aunque se
      // haya salido del corte por actividad o de la búsqueda.
      operationId={op.id}
      bandeja={bandeja?.inbox ?? null}
      // El mismo listón que decide la bandeja, y por lo mismo: `null` es lo que
      // apaga el nombre del vendedor en los eventos del hilo y el botón de
      // «TRABAJARLA YO». Con la fila a medio llenar esto decía «el vendedor» y
      // encendía los dos, que es la mentira que el ticket vino a sacar.
      sellerName={salesAgentIsConfigured(seller) ? seller.displayName.trim() : null}
      currentUserId={session?.user.id ?? null}
    />
  );
}
