import { auth } from "@/auth";
import { setConfirmationStatus, type ConfirmationStatus } from "@/lib/queries";
import { workerFetch } from "@/lib/worker";
import { resolvePanelOperation } from "@/lib/operation";

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
  // La confirmación es la decisión que dispara la logística: si la conversación
  // no es de esta operación no se escribe **y no se avisa al worker**, que es
  // lo que evita confirmarle a la logística del país equivocado.
  const written = await setConfirmationStatus(
    await resolvePanelOperation(),
    id,
    status,
  );
  if (!written) return new Response("not found", { status: 404 });
  if (status === "confirmed") {
    workerFetch(`/api/dropi/confirm-by-conversation`, {
      method: "POST",
      body: JSON.stringify({ conversationId: id }),
    }).catch(() => {});
  }
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
