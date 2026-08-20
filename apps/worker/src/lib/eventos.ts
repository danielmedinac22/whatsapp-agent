/**
 * Las tres decisiones que rodean a un evento del stream, sin base ni reloj.
 *
 * Los cinco sitios que emiten viven repartidos —la ingesta, el saliente, el
 * acuse de entrega, el clasificador— y ninguno se puede probar sin una conexión
 * a Postgres. Lo que sí se puede probar es esto: **con qué se arma la
 * instantánea**, **a qué panel llega un evento** y **qué se hace con el aviso
 * que manda el web**. Es el mismo trato que ya tienen `resolveInbox` y
 * `sinResponder`: la escritura la hace quien sabe escribir, la decisión vive
 * aparte y con tests.
 */

import { actividadDe, type OperationId } from "@wa/db";
import { esDeLaOperacion } from "@wa/db/bandeja-viva";
import type {
  ConversationSnapshot,
  MessageStatus,
  WaEvent,
} from "@wa/shared";

/**
 * Los hechos de la conversación con los que se arma la instantánea, tal como
 * quedaron **después** de la escritura.
 *
 * Es una forma estructural y no la fila entera para que un emisor pueda
 * armarla con lo que acaba de escribir —`{ ...conv, ...loQueSeEscribio }`— sin
 * volver a leer la conversación, que es justo lo que este ticket no puede
 * costar.
 */
export interface HechosDeLaFila {
  lastMessagePreview: string | null;
  unreadCount: number;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  createdAt: Date;
}

/** El resumen de la fila que viaja en el evento. */
export function instantaneaDe(facts: HechosDeLaFila): ConversationSnapshot {
  return {
    lastMessagePreview: facts.lastMessagePreview,
    unreadCount: facts.unreadCount,
    // La misma frase que ordena la lista, no la fecha del mensaje que provocó
    // el evento. Ver `actividadDe` (`@wa/db`).
    lastActivityAt: actividadDe(facts).toISOString(),
  };
}

/**
 * Si un evento le corresponde al panel que está escuchando.
 *
 * **Es el filtro que hoy no existe.** El stream le manda todo a todos, así que
 * con dos operaciones abiertas el inbox de Guatemala se refrescaría con tráfico
 * de Colombia. Se decide acá y no solo en el cliente porque el worker ya sabe
 * qué operación pidió la pestaña —viaja en `x-operation-id` y la ruta del
 * stream ya la resolvía para el snapshot inicial—, y porque un evento que no
 * sale no hay que confiar en que nadie lo mire.
 *
 * Los dos `null` pasan, y en los dos casos es lo mismo: **no se puede probar
 * que el evento sea ajeno.**
 *
 * - Panel sin operación resuelta: la ruta se traga ese fallo a propósito, y
 *   convertirlo acá en «no llega nada» sería cambiar una pantalla degradada por
 *   una pantalla muerta.
 * - Evento sin operación: es la conversación que entró por un número que no
 *   reconocemos, que el pipeline procesa igual antes que perderla. Descartarla
 *   la volvería invisible en todos los paneles a la vez.
 *
 * `qr` y `status` no son de nadie: hablan de la conexión, no de una
 * conversación, y llegan siempre.
 *
 * **La regla vive en `@wa/db` y acá solo se la llama.** La bandeja del panel
 * tiene que aplicar la misma —una pestaña puede quedar abierta mientras el riel
 * cambia de operación sin que el `EventSource` se vuelva a abrir—, y dos copias
 * de «a quién le toca este evento» es cómo una empieza a dejar pasar lo que la
 * otra descarta.
 */
export function esParaElPanel(
  ev: WaEvent,
  operacionDelPanel: OperationId | null,
): boolean {
  return esDeLaOperacion(ev, operacionDelPanel);
}

const ESTADOS: readonly MessageStatus[] = [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
];

function esEstado(x: unknown): x is MessageStatus {
  return typeof x === "string" && (ESTADOS as readonly string[]).includes(x);
}

function esInstantanea(x: unknown): x is ConversationSnapshot {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return (
    (typeof s.lastMessagePreview === "string" || s.lastMessagePreview === null) &&
    typeof s.unreadCount === "number" &&
    typeof s.lastActivityAt === "string"
  );
}

function texto(x: unknown): string | null {
  return typeof x === "string" && x.length > 0 ? x : null;
}

/**
 * El aviso que llega por `/api/events/notify`, convertido en un evento del
 * tipo de verdad.
 *
 * Existe porque **hay un sexto emisor y no compila con los otros cinco**:
 * `apps/web` arma el aviso como objeto literal dentro de un `JSON.stringify`
 * —tomar una conversación, marcar una confirmación— y ampliar la unión no lo
 * señala. Sin este paso esos dos avisos entrarían al bus con la operación en
 * `undefined`, que no es `null`, y el filtro de {@link esParaElPanel} los
 * compararía contra la operación del panel y los tiraría: los dos botones más
 * usados de la bandeja dejarían de refrescar en producción.
 *
 * La operación sale del header `x-operation-id` que `workerFetch` ya manda, así
 * que no cuesta ninguna consulta. La instantánea llega en `null` a propósito:
 * asignar o confirmar no cambia ni la vista previa ni el contador ni la fecha,
 * y decir lo contrario le haría al cliente pisar la fila con datos que nadie
 * midió.
 *
 * Devuelve `null` cuando el cuerpo no alcanza para armar un evento; la ruta
 * responde 400, igual que antes.
 */
export function normalizarAvisoDelPanel(
  crudo: unknown,
  operacionDelPanel: OperationId | null,
): WaEvent | null {
  if (!crudo || typeof crudo !== "object") return null;
  const ev = crudo as Record<string, unknown>;

  // `qr` y `status` no son de una conversación y nadie los manda por aquí, pero
  // la ruta siempre los aceptó: se dejan pasar tal cual antes que estrenar un
  // rechazo que este ticket no necesita.
  if (ev.type === "qr") {
    const qr = texto(ev.qr);
    return qr ? { type: "qr", qr } : null;
  }
  if (ev.type === "status") {
    const status = ev.status;
    return typeof status === "string"
      ? ({ type: "status", status, phone: texto(ev.phone) ?? undefined } as WaEvent)
      : null;
  }

  const conversationId = texto(ev.conversationId);
  if (!conversationId) return null;

  // Quien mande la operación explícita manda; el header es el respaldo.
  const operationId = texto(ev.operationId) ?? operacionDelPanel;
  const conversation = esInstantanea(ev.conversation) ? ev.conversation : null;
  const messageId = texto(ev.messageId);

  switch (ev.type) {
    case "message.created":
      return messageId
        ? {
            type: "message.created",
            operationId,
            conversationId,
            messageId,
            conversation,
          }
        : null;
    case "message.status":
      return messageId && esEstado(ev.status)
        ? {
            type: "message.status",
            operationId,
            conversationId,
            messageId,
            status: ev.status,
          }
        : null;
    case "conversation.updated":
      return {
        type: "conversation.updated",
        operationId,
        conversationId,
        conversation,
      };
    default:
      return null;
  }
}
