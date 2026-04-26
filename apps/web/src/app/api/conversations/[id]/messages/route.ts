import { auth } from "@/auth";
import { listMessages, markRead } from "@/lib/queries";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const msgs = await listMessages(id);
  await markRead(id);
  return Response.json({ messages: msgs });
}
