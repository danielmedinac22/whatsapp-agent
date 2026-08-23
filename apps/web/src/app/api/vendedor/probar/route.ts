import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

/**
 * El banco de pruebas del vendedor. Proxy al worker, igual que el de Katherine.
 *
 * Va por el worker y no por la base —al revés que `/api/vendedor/settings`—
 * porque lo que hace falta está allá: la llave del proveedor del modelo, el
 * constructor del prompt efectivo y la resolución de la línea contra la tienda.
 * Que lo que se prueba sea idéntico a lo que se envía es la razón de que ese
 * constructor esté en un solo lugar.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });

  const body = await req.text();
  const r = await workerFetch("/api/vendedor/probar", {
    method: "POST",
    body,
    headers: { "x-actor-email": session.user?.email ?? "" },
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
