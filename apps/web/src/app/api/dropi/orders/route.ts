import { auth } from "@/auth";
import { workerFetch } from "@/lib/worker";

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const onlyLow = url.searchParams.get("onlyLow") === "1" ? "?onlyLow=1" : "";
  const r = await workerFetch(`/api/dropi/orders${onlyLow}`);
  return new Response(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
