import { auth } from "@/auth";
import { setAgentMode } from "@/lib/queries";
import { resolvePanelOperation } from "@/lib/operation";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const body = (await req.json()) as { on?: boolean };
  // Un contacto que esta operación no atiende no existe para esta pestaña: 404,
  // no un `ok: true` sobre una fila que no se tocó.
  const written = await setAgentMode(
    await resolvePanelOperation(),
    id,
    !!body.on,
  );
  if (!written) return new Response("not found", { status: 404 });
  return Response.json({ ok: true });
}
