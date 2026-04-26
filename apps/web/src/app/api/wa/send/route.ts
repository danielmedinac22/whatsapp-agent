import { workerFetch } from "@/lib/worker";
import { auth } from "@/auth";

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const body = await req.text();
  const res = await workerFetch("/api/wa/send", { method: "POST", body });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
