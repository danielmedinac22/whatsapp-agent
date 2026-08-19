import { auth } from "@/auth";
import { addProductMedia } from "@wa/db";
import { rechazoDeSubida } from "@wa/shared";
import { resolvePanelOperation } from "@/lib/operation";

/**
 * Subir un archivo a un producto.
 *
 * **El rechazo por tamaño se hace acá y no al enviar**, que es el criterio del
 * ticket 02: «para que el problema aparezca cuando el admin puede resolverlo».
 * Recomprimir un video es algo que se hace sentado frente al panel; enterarse
 * en medio de una conversación con un cliente no sirve de nada.
 *
 * La pantalla ya rechaza antes de subir —mide el archivo en el navegador, así
 * que un video de 27 MB no viaja— pero eso es comodidad, no la regla: lo que
 * llega a una ruta llega de afuera. La regla vive una sola vez, en
 * `@wa/shared`, y la aplican los tres: el navegador, esta ruta y el accesor.
 *
 * El producto lo valida el accesor contra la operación del panel. La operación
 * **no sale del cuerpo de la petición**: de dónde es el archivo no lo decide el
 * navegador, igual que en el alta de productos.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const productId = form?.get("productId");
  if (!(file instanceof File) || typeof productId !== "string" || !productId) {
    return Response.json(
      { error: "hacen falta el producto y el archivo" },
      { status: 400 },
    );
  }

  const filename = file.name || "archivo";
  const mime = (file.type || "application/octet-stream").toLowerCase();

  // Se pregunta por el tamaño declarado **antes** de leer los bytes: leerlos
  // para después rechazarlos es cargar en memoria del servidor un archivo que
  // ya se sabe que no entra.
  const rechazo = rechazoDeSubida({ filename, mime, byteSize: file.size });
  if (rechazo) {
    return Response.json(
      { error: rechazo.texto, motivo: rechazo.motivo },
      { status: 413 },
    );
  }

  try {
    const media = await addProductMedia(await resolvePanelOperation(), productId, {
      filename,
      mime,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json({ ok: true, media });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
