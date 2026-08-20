/**
 * Qué deja anotado en la conversación un mensaje que salió.
 *
 * Existe porque `unread_count` no medía lo que su nombre dice: solo lo ponía en
 * cero `markRead`, que corre cuando alguien **abre** la conversación en el
 * panel. Si el agente contestaba, o el asesor contestaba desde el celular, el
 * contador quedaba en rojo para siempre. Medido en Guatemala el 19-ago-2026: de
 * las 54 conversaciones que el panel marcaba «necesita atención», **30 ya habían
 * sido respondidas**.
 *
 * Este módulo es el segundo sitio que lo apaga, y **no reemplaza al primero**:
 * abrir la conversación también es haberla leído.
 *
 * Es puro a propósito. La escritura la hace `jobs/outbound.ts`, que es quien
 * sabe si el mensaje salió; acá solo vive la decisión, que es la parte que se
 * prueba.
 */

import type { OutboundMessage } from "@wa/db";

/**
 * Los ocho valores del enum `outbound_source`, tomados de la fila y no
 * escritos a mano: si el esquema gana un noveno, el `switch` de abajo deja de
 * compilar. Es el mismo trato que `logisticsPhase`
 * (`packages/db/src/inbox.ts`) le da a los estados logísticos.
 */
export type OutboundSource = OutboundMessage["source"];

/**
 * ¿Este saliente es **una respuesta**, o es una notificación?
 *
 * La distinción es la que le da sentido al contador: contestar apaga el rojo,
 * avisar no. Volumen en producción (Guatemala, 19-ago-2026, 18.712 filas):
 * conversacional 5.211 · notificación 13.501.
 *
 * - `agent` (4.859) y `manual` (352) son respuestas: las escribe el agente
 *   contestando, o una persona desde el panel. Son las únicas dos.
 * - `followup` (980), `remarketing` (379), `confirmation_ack` (1.528),
 *   `dropi_status` (4.542) y `dropi_2fa` (5.979) son notificaciones: salen
 *   solas, por un evento del pedido o del reloj, y que salgan no significa que
 *   alguien haya mirado la conversación.
 * - `escalation` (93) **no es conversacional, y es la que más se parece a
 *   serlo**: es el aviso de que hace falta una persona, no la respuesta de esa
 *   persona. Apagar el contador con ella sería esconder exactamente la
 *   conversación que se pidió mirar.
 */
export function esSalienteConversacional(source: OutboundSource): boolean {
  switch (source) {
    case "agent":
    case "manual":
      return true;
    case "followup":
    case "remarketing":
    case "confirmation_ack":
    case "dropi_status":
    case "dropi_2fa":
    case "escalation":
      return false;
    default: {
      // Si esto deja de compilar es que el esquema ganó un `source` nuevo y hay
      // que decidir acá de qué lado cae — no dejarlo caer en un `else`, que es
      // como se cuela una notificación apagando el contador de nadie.
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

/** Lo que cabe en la vista previa de la lista, igual que en la ingesta. */
const PREVIEW_MAX = 200;

/** Lo que hay que escribirle a la conversación. */
export interface HuellaEnLaConversacion {
  lastOutboundAt: Date;
  lastMessagePreview: string;
  /** Solo cuando el saliente fue una respuesta. Ver {@link esSalienteConversacional}. */
  unreadCount?: 0;
}

/**
 * La huella que un saliente le deja a su conversación, o `null` si no le deja
 * ninguna.
 *
 * `waId` es el identificador que devuelve Meta al aceptar el mensaje: existe
 * **solo si el mensaje salió**. Es la misma marca que usa `mirrorFailedSend`
 * para saber que el envío murió antes de irse. Sin él no hay nada que anotar:
 * encolar no es contestar, y un envío que falló no puede apagar el contador de
 * nadie ni mover la fecha del saliente.
 *
 * Las tres escrituras van juntas porque son el mismo hecho —«salió esto, en
 * este momento»— dicho de tres maneras, y separarlas es cómo se llega a que una
 * diga una cosa y la otra diga otra.
 */
export function huellaDelSaliente(args: {
  waId: string | null;
  source: OutboundSource;
  /** El cuerpo que de verdad se envió, que no siempre es el que se encoló. */
  cuerpo: string;
  ahora: Date;
}): HuellaEnLaConversacion | null {
  if (!args.waId) return null;
  return {
    lastOutboundAt: args.ahora,
    lastMessagePreview: args.cuerpo.slice(0, PREVIEW_MAX),
    // El contador se apaga **solo** con una respuesta. La fecha del saliente y
    // la vista previa, en cambio, se estampan con cualquier saliente: son «qué
    // fue lo último que salió», que es lo que la lista del panel ordena y
    // muestra, y recortarlas a lo conversacional le cambiaría el orden a la
    // bandeja de Katherine sin que nadie lo pidiera.
    ...(esSalienteConversacional(args.source) ? { unreadCount: 0 as const } : {}),
  };
}
