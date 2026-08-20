import { auth } from "@/auth";
import { setAssignment } from "@/lib/queries";
import { resolvePanelOperation } from "@/lib/operation";
import { workerFetch } from "@/lib/worker";

/**
 * Tomar y soltar una conversación: «esta la estoy trabajando yo».
 *
 * **Quien toma es siempre el de la sesión**, y el cuerpo no puede decir otra
 * cosa: aceptar un `userId` sería dejar que cualquiera asigne conversaciones a
 * nombre de un compañero, y lo que el ticket pide es que el equipo vea quién la
 * tiene, no que alguien decida por otro. Soltar sí lo puede hacer cualquiera
 * del equipo —una conversación que quedó tomada por quien se fue a almorzar
 * tiene que poder liberarse—, y por eso `on: false` no compara usuarios.
 *
 * No toca el modo agente. Son cosas independientes: se puede estar asignado sin
 * haber pausado al vendedor, y ese control es el botón «Agente: ON/OFF» que ya
 * existe.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const body = (await req.json()) as { on?: boolean };
  const userId = session.user.id;
  if (body.on && !userId) {
    // Una sesión sin id es un token viejo: no se puede registrar quién la
    // trabaja, y registrar a nadie sería peor que no registrar.
    return new Response("session without user id", { status: 409 });
  }

  // Una conversación que esta operación no atiende no existe para esta pestaña.
  const written = await setAssignment(
    await resolvePanelOperation(),
    id,
    body.on ? userId! : null,
  );
  if (!written) return new Response("not found", { status: 404 });

  // Que el resto del equipo lo vea **antes de escribir** es el criterio del
  // ticket, así que el aviso sale por el mismo canal que refresca la bandeja.
  workerFetch(`/api/events/notify`, {
    method: "POST",
    body: JSON.stringify({ type: "conversation.updated", conversationId: id }),
  }).catch(() => {});

  /**
   * La fila tal como quedó, para que la bandeja la reescriba sin recargarse.
   *
   * Va en la respuesta y no lo deduce el cliente porque **quién la trabaja lo
   * decide este endpoint**, no quien pulsa: tomar es siempre el de la sesión y
   * soltar lo puede hacer cualquiera del equipo. La etiqueta es la misma regla
   * que usa la lista —el nombre, y el correo si no hay nombre—, así que la fila
   * dice lo mismo antes y después del próximo render del servidor.
   */
  const assignedTo = body.on
    ? {
        id: userId!,
        label: session.user.name ?? session.user.email ?? userId!,
      }
    : null;
  return Response.json({ ok: true, assignedTo });
}
