import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

/**
 * Buscar en la tienda para conectar un producto.
 *
 * Pasa por el worker porque las credenciales de administración viven ahí y no
 * salen: el navegador nunca ve el token. Si el worker no contesta, la respuesta
 * es el estado «no se pudo leer la tienda» y no un error crudo — con
 * `shopify_connection` vacía en producción, este camino es hoy el normal.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });

  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    const r = await workerFetch(
      `/api/catalog/store/search?q=${encodeURIComponent(q)}`,
    );
    return new Response(await r.text(), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return Response.json({
      store: "unreachable",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
