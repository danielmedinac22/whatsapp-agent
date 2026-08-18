import { auth } from "@/auth";
import { deleteProduct, updateNativeProduct } from "@wa/db";
import { resolvePanelOperation } from "@/lib/operation";

/**
 * Editar y borrar un producto del catálogo.
 *
 * El id llega de la URL, o sea de afuera. Quien decide si se puede tocar es el
 * accesor, que resuelve `null` para un producto de otra operación —y lanza
 * sobre uno conectado, porque **el panel no escribe sobre la tienda**.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const body = (await req.json()) as {
    name?: string;
    description?: string | null;
  };

  try {
    const product = await updateNativeProduct(await resolvePanelOperation(), id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
    });
    return Response.json({ ok: true, id: product.id });
  } catch (err) {
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
  const gone = await deleteProduct(await resolvePanelOperation(), id);
  if (!gone) {
    return Response.json(
      { error: "el producto no existe en esta operación" },
      { status: 404 },
    );
  }
  return Response.json({ ok: true });
}
