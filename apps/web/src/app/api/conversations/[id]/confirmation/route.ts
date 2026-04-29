import { auth } from "@/auth";
import { setConfirmationStatus, type ConfirmationStatus } from "@/lib/queries";
import { workerFetch } from "@/lib/worker";

const ALLOWED: ConfirmationStatus[] = [
  "unknown",
  "pending",
  "confirmed",
  "not_confirmed",
];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const body = (await req.json()) as { status?: string };
  const status = body.status as ConfirmationStatus | undefined;
  if (!status || !ALLOWED.includes(status)) {
    return new Response("invalid status", { status: 400 });
  }
  await setConfirmationStatus(id, status);
  // Notify worker so SSE listeners refresh.
  workerFetch(`/api/events/notify`, {
    method: "POST",
    body: JSON.stringify({
      type: "conversation.updated",
      conversationId: id,
    }),
  }).catch(() => {});
  return Response.json({ ok: true });
}
