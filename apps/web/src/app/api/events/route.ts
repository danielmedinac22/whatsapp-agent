import { auth } from "@/auth";
import { OPERATION_HEADER } from "@/lib/worker";
import { panelOperationIdCookie } from "@/lib/operation";

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:3001";
const TOKEN = process.env.WORKER_API_TOKEN ?? "";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });

  // No pasa por `workerFetch` porque el SSE necesita el `signal` y el cuerpo en
  // streaming, pero la elección de operación viaja igual: el snapshot inicial
  // reporta la conexión de la operación del riel, no la de la única activa.
  const operationId = await panelOperationIdCookie();
  const upstream = await fetch(`${WORKER_URL}/api/events`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(operationId ? { [OPERATION_HEADER]: operationId } : {}),
    },
    signal: req.signal,
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("worker unavailable", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
