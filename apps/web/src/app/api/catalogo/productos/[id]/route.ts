import { auth } from "@/auth";
import { deleteProduct, setSalesBrief, updateNativeProduct } from "@wa/db";
import { resolvePanelOperation } from "@/lib/operation";

/**
 * Editar y borrar un producto del catálogo.
 *
 * El id llega de la URL, o sea de afuera. Quien decide si se puede tocar es el
 * accesor, que resuelve `null` para un producto de otra operación —y lanza
 * sobre uno conectado, porque **el panel no escribe sobre la tienda**.
 *
 * **La ficha de venta viaja por su propio accesor y esa separación es la
 * regla, no una comodidad.** `updateNativeProduct` se sigue negando a tocar un
 * producto conectado, que es lo correcto para nombre, descripción y precio:
 * guardar acá una copia de lo que vive en la tienda es la desincronización
 * silenciosa que la `0022` prohibió. `sales_brief` no es una copia —en Shopify
 * no existe— así que se puede escribir sobre cualquier fuente sin abrirle un
 * agujero a esa regla. Mezclarlos en un solo accesor habría exigido relajarla.
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
    /**
     * Ausente no toca el precio; la cadena vacía se lo quita. Son dos cosas
     * distintas y la ficha usa las dos: guardar el nombre sin tocar el precio,
     * y borrarle el precio a un producto que dejó de venderse — que lo vuelve a
     * dejar escalando a un asesor, que es el estado seguro.
     */
    price?: string | number | null;
    /** Ausente no la toca; la cadena vacía la borra y devuelve al producto a leer la tienda. */
    salesBrief?: string | null;
  };

  try {
    const op = await resolvePanelOperation();

    // Primero la ficha: es lo único que un producto conectado acepta, y si va
    // después, el `throw` de `updateNativeProduct` se la lleva por delante.
    if (body.salesBrief !== undefined) {
      await setSalesBrief(op, id, body.salesBrief);
    }

    const tocaLoDeLaFuente =
      body.name !== undefined ||
      body.description !== undefined ||
      body.price !== undefined;
    if (!tocaLoDeLaFuente) return Response.json({ ok: true, id });

    const product = await updateNativeProduct(op, id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
      ...(body.price !== undefined ? { price: body.price } : {}),
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
