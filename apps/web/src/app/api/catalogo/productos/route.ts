import { auth } from "@/auth";
import { connectShopifyProduct, createNativeProduct } from "@wa/db";
import { resolvePanelOperation } from "@/lib/operation";

/**
 * Alta de producto, por los dos caminos que el ticket pide.
 *
 * `nativo` guarda nombre, descripción y **precio** porque no hay de dónde
 * leerlos. `tienda` guarda **solo el identificador**: copiar el título —o el
 * precio— acá sería la desincronización silenciosa que el criterio del ticket
 * prohíbe. Un producto de la tienda que llegue con precio en el cuerpo lo
 * pierde acá, y si alguien insistiera lo rechazaría el `check` de la base.
 *
 * La operación la resuelve `resolvePanelOperation()` y no el cuerpo de la petición: de
 * dónde es el producto no lo decide el navegador.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });

  const body = (await req.json()) as {
    source?: string;
    name?: string;
    description?: string | null;
    /** Tal como lo tecleó el admin. El accesor decide si es un precio. */
    price?: string | number | null;
    shopifyProductId?: string;
  };

  const op = await resolvePanelOperation();
  try {
    if (body.source === "shopify") {
      if (!body.shopifyProductId?.trim()) {
        return Response.json(
          { error: "falta el producto de la tienda" },
          { status: 400 },
        );
      }
      const product = await connectShopifyProduct(op, body.shopifyProductId);
      return Response.json({ ok: true, id: product.id });
    }

    if (!body.name?.trim()) {
      return Response.json(
        { error: "un producto creado en el panel necesita nombre" },
        { status: 400 },
      );
    }
    const product = await createNativeProduct(op, {
      name: body.name,
      description: body.description ?? null,
      // Sin precio es un alta legítima: el producto se puede describir y
      // mandarle archivos al cliente desde el primer día. Lo único que no se
      // puede hasta que alguien lo escriba es **cerrarle una venta**.
      price: body.price ?? null,
    });
    return Response.json({ ok: true, id: product.id });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
