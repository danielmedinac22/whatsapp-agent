import { auth } from "@/auth";
import { listMessages, markRead } from "@/lib/queries";
import { resolvePanelOperation } from "@/lib/operation";

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
  return Response.json({ messages: msgs });
}
