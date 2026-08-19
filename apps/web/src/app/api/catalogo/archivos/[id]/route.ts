import { auth } from "@/auth";
import { deleteProductMedia, setProductMediaSendable } from "@wa/db";
import { resolvePanelOperation } from "@/lib/operation";

/**
 * El interruptor de enviable, y quitar un archivo.
 *
 * **Marcar es un acto explícito y por eso tiene ruta propia.** Un archivo nace
 * apagado al subirse: el error que eso evita —mandarle al cliente la hoja de
 * márgenes internos que el admin cargó para tenerla a mano— no se deshace.
 *
 * El id viaja en la URL, o sea que llega de afuera. Quien decide si se puede
 * tocar es el accesor, que resuelve contra la operación del panel: un archivo
 * de la operación vecina responde 404, no lo edita.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as { sendable?: unknown } | null;
  if (typeof body?.sendable !== "boolean") {
    return Response.json({ error: "falta el valor del interruptor" }, { status: 400 });
  }

  try {
    const media = await setProductMediaSendable(
      await resolvePanelOperation(),
      id,
      body.sendable,
    );
    if (!media) {
      return Response.json(
        { error: "el archivo no existe en esta operación" },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, media });
  } catch (err) {
    // El accesor lanza cuando se intenta marcar un archivo que excede el
    // límite de WhatsApp. Vuelve como 400 con su motivo, no como 500.
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const gone = await deleteProductMedia(await resolvePanelOperation(), id);
  if (!gone) {
    return Response.json(
      { error: "el archivo no existe en esta operación" },
      { status: 404 },
    );
  }
  return Response.json({ ok: true });
}
