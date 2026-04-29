import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

export async function GET() {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const r = await workerFetch("/api/shopify/connection");
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const body = await req.text();
  const r = await workerFetch("/api/shopify/connection", {
    method: "PUT",
    body,
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}

export async function DELETE() {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const r = await workerFetch("/api/shopify/connection", { method: "DELETE" });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
