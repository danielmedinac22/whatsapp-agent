import { auth } from "@/auth";
import {
  esCursorDeMensaje,
  getConversationById,
  getSalesContext,
  listMessages,
  markRead,
} from "@/lib/queries";
import { resolvePanelOperation } from "@/lib/operation";
import {
  getSalesAgentSettings,
  salesAgentIsConfigured,
  salesThreadEvents,
} from "@wa/db";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  // El historial de una conversación de otra operación no se sirve vacío: se
  // contesta 404. Vacío se leería como «este cliente nunca escribió».
  const op = await resolvePanelOperation();

  /**
   * `?before=<id>`: la página anterior, cuando el asesor sube por el hilo.
   * Solo mensajes: subir a leer no es abrir el chat, así que no marca leído, y
   * el contexto de venta ya llegó con la primera página.
   */
  const before = new URL(req.url).searchParams.get("before");
  if (before !== null) {
    if (!esCursorDeMensaje(before)) {
      return new Response("bad cursor", { status: 400 });
    }
    if (!(await getConversationById(op, id))) {
      return new Response("not found", { status: 404 });
    }
    return Response.json(await listMessages(op, id, { before }));
  }

  const read = await markRead(op, id);
  if (!read) return new Response("not found", { status: 404 });
  const { messages: msgs, hasMore } = await listMessages(op, id);

  /**
   * El contexto de venta va **en el mismo hilo y en las dos bandejas**: los
   * módulos separan pantallas y configuración, no el historial, y operaciones
   * necesita saber qué le prometieron al cliente (criterio del ticket 03).
   *
   * Lo que sí lo apaga entero es que la operación no tenga vendedor
   * configurado: sin él no hay reconocimiento del que hablar, y el hilo de
   * Katherine tiene que quedar exactamente como estaba.
   */
  const seller = await getSalesAgentSettings(op);
  // El listón es el único del monorepo —nombre visible no vacío—, no la
  // existencia de la fila: con la configuración a medio llenar este hilo
  // narraba «El vendedor reconoció...» sobre un vendedor que no contesta.
  if (!salesAgentIsConfigured(seller)) {
    return Response.json({ messages: msgs, hasMore, events: [] });
  }

  const facts = await getSalesContext(op, id);
  return Response.json({
    messages: msgs,
    hasMore,
    events: facts ? salesThreadEvents(facts) : [],
    sellerName: seller.displayName.trim(),
  });
}
