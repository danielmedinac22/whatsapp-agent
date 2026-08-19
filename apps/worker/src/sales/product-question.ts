/**
 * La pregunta al lead: **de cuál de estos productos me estás hablando**.
 *
 * Es el nivel 3 de la cascada —el que `recognition.ts` describe y a propósito no
 * implementa: *«preguntar. No vive aquí»*—, y la mitad de
 * `ventas-ingesta-reconocimiento/05` que faltaba. Lo que hacía falta para poder
 * construirla era el ticket 06: sin los candidatos registrados, una pregunta
 * «con lista corta acotada a los candidatos» no tiene de dónde sacarlos, y lo
 * único que se podía ofrecer era el catálogo entero — que en Vorare son los
 * cuatro REVITALHAIR más todo lo demás.
 *
 * **Se pregunta con el prompt, no con un mensaje aparte.** Sebastián ya escribe
 * cada turno; meterle una segunda vía de salida sería un mensaje que se cruza
 * con el suyo en el mismo hilo. Este archivo compone el bloque de contexto que
 * se pega al prompt efectivo, igual que el bloque del producto identificado
 * (`product-context.ts`), y el modelo lo pregunta con sus palabras y su tono.
 *
 * **Los dos son excluyentes**: si el producto está identificado hay ficha y no
 * hay pregunta; si no lo está hay pregunta y no hay ficha. Un prompt con las
 * dos cosas sería pedirle al modelo que pregunte por lo que ya sabe.
 */

import { and, eq, inArray, products, type Operation } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { getProductsByIds } from "../shopify/admin";
import { shopifyProductIdKey } from "./catalog";

/**
 * Cuántos candidatos caben en una lista corta de WhatsApp.
 *
 * **Constante del sistema, no campo del panel**, igual que el umbral de
 * confianza del reconocimiento y los dos intentos del escalamiento: cada
 * perilla es superficie de falla y soporte no cotizado.
 *
 * Cinco es donde una lista deja de leerse en un teléfono. Por encima de eso la
 * pregunta se hace **abierta**, no recortada: mostrarle al lead cinco de nueve
 * candidatos sería elegir por él los cinco, que es la única cosa que toda esta
 * cascada existe para no hacer. Un anuncio mapeado a más de cinco productos
 * además no es un caso de ambigüedad: es un anuncio mal registrado, y eso se
 * arregla en el catálogo.
 */
export const MAX_LISTA_CORTA = 5;

/**
 * El bloque que le dice a Sebastián que pregunte. **Puro.**
 *
 * Recibe **un nombre por candidato registrado**, con `null` en el que no se
 * pudo nombrar (borrado del catálogo, o conectado a una tienda que no
 * respondió), y decide entre dos preguntas:
 *
 * - **Con lista corta**, cuando se pudieron nombrar *todos* los candidatos y
 *   son entre dos y {@link MAX_LISTA_CORTA}.
 * - **Abierta**, en cualquier otro caso: sin candidatos —el lead llegó sin
 *   anuncio, o el anuncio no está registrado—, con demasiados, o cuando alguno
 *   no se pudo nombrar.
 *
 * Que **una lista incompleta caiga a la pregunta abierta** es la misma regla de
 * la cascada dicha en la pantalla: ofrecerle al lead tres de los cuatro
 * candidatos es empujarlo a elegir entre esos tres, o sea elegir por él con
 * pasos de más. Si no se pueden nombrar todos, no se nombra ninguno.
 */
export function renderProductQuestionBlock(
  candidates: readonly (string | null)[],
): string {
  const nombres = candidates.filter((n): n is string => Boolean(n?.trim()));
  const listable =
    nombres.length === candidates.length &&
    nombres.length >= 2 &&
    nombres.length <= MAX_LISTA_CORTA;

  const lines: string[] = [];
  lines.push("## Todavía no sabes de qué producto te escriben");
  if (listable) {
    lines.push(
      "El anuncio por el que llegó esta persona apunta a varios productos y el sistema no pudo decidir cuál es. Estos son los únicos posibles:",
    );
    for (const nombre of nombres) lines.push(`- ${nombre}`);
    lines.push("");
    lines.push(
      "Antes de hablar de precio, características o disponibilidad, pregúntale cuál de esos es el que le interesa. Una sola pregunta, corta, nombrándoselos tal como están escritos arriba. No ofrezcas ninguno que no esté en la lista y no elijas tú por él, ni siquiera si uno te parece el más probable.",
    );
  } else {
    lines.push(
      "No sabes qué producto le interesa a esta persona. Antes de hablar de precio, características o disponibilidad, pregúntaselo: una sola pregunta, corta y abierta.",
    );
    lines.push(
      "No le propongas productos ni le des una lista: no tienes ninguna que ofrecerle, y nombrar uno al azar es venderle el que no era.",
    );
  }
  lines.push("");
  lines.push(
    "Mientras no te lo diga, no describas ningún producto ni des por hecho cuál es. Lo que sí puedes hacer es saludar, responder lo que no dependa del producto y llevar la conversación.",
  );
  return lines.join("\n");
}

/** Un uuid con guiones, que es lo que la `0026` guarda en la lista. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Los nombres de los candidatos registrados, **en el orden en que la cascada
 * los dejó** y uno por cada id: `null` en el que ya no se puede nombrar.
 *
 * El orden se conserva porque es orden de presentación —el de la cascada, que
 * en los dos niveles termina siendo el del catálogo— y reordenarlos al leerlos
 * sería cambiar la lista que se le ofrece al lead.
 *
 * **La operación se verifica contra la fila**, como en todos los accesores desde
 * la migración: `product_candidate_ids` es una lista suelta sin clave foránea
 * —jsonb no la admite—, así que la pertenencia se comprueba aquí. Un id de otra
 * operación se lee como un candidato que no se puede nombrar, y con eso la
 * pregunta se vuelve abierta en vez de ofrecerle a un guatemalteco un producto
 * colombiano.
 *
 * Los conectados a la tienda se resuelven **en tiempo de uso**, como el bloque
 * del producto identificado: `products.name` es nulo para ellos a propósito. Si
 * la tienda no responde, esos candidatos quedan sin nombre y la pregunta sale
 * abierta — que es preferible a ofrecer una lista a medias.
 */
export async function loadCandidateNames(
  op: Operation,
  candidateIds: readonly string[] | null,
): Promise<(string | null)[]> {
  const ids = (candidateIds ?? []).filter((id) => UUID.test(id));
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      shopifyProductId: products.shopifyProductId,
    })
    .from(products)
    .where(and(eq(products.operationId, op.id), inArray(products.id, ids)));
  const byId = new Map(rows.map((row) => [row.id, row]));

  // Una sola llamada a la tienda para todos los conectados, con la caché de
  // diez minutos que ya usa el bloque de producto. Sin tienda, `getProductsByIds`
  // devuelve vacío y esos candidatos se quedan sin nombre.
  const shopifyIds = rows
    .map((row) => row.shopifyProductId)
    .filter((id): id is string => id !== null);
  const live =
    shopifyIds.length > 0
      ? await getProductsByIds(op, shopifyIds).catch((err) => {
          logger.warn(
            { err: String(err), operationId: op.id },
            "ventas: la tienda no respondió por los candidatos; la pregunta sale abierta",
          );
          return [];
        })
      : [];
  // La tienda devuelve el id en forma de GID; la columna acepta las dos formas
  // (`getProductsByIds` normaliza al pedir). Se compara por la parte numérica
  // para que un catálogo cargado con el id corto encuentre igual su nombre.
  const titleByShopifyId = new Map(
    live.map((p) => [shopifyProductIdKey(p.id), p.title]),
  );

  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) return null;
    if (row.shopifyProductId) {
      return titleByShopifyId.get(shopifyProductIdKey(row.shopifyProductId)) ?? null;
    }
    return row.name?.trim() || null;
  });
}

/**
 * El bloque de la pregunta para una conversación **sin producto identificado**.
 *
 * Quien llama ya sabe que no hay producto: con producto va la ficha y no esta
 * pregunta.
 */
export async function buildProductQuestionBlock(
  op: Operation,
  candidateIds: readonly string[] | null,
): Promise<string> {
  return renderProductQuestionBlock(await loadCandidateNames(op, candidateIds));
}
