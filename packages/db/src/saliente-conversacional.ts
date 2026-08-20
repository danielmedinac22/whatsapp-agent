/**
 * **Cuál de los ocho salientes es una respuesta**, y cuál es una notificación.
 *
 * Vive en `@wa/db` y no en el worker porque los dos lados de la pregunta la
 * necesitan: el worker decide con ella si apagar el contador al enviar
 * (`inbox/saliente-conversacional.ts`, ticket 02) y el panel decide con ella si
 * una conversación quedó **sin responder** (ticket 03). Es una sola frase —«esto
 * fue contestar»— y dos copias de ella es cómo nacen dos respuestas a la misma
 * pregunta: exactamente el error que el ticket 01 acaba de arreglar en tres
 * sitios con el listón del vendedor.
 *
 * `apps/web` no depende de `@wa/worker` —ni puede, son dos aplicaciones
 * hermanas—, así que el único sitio compartido es este paquete.
 *
 * Es puro y no toca la base: acá vive la decisión, que es la parte que se
 * prueba. Las escrituras siguen donde estaban.
 */

import { outboundSource, type OutboundMessage } from "./schema";

/**
 * Los ocho valores del enum `outbound_source`, tomados de la fila y no
 * escritos a mano: si el esquema gana un noveno, el `switch` de abajo deja de
 * compilar. Es el mismo trato que `logisticsPhase` (`./inbox.ts`) le da a los
 * estados logísticos.
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

/**
 * Los `source` conversacionales, para llevarlos a un `where … in (…)`.
 *
 * **Se deriva de {@link esSalienteConversacional}, no se escribe al lado.** Una
 * consulta que ponga `in ('agent','manual')` a mano es la segunda copia del
 * listón, y esa copia no deja de compilar el día que un `source` nuevo cambie
 * de lado. Los valores salen del enum del esquema —no de una lista a mano—, así
 * que un `source` nuevo entra por acá solo, y el `switch` exhaustivo obliga a
 * decidir de qué lado cae antes de que compile.
 */
export const SALIENTES_CONVERSACIONALES: readonly OutboundSource[] =
  outboundSource.enumValues.filter(esSalienteConversacional);
