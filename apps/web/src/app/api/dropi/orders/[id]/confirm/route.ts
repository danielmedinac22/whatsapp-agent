import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const r = await workerFetch(`/api/dropi/orders/${id}/confirm`, {
    method: "POST",
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
