import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const r = await workerFetch(
    `/api/agent/prompt/versions/${encodeURIComponent(id)}`,
  );
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
