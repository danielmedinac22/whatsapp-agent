import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const body = await req.text();
  const r = await workerFetch("/api/dropi/connection/2fa/submit", {
    method: "POST",
    body,
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
