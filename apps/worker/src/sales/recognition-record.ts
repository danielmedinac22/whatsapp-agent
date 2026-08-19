/**
 * Cómo se **registra** lo que la cascada decidió.
 *
 * La cascada (`recognition.ts`) es pura y fija: devuelve resuelto, ambiguo con
 * candidatos, o desconocido, y este archivo no cambia ni una de esas
 * decisiones — solo las escribe. La separación es la misma de siempre en este
 * módulo: `recognition.ts` decide, `catalog.ts` lee la base para poder decidir,
 * y esto escribe el resultado.
 *
 * ## Por qué hace falta escribirlo
 *
 * Hasta la `0026` lo único que se persistía era `conversations.product_id`, y
 * con `null` la base contaba igual **tres historias distintas**: la cascada
 * quedó ambigua, no encontró candidatos, o todavía no corrió. Las dos primeras
 * piden cosas **opuestas** del asesor —desempatar entre los cuatro REVITALHAIR
 * versus ir a cargar el anuncio al catálogo—, así que mostrarlas iguales lo
 * manda a hacer lo que no es (`ventas-ingesta-reconocimiento/06`).
 *
 * ## Las dos reglas que este archivo hace cumplir
 *
 * 1. **El producto solo se escribe cuando la cascada resolvió.** Elegir uno de
 *    varios candidatos es mandarle al cliente información del SKU equivocado.
 *    Y cuando no resolvió, la columna **no se toca**: un recomprador que hace
 *    clic en un anuncio nuevo que no sabemos reconocer conserva el producto que
 *    ya tenía. Borrarlo sería perder un dato cierto por culpa de uno incierto.
 * 2. **Si registrar falla, el mensaje entrante sigue.** El reconocimiento corre
 *    en el camino de entrada de todo mensaje, que es el que factura: un `await`
 *    que lanza ahí deja la operación muda. Por eso {@link registerRecognition}
 *    **no lanza nunca** y devuelve si quedó escrito.
 */

import type { RecognitionOutcome } from "@wa/db";
import type { ProductRecognition } from "./recognition";

/**
 * Lo que hay que escribir en la conversación. Son exactamente las columnas de
 * la `0026` más `product_id`, en la forma que espera un `update ... set`.
 *
 * `productId` es opcional y **nunca `null`**: ausente significa «no toques la
 * columna», que es distinto de «bórrala». Ver la regla 1 de arriba.
 */
export interface RecognitionRecord {
  readonly productRecognition: RecognitionOutcome;
  readonly productCandidateIds: string[] | null;
  readonly productId?: string;
}

/**
 * El resultado de la cascada, traducido a lo que va a la base. **Puro.**
 *
 * El vocabulario que se guarda es el de la cascada —`resolved`, `ambiguous`,
 * `unknown`— y no una traducción: una copia con otras palabras sería una lista
 * más que mantener de acuerdo, y el `check` de la `0026` la cierra a esos tres.
 *
 * El nivel (`ad-id` o `semantic`) y el motivo del desconocido no se guardan: son
 * telemetría del log, no algo que la pantalla ni la pregunta al lead usen. Los
 * candidatos sí, porque sin ellos «ambiguo» no se puede ni mostrar ni preguntar.
 */
export function recognitionRecord(
  recognition: ProductRecognition,
): RecognitionRecord {
  switch (recognition.kind) {
    case "resolved":
      return {
        productRecognition: "resolved",
        productCandidateIds: null,
        productId: recognition.product.id,
      };
    case "ambiguous":
      return {
        productRecognition: "ambiguous",
        // En el orden en que la cascada los presenta: el nivel 1 los da en el
        // orden del catálogo y el nivel 2 de mayor a menor confianza. Es orden
        // de presentación para la lista corta, no un ranking para elegir.
        productCandidateIds: recognition.candidates.map((c) => c.id),
      };
    case "unknown":
      return { productRecognition: "unknown", productCandidateIds: null };
  }
}

/**
 * Registra el resultado, y **nunca lanza**.
 *
 * Devuelve `true` si quedó escrito. Ante un fallo avisa por `onFailure` y
 * devuelve `false`: el mensaje del cliente ya está guardado y anunciado al
 * panel cuando esto corre, y perderlo por no poder anotar cómo terminó un
 * reconocimiento sería cambiarle a la operación lo que más importa por lo que
 * menos. Lo que se pierde es la anotación, y la conversación queda diciendo
 * «no corrió», que es el estado que hace que el asesor pregunte.
 *
 * La escritura entra inyectada para que esta regla se pueda probar sin base,
 * que es la única forma de probar de verdad el caso que importa: el que falla.
 */
export async function registerRecognition(input: {
  recognition: ProductRecognition;
  save: (record: RecognitionRecord) => Promise<unknown>;
  onFailure?: (err: unknown) => void;
}): Promise<boolean> {
  try {
    await input.save(recognitionRecord(input.recognition));
    return true;
  } catch (err) {
    input.onFailure?.(err);
    return false;
  }
}
