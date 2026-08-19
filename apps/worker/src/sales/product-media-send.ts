/**
 * Los apoyos visuales del vendedor: **qué archivos del producto salen en este
 * turno de la conversación, y cómo entran a la cola que ya existe.**
 *
 * El acto que este archivo construye es el del ticket 03 —«Sebastián manda las
 * fotos y videos del producto para que el lead decida con lo que ve»— y todo lo
 * que decide cabe en tres reglas:
 *
 * 1. **Solo sale lo que el admin marcó.** La lista la da
 *    `listSendableProductMedia`, que filtra por operación, producto, marca y
 *    tamaño, y **no tiene caché**: desmarcar un archivo lo saca del envío sin
 *    reinicio ni despliegue.
 * 2. **Un archivo se manda una vez por conversación.** No hay columna nueva ni
 *    estado en memoria que lo recuerde: **la memoria es el outbox**. La llave de
 *    deduplicación de cada envío es `apoyo:<conversación>:<archivo>` y está bajo
 *    índice único, así que el segundo intento no es un mensaje repetido — es una
 *    fila que no se inserta. Dos turnos que se crucen no pueden mandar la misma
 *    foto dos veces.
 * 3. **El envío es de la cola, no de este archivo.** Acá no hay `fetch`, ni
 *    reintento, ni bytes: se encola y `jobs/outbound.ts` hace el resto con sus
 *    reintentos, su deduplicación y su espejo en el hilo. Un segundo camino de
 *    envío sería un segundo lugar donde el chulo de entrega se queda pegado.
 *
 * **Por qué el tope por turno.** El admin puede marcar seis archivos, y seis
 * mensajes seguidos apenas el lead dice «hola» no es mostrar el producto, es una
 * ráfaga. Salen {@link MAX_APOYOS_POR_TURNO} por turno y el resto **queda para
 * los turnos siguientes** —no se pierde, y el log dice cuántos quedaron—, que es
 * la diferencia entre un tope y una lista truncada en silencio.
 */

import {
  inArray,
  outboundMessages,
  type Conversation,
  type Operation,
  listSendableProductMedia,
} from "@wa/db";
import { etiquetaDeEnvio, mediaKind } from "@wa/shared";
import { db } from "../db";
import { logger } from "../lib/logger";
import { enqueueOutbound } from "../jobs/outbound";

/**
 * La llave que hace que un archivo salga **una sola vez por conversación**.
 *
 * Es la regla 2 escrita en una línea: mientras la llave sea la misma, el índice
 * único de `outbound_messages.dedup_key` es el que decide, no este código.
 */
export function apoyoDedupKey(conversationId: string, mediaId: string): string {
  return `apoyo:${conversationId}:${mediaId}`;
}

/** Cuántos archivos salen como máximo en un mismo turno. */
export const MAX_APOYOS_POR_TURNO = 3;

/** Cuánto se separan entre sí los envíos de un mismo turno. */
const APOYO_STAGGER_MS = 1000;

/**
 * Qué archivos salen en este turno y cuáles quedan para después. **Puro.**
 *
 * El orden es el de subida —el que la ficha del producto muestra—, así que el
 * admin decide qué ve primero el cliente con el orden en que carga los
 * archivos, sin ninguna perilla nueva.
 */
export function decidirApoyosDelTurno<T extends { id: string }>(input: {
  archivos: readonly T[];
  /** Los que ya entraron al outbox en esta conversación, hayan salido o no. */
  yaEncolados: ReadonlySet<string>;
  max?: number;
}): { envia: T[]; pendientes: T[] } {
  const max = input.max ?? MAX_APOYOS_POR_TURNO;
  const nuevos = input.archivos.filter((a) => !input.yaEncolados.has(a.id));
  return { envia: nuevos.slice(0, max), pendientes: nuevos.slice(max) };
}

/**
 * Cuáles de estos archivos ya entraron al outbox en esta conversación.
 *
 * Pregunta por las llaves exactas y no por la conversación, para que la
 * consulta caiga en el índice único de `dedup_key` en vez de recorrer la tabla
 * de envíos entera en cada turno.
 *
 * «Encolado» y no «entregado» es a propósito: un archivo que ya se intentó y
 * murió —el número rechazó el formato, la ventana estaba cerrada— **no se
 * vuelve a intentar en la misma conversación**. Reintentarlo cada turno sería
 * repetir un fallo conocido delante del cliente.
 */
async function apoyosYaEncolados(
  conversationId: string,
  mediaIds: readonly string[],
): Promise<Set<string>> {
  if (mediaIds.length === 0) return new Set();
  const porLlave = new Map(
    mediaIds.map((id) => [apoyoDedupKey(conversationId, id), id] as const),
  );
  const rows = await db
    .select({ dedupKey: outboundMessages.dedupKey })
    .from(outboundMessages)
    .where(inArray(outboundMessages.dedupKey, [...porLlave.keys()]));
  const out = new Set<string>();
  for (const row of rows) {
    const id = porLlave.get(row.dedupKey);
    if (id) out.add(id);
  }
  return out;
}

/**
 * Encola los apoyos visuales que le tocan a este turno de la conversación.
 *
 * **No lanza nunca**: el llamador acaba de encolar la respuesta de Sebastián, y
 * un problema con los archivos no puede costarle al lead la respuesta que ya
 * estaba escrita. Es el criterio «un fallo de envío de un archivo no interrumpe
 * la venta ni deja al lead sin respuesta», sostenido en el único punto donde el
 * fallo podría propagarse.
 *
 * Sin producto identificado no manda nada: los archivos cuelgan del producto, y
 * mientras la conversación no sepa de cuál habla no hay ninguno que le
 * corresponda.
 */
export async function enqueueApoyosVisuales(input: {
  operation: Operation;
  conversation: Conversation;
  /** Destino, en la forma que ya resolvió el runner. */
  to: string;
}): Promise<{ encolados: number; pendientes: number }> {
  const vacio = { encolados: 0, pendientes: 0 };
  const productId = input.conversation.productId;
  if (!productId) return vacio;

  try {
    const archivos = await listSendableProductMedia(input.operation, productId);
    if (archivos.length === 0) return vacio;

    const yaEncolados = await apoyosYaEncolados(
      input.conversation.id,
      archivos.map((a) => a.id),
    );
    const { envia, pendientes } = decidirApoyosDelTurno({ archivos, yaEncolados });
    if (envia.length === 0) return { encolados: 0, pendientes: pendientes.length };

    let encolados = 0;
    for (const [i, archivo] of envia.entries()) {
      // Escalonados: los trabajos de la cola corren en paralelo, y sin esto los
      // archivos pueden adelantarse al mensaje de texto que los presenta.
      await enqueueOutbound({
        to: input.to,
        body: etiquetaDeEnvio(archivo.filename, archivo.mime),
        source: "agent",
        dedupKey: apoyoDedupKey(input.conversation.id, archivo.id),
        conversationId: input.conversation.id,
        productMedia: { id: archivo.id, kind: mediaKind(archivo.mime) },
        delayMs: (i + 1) * APOYO_STAGGER_MS,
      });
      encolados += 1;
    }

    logger.info(
      {
        conversationId: input.conversation.id,
        productId,
        encolados,
        pendientes: pendientes.length,
      },
      "ventas: apoyos visuales encolados",
    );
    return { encolados, pendientes: pendientes.length };
  } catch (err) {
    logger.error(
      { err, conversationId: input.conversation.id, productId },
      "ventas: no se pudieron encolar los apoyos visuales; la conversación sigue",
    );
    return vacio;
  }
}
