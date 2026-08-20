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
 *
 * **`esSalienteConversacional` ya no vive acá: vive en `@wa/db`.** La misma
 * frase —«esto fue contestar»— la necesita el panel para contar las
 * conversaciones **sin responder** (ticket 03), y `apps/web` no depende de
 * `@wa/worker`. Se re-exporta desde este archivo porque este sigue siendo el
 * sitio donde se pregunta al enviar, y porque mover el import de sus llamadores
 * habría sido cambiar código del ticket 02 para no cambiar nada.
 */

import { esSalienteConversacional, type OutboundSource } from "@wa/db";

export { esSalienteConversacional } from "@wa/db";
export type { OutboundSource } from "@wa/db";

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
