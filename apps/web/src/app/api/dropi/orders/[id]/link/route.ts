import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const body = await req.text();
  const r = await workerFetch(`/api/dropi/orders/${id}/link`, {
    method: "POST",
    body,
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
