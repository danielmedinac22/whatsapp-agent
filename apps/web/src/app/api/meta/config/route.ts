import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

/** Qué cuenta publicitaria y qué dataset tiene configurados esta operación. */
export async function GET() {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const r = await workerFetch("/api/meta/config");
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const r = await workerFetch("/api/meta/config", {
    method: "PUT",
    body: await req.text(),
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
