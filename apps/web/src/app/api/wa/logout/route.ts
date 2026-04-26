import { workerFetch } from "@/lib/worker";
import { auth } from "@/auth";

export async function POST() {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const res = await workerFetch("/api/wa/logout", { method: "POST" });
  return new Response(await res.text(), { status: res.status });
}
