import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

export async function PUT(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const body = await req.text();
  const r = await workerFetch("/api/agent/prompt", {
    method: "PUT",
    body,
    headers: { "x-actor-email": session.user?.email ?? "" },
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
