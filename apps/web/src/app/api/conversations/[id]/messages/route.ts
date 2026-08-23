import { auth } from "@/auth";
import { getSalesContext, listMessages, markRead } from "@/lib/queries";
import { resolvePanelOperation } from "@/lib/operation";
import {
  getSalesAgentSettings,
  salesAgentIsConfigured,
  salesThreadEvents,
} from "@wa/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  // El historial de una conversación de otra operación no se sirve vacío: se
  // contesta 404. Vacío se leería como «este cliente nunca escribió».
  const op = await resolvePanelOperation();
  const read = await markRead(op, id);
  if (!read) return new Response("not found", { status: 404 });
  const msgs = await listMessages(op, id);

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
  // El listón es el único del monorepo —interruptor encendido y con nombre—, no la
  // existencia de la fila: con la configuración a medio llenar este hilo
  // narraba «El vendedor reconoció...» sobre un vendedor que no contesta.
  if (!salesAgentIsConfigured(seller)) {
    return Response.json({ messages: msgs, events: [] });
  }

  const facts = await getSalesContext(op, id);
  return Response.json({
    messages: msgs,
    events: facts ? salesThreadEvents(facts) : [],
    sellerName: seller.displayName.trim(),
  });
}
