import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

export async function GET() {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const r = await workerFetch("/api/agent/prompt/versions");
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
