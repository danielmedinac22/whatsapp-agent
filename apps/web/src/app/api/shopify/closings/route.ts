import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

/**
 * Los cierres que no llegaron a la tienda, con su motivo.
 *
 * Viven en las colas de pg-boss, en el esquema del worker, así que el panel no
 * los puede leer con el accesor de `@wa/db` como lee el resto.
 */
export async function GET() {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const r = await workerFetch("/api/tienda/closings");
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
