import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

/**
 * El estado de la tienda de la operación elegida: si está conectada, qué
 * permite el token y si la escritura está encendida.
 *
 * Va por el worker y no por la base porque **el token no sale del worker**: el
 * navegador nunca lo recibe, y para saber qué permisos concede hay que
 * preguntárselo a la tienda con él.
 */
export async function GET() {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const r = await workerFetch("/api/tienda/store/status");
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
