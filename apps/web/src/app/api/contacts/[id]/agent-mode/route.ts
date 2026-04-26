import { auth } from "@/auth";
import { setAgentMode } from "@/lib/queries";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const body = (await req.json()) as { on?: boolean };
  await setAgentMode(id, !!body.on);
  return Response.json({ ok: true });
}
