import { workerFetch } from "@/lib/worker";
import { conQuienEnvia } from "@/lib/quien-envia";
import { auth } from "@/auth";

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const body = conQuienEnvia(await req.text(), session.user.id ?? null);
  const res = await workerFetch("/api/wa/send-template", {
    method: "POST",
    body,
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
