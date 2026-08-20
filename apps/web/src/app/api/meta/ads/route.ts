import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

/**
 * La lista de anuncios de la cuenta publicitaria, para elegir por nombre.
 *
 * Es un reenvío al worker y no una lectura de este lado a propósito: el token
 * con `ads_read` vive en el entorno del worker y no sale de ahí. El navegador
 * recibe nombres, estados y campañas — nunca la credencial.
 */
export async function GET() {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const r = await workerFetch("/api/meta/ads");
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
