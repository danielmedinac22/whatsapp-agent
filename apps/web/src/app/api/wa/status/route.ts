import { workerFetch } from "@/lib/worker";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const res = await workerFetch("/api/wa/status");
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
