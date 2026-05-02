import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

export async function POST() {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const r = await workerFetch("/api/dropi/connection/refresh", {
    method: "POST",
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
