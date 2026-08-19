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
import { getOperationById } from "../operations";
import { logger } from "../lib/logger";
import type { ParsedAdReferral } from "../kapso/inbound";
import { getProductsByIds } from "../shopify/admin";
import {
  recognizeProduct,
  type AdProductMapping,
  type CatalogProduct,
  type ProductRecognition,
  type SemanticMatcher,
} from "./recognition";
import { matchAdCopyToCatalog } from "./semantic-match";

/**
 * Cuánto se espera a la tienda por los nombres que faltan, antes de matchear
 * sin ellos.
 *
 * Es la **única** llamada de red del reconocimiento, y corre en el camino de
 * entrada de todo mensaje. Si la tienda tarda, el producto conectado se queda
 * sin nombre y no se propone: el resultado cae a *desconocido* y el vendedor
 * pregunta abierto, que es exactamente lo que ya hacía ayer. Vencer el plazo no
 * puede costarle el turno al lead.
 */
const SHOPIFY_NAME_TIMEOUT_MS = 2_000;

/**
 * El último tramo de un GID de Shopify (`gid://shopify/Product/NNN`), o el id
 * tal cual si ya viene numérico. La columna acepta las dos formas, así que la
 * comparación se hace siempre por acá.
 */
export function shopifyProductIdKey(id: string): string {
  return id.split("/").pop() ?? id;
}

/** Lo que hace falta de una fila del catálogo para poder nombrarla. */
interface CatalogRow {
  readonly id: string;
  readonly name: string | null;
  readonly shopifyProductId: string | null;
}

/**
 * Una promesa con plazo. Al vencer devuelve el valor de repuesto en vez de
 * seguir esperando; la promesa original queda corriendo sola y su resultado se
 * descarta.
 */
function conPlazo<T>(promesa: Promise<T>, ms: number, alVencer: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const vencimiento = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(alVencer), ms);
  });
  return Promise.race([promesa, vencimiento]).finally(() => clearTimeout(timer));
}

/**
 * El catálogo con los nombres que faltaban resueltos contra la tienda.
 *
 * `products.name` es nulo para los conectados a propósito —el nombre se lee de
 * Shopify en tiempo de uso para que editarlo allá se refleje acá—, y sin
 * resolverlo el nivel semántico estaría comparando el anuncio contra productos
 * sin nombre: invisibles, siempre. Es la deuda que dejó anotada el ticket 04.
 *
 * Se resuelve **acá y no en {@link loadCatalog}** porque este es el único punto
 * del sistema que necesita los nombres: el nivel 1 compara ids de anuncio y no
 * mira un solo nombre. Así el camino común —anuncio registrado— no le agrega ni
 * una llamada de red al mensaje entrante.
 *
 * Si la tienda no responde, no está conectada o se pasa del plazo, esos
 * productos se quedan sin nombre y no se proponen. Nunca lanza.
 */
async function conNombresDeLaTienda(
  operationId: OperationId,
  rows: readonly CatalogRow[],
  catalog: readonly CatalogProduct[],
): Promise<CatalogProduct[]> {
  const pendientes = rows.filter(
    (r) => r.shopifyProductId !== null && !(r.name ?? "").trim(),
  );
  if (pendientes.length === 0) return [...catalog];

  const op = await getOperationById(operationId).catch(() => null);
  if (!op) return [...catalog];
  const vivos = await conPlazo(
    getProductsByIds(
      op,
      pendientes.map((r) => r.shopifyProductId!),
    ),
    SHOPIFY_NAME_TIMEOUT_MS,
    [],
  ).catch(() => []);
  if (vivos.length === 0) return [...catalog];

  const tituloPorId = new Map(
    vivos.map((p) => [shopifyProductIdKey(p.id), p.title]),
  );
  const nombrePorProducto = new Map<string, string>();
  for (const r of pendientes) {
    const titulo = tituloPorId.get(shopifyProductIdKey(r.shopifyProductId!));
    if (titulo) nombrePorProducto.set(r.id, titulo);
  }
  return catalog.map((p) => ({
    id: p.id,
    name: nombrePorProducto.get(p.id) ?? p.name,
  }));
}

/**
 * El nivel 2 de la cascada, listo para inyectar: resuelve los nombres que
 * faltan y compara el copy del anuncio contra ellos
 * (`sales/semantic-match.ts`, que es puro y no llama a ningún modelo).
 *
 * **No lanza nunca, y es deliberado.** La cascada deja subir la excepción de un
 * matcher —«quien orquesta decide»— y quien orquesta es el pipeline de entrada,
 * que la atraparía perdiendo también el registro del reconocimiento: la
 * conversación quedaría diciendo «todavía no corrió» cuando en realidad corrió
 * y falló. Devolver cero candidatos deja *desconocido* registrado, que es la
 * misma pregunta abierta al lead, y el fallo queda en el log.
 */
function semanticMatcherFor(
  operationId: OperationId,
  rows: readonly CatalogRow[],
): SemanticMatcher {
  return async (ad, catalog) => {
    try {
      return matchAdCopyToCatalog(
        ad,
        await conNombresDeLaTienda(operationId, rows, catalog),
      );
    } catch (err) {
      logger.error(
        { err: String(err), operationId },
        "ventas: el nivel semántico falló; el anuncio queda sin producto y el vendedor pregunta",
      );
      return [];
    }
  };
}

/**
 * Las filas del catálogo de una operación, tal como están en la base.
 *
 * `name` viene nulo para los conectados a la tienda —esa columna es nula a
 * propósito, el nombre se lee de Shopify en tiempo de uso— y por eso se
 * arrastra también `shopify_product_id`: es lo que permite resolverlos después,
 * y solo cuando hace falta ({@link conNombresDeLaTienda}).
 */
async function loadCatalogRows(
  operationId: OperationId,
): Promise<CatalogRow[]> {
  return db
    .select({
      id: products.id,
      name: products.name,
      shopifyProductId: products.shopifyProductId,
    })
    .from(products)
    .where(eq(products.operationId, operationId));
}

/** Una fila del catálogo en la forma estructural que la cascada espera. */
function toCatalogProduct(row: CatalogRow): CatalogProduct {
  return { id: row.id, name: row.name ?? "" };
}

/**
 * El catálogo de una operación, en la forma que la cascada espera.
 *
 * `name` sale vacío para los productos conectados a la tienda. Al nivel 1 no le
 * importa —compara ids de anuncio—, y el nivel 2 los resuelve él mismo contra
 * Shopify justo antes de comparar, que es la deuda que había dejado anotada el
 * ticket 04.
 */
export async function loadCatalog(
  operationId: OperationId,
): Promise<CatalogProduct[]> {
  return (await loadCatalogRows(operationId)).map(toCatalogProduct);
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
  const [rows, adMappings] = await Promise.all([
    loadCatalogRows(input.operationId),
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
    catalog: rows.map(toCatalogProduct),
    adMappings,
    // El matcher se arma con las filas, no solo con el catálogo: necesita el id
    // de Shopify para poder nombrar a los conectados. La cascada solo lo llama
    // si el anuncio no está registrado, así que el camino común no paga nada.
    matchSemantically: semanticMatcherFor(input.operationId, rows),
  });
}
