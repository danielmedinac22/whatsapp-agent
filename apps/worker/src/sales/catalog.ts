/**
 * El borde entre la base y la cascada de reconocimiento.
 *
 * `recognition.ts` es puro y sus tipos son estructurales a propósito: no
 * importa `@wa/db`, para poder probarse sin base. Este archivo es el adaptador
 * —lee el catálogo y el mapeo de anuncios **de la operación** y los traduce a
 * esas formas— y es lo único de ventas que consulta tablas. La cascada no se
 * toca: ni su firma ni su lógica.
 *
 * **El catálogo consultado es siempre el de la operación.** Un lead
 * guatemalteco nunca se resuelve contra productos colombianos, aunque el
 * anuncio estuviera mal etiquetado: la consulta filtra por operación y, además,
 * la cascada descarta los ids del mapeo que no estén en ese catálogo.
 */

import { and, eq } from "@wa/db";
import { productAds, products, type OperationId } from "@wa/db";
import { db } from "../db";
import type { ParsedAdReferral } from "../kapso/inbound";
import {
  recognizeProduct,
  type AdProductMapping,
  type CatalogProduct,
  type ProductRecognition,
  type SemanticMatcher,
} from "./recognition";

/**
 * Si el nivel 2 de la cascada —el match semántico del copy del anuncio contra
 * el catálogo— está cableado. **Todavía no**: el matcher real llama a un modelo
 * y es del ticket 05, junto con la pregunta al lead.
 *
 * Se exporta para que el log lo diga y nadie lea un `low-confidence` como «el
 * modelo miró el anuncio y no supo»: hoy significa «el anuncio no está
 * registrado y nadie más miró».
 */
export const SEMANTIC_LEVEL_WIRED = false;

/**
 * El hueco del nivel 2 hasta que llegue el matcher real. Devuelve cero
 * candidatos: sin candidatos la cascada no puede resolver ni quedar ambigua por
 * texto, así que hoy solo resuelve por id de anuncio — que es exactamente el
 * alcance del ticket 04.
 */
const NO_SEMANTIC_MATCHER: SemanticMatcher = () => [];

/**
 * El catálogo de una operación, en la forma que la cascada espera.
 *
 * `name` sale vacío para los productos conectados a la tienda: esa columna es
 * nula a propósito —el nombre se lee de Shopify en tiempo de uso para que
 * editarlo allá se refleje acá— y este módulo no consulta la tienda. Al nivel 1
 * no le importa (compara ids de anuncio), pero **el matcher semántico del
 * ticket 05 tendrá que resolver los nombres contra Shopify antes de matchear**,
 * o le estaría preguntando a un modelo por productos sin nombre.
 */
export async function loadCatalog(
  operationId: OperationId,
): Promise<CatalogProduct[]> {
  const rows = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(eq(products.operationId, operationId));
  return rows.map((row) => ({ id: row.id, name: row.name ?? "" }));
}

/**
 * Los productos que el admin asoció a un anuncio, **dentro de esta operación**.
 * Una fila por par (anuncio, producto); la cascada las junta sola.
 */
export async function loadAdMappings(
  operationId: OperationId,
  adId: string,
): Promise<AdProductMapping[]> {
  const rows = await db
    .select({ adId: productAds.adId, productId: productAds.productId })
    .from(productAds)
    .where(
      and(
        eq(productAds.operationId, operationId),
        eq(productAds.adId, adId.trim()),
      ),
    );
  return rows.map((row) => ({ adId: row.adId, productIds: [row.productId] }));
}

/**
 * De qué producto le escriben, para una referencia de anuncio recién llegada.
 *
 * Sin id de anuncio no se consulta el mapeo —no hay con qué buscar— y la
 * cascada cae sola al nivel siguiente.
 */
export async function recognizeProductForReferral(input: {
  operationId: OperationId;
  referral: ParsedAdReferral;
}): Promise<ProductRecognition> {
  const { referral } = input;
  const [catalog, adMappings] = await Promise.all([
    loadCatalog(input.operationId),
    referral.adId
      ? loadAdMappings(input.operationId, referral.adId)
      : Promise.resolve<AdProductMapping[]>([]),
  ]);
  return recognizeProduct({
    referral: {
      adId: referral.adId,
      headline: referral.headline,
      body: referral.body,
    },
    catalog,
    adMappings,
    matchSemantically: NO_SEMANTIC_MATCHER,
  });
}
