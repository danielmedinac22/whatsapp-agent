import { auth } from "@/auth";
import { linkAdToProducts, listProductIdsForAd, panelOperation, unlinkAd } from "@wa/db";

/**
 * El registro de anuncios: un identificador, uno o varios productos.
 *
 * **Varios de una vez es el N:M del ticket**, no una comodidad de la interfaz:
 * es lo que dispara la selección múltiple de la tabla y la forma en que un
 * anuncio de familia o de combo queda registrado sin inventar un producto
 * falso.
 *
 * Devuelve el conjunto resultante —todos los productos a los que ese anuncio
 * apunta ahora— que es exactamente lo que el nivel 1 del reconocimiento va a
 * leer. Así la pantalla puede mostrar lo mismo que verá el matcher, en vez de
 * lo que ella cree que acaba de guardar.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });

  const body = (await req.json()) as {
    adId?: string;
    productIds?: string[];
  };
  if (!body.adId?.trim()) {
    return Response.json(
      { error: "falta el identificador del anuncio" },
      { status: 400 },
    );
  }
  const productIds = body.productIds ?? [];
  if (productIds.length === 0) {
    return Response.json(
      { error: "hay que elegir al menos un producto" },
      { status: 400 },
    );
  }

  try {
    const op = await panelOperation();
    const { linked, rejected } = await linkAdToProducts(
      op,
      body.adId,
      productIds,
    );
    const set = await listProductIdsForAd(op, body.adId);
    return Response.json({ ok: true, linked, rejected, productIds: set });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

/** Quita un anuncio de un producto. Los demás productos del anuncio siguen. */
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const body = (await req.json()) as { adId?: string; productId?: string };
  if (!body.adId || !body.productId) {
    return Response.json({ error: "faltan datos" }, { status: 400 });
  }
  const gone = await unlinkAd(await panelOperation(), body.adId, body.productId);
  return Response.json({ ok: gone });
}
