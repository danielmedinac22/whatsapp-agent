import { eq } from "@wa/db";
import {
  shopifyConnection,
  type Operation,
  type ShopifyConnection,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { OperationScopedCache } from "../operations";
import {
  adminTokenFor,
  credentialGapText,
  invalidateMintedTokens,
  mintedScopesFor,
  storeCredential,
  type CredentialFields,
} from "./token";

interface CacheEntry<T> {
  value: T;
  expires: number;
}

/**
 * Caché de producto, indexada por operación.
 *
 * Los ids de producto de Shopify son por tienda: dos tiendas pueden tener el
 * producto `12345`. Sin la operación en la clave, el producto de una operación
 * respondería por el de la otra — el catálogo equivocado en el prompt del
 * agente, sin error ni fallo visible.
 */
const productCache = new Map<string, CacheEntry<ShopifyProduct>>();
const PRODUCT_TTL_MS = 10 * 60 * 1000;

function productCacheKey(op: Operation, gid: string): string {
  return `${op.id}:${gid}`;
}

const connectionCache = new OperationScopedCache<ShopifyConnection | null>(
  30 * 1000,
);

/**
 * La tienda de una operación.
 *
 * **Estricta**, igual que la conexión de WhatsApp: una operación sin tienda
 * propia devuelve `null`, nunca la tienda de otra. El contract (ticket 06) le
 * quitó el caso `operationId: null`, que leía la fila singleton `id = 1` — o
 * sea, siempre Guatemala.
 *
 * Aquí no hay versión con red — a diferencia del envío de WhatsApp, quedarse sin
 * tienda no calla la operación: apaga la lectura de productos, que es
 * exactamente lo que hace hoy (la tabla está vacía). Un pedido de una operación
 * tocando la tienda de otra sí sería un daño real.
 */
export async function getShopifyConnection(
  op: Operation,
): Promise<ShopifyConnection | null> {
  const hit = connectionCache.get(op.id);
  if (hit) return hit.value;
  const [row] = await db
    .select()
    .from(shopifyConnection)
    .where(eq(shopifyConnection.operationId, op.id))
    .limit(1);
  const value = row ?? null;
  connectionCache.set(op.id, value);
  return value;
}

/**
 * Sin argumento borra la caché entera; con una operación, solo su entrada.
 *
 * **También tira el token acuñado**, y sin filtrar por operación a propósito:
 * si alguien acaba de cambiar el client secret, el token viejo sigue siendo
 * válido en la tienda —dura sus 24 horas— y quedaría usándose una credencial
 * que el admin cree haber reemplazado. Acuñar de nuevo cuesta una llamada.
 */
export function invalidateShopifyConnectionCache(op?: Operation): void {
  connectionCache.invalidate(op?.id);
  productCache.clear();
  invalidateMintedTokens();
}

export interface ShopifyVariant {
  /**
   * El id global de la variante (`gid://shopify/ProductVariant/...`).
   *
   * Se agregó al cablear el cierre y **no es cosmético**: la tienda crea las
   * líneas de un pedido por variante, no por producto, así que sin este campo
   * la lectura de un producto no alcanzaba para armar ni una línea. Lo demás de
   * la ficha —título, precio, disponibilidad— sirve para conversar; esto es lo
   * único que sirve para vender.
   */
  id: string;
  title: string;
  price: string | null;
  available: boolean;
  sku: string | null;
}

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  description: string;
  priceRange: { min: string; max: string; currency: string } | null;
  variants: ShopifyVariant[];
}

export function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface AdminQueryOptions {
  query: string;
  variables?: Record<string, unknown>;
}

/**
 * La conexión que le hace falta a una consulta: el dominio, la versión y **de
 * dónde sale el token**, que ya no es siempre una columna.
 */
type QueryableConnection = CredentialFields & Pick<ShopifyConnection, "apiVersion">;

async function adminGraphQL<T>(
  conn: QueryableConnection,
  options: AdminQueryOptions,
): Promise<T> {
  // El token se **resuelve**, no se lee: con una app del Dev Dashboard hay que
  // acuñarlo, y el acuñado vence a las 24 horas. Ver `shopify/token.ts`.
  const resolved = await adminTokenFor(conn);
  if (!resolved.ok) throw new Error(resolved.error);
  const url = `https://${conn.shopDomain}/admin/api/${conn.apiVersion}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": resolved.token,
    },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`shopify admin ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error(`shopify graphql errors: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data) throw new Error("shopify graphql empty data");
  return json.data;
}

/**
 * Los campos de un producto, en un solo lugar.
 *
 * Los comparten la lectura por id —la que alimenta el prompt del agente— y la
 * búsqueda del catálogo del panel. Dos listas de campos separadas es cómo se
 * llega a que el panel muestre un producto sin precio que el agente sí ve.
 */
const PRODUCT_FIELDS = /* GraphQL */ `
  id
  title
  handle
  descriptionHtml
  priceRangeV2 {
    minVariantPrice { amount currencyCode }
    maxVariantPrice { amount currencyCode }
  }
  variants(first: 20) {
    edges {
      node {
        id
        title
        price
        availableForSale
        sku
      }
    }
  }
`;

const PRODUCT_QUERY = /* GraphQL */ `
  query GetProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        ${PRODUCT_FIELDS}
      }
    }
  }
`;

const PRODUCT_SEARCH_QUERY = /* GraphQL */ `
  query SearchProducts($query: String, $first: Int!) {
    products(first: $first, query: $query, sortKey: TITLE) {
      edges {
        node {
          ${PRODUCT_FIELDS}
        }
      }
    }
  }
`;

interface ProductGqlNode {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  priceRangeV2?: {
    minVariantPrice: { amount: string; currencyCode: string };
    maxVariantPrice: { amount: string; currencyCode: string };
  } | null;
  variants?: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        price: string | null;
        availableForSale: boolean;
        sku: string | null;
      };
    }>;
  };
}

function toProduct(node: ProductGqlNode | null | undefined): ShopifyProduct | null {
  if (!node?.id) return null;
  const variants =
    node.variants?.edges
      ?.map((e) => e.node)
      .map<ShopifyVariant>((v) => ({
        id: v.id,
        title: v.title,
        price: v.price,
        available: v.availableForSale,
        sku: v.sku,
      })) ?? [];
  const range = node.priceRangeV2;
  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    descriptionHtml: node.descriptionHtml ?? "",
    description: htmlToPlainText(node.descriptionHtml ?? ""),
    priceRange: range
      ? {
          min: range.minVariantPrice.amount,
          max: range.maxVariantPrice.amount,
          currency: range.minVariantPrice.currencyCode,
        }
      : null,
    variants,
  };
}

function productGid(productId: string | number): string {
  const id = String(productId);
  return id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`;
}

/**
 * Los productos de una operación, leídos contra **su** tienda.
 *
 * La operación va primero, como en todos los accesores de la migración: si no
 * hay tienda para esa operación no se lee nada, en vez de leer la de al lado.
 */
export async function getProductsByIds(
  op: Operation,
  ids: Array<string | number>,
): Promise<ShopifyProduct[]> {
  if (ids.length === 0) return [];
  const conn = await getShopifyConnection(op);
  if (!conn || storeCredential(conn).kind === "none") return [];

  const now = Date.now();
  const gids = ids.map(productGid);
  const cached: ShopifyProduct[] = [];
  const missing: string[] = [];
  for (const gid of gids) {
    const hit = productCache.get(productCacheKey(op, gid));
    if (hit && hit.expires > now) cached.push(hit.value);
    else missing.push(gid);
  }
  if (missing.length === 0) return cached;

  try {
    const data = await adminGraphQL<{ nodes: Array<ProductGqlNode | null> }>(conn, {
      query: PRODUCT_QUERY,
      variables: { ids: missing },
    });
    const fetched = data.nodes
      .map(toProduct)
      .filter((p): p is ShopifyProduct => Boolean(p));
    for (const p of fetched) {
      productCache.set(productCacheKey(op, p.id), {
        value: p,
        expires: now + PRODUCT_TTL_MS,
      });
    }
    return [...cached, ...fetched];
  } catch (err) {
    logger.warn(
      { err, operation: op.countryCode },
      "shopify admin getProductsByIds failed",
    );
    return cached;
  }
}

/**
 * En qué estado está la tienda de una operación cuando el panel le pregunta.
 *
 * **Es un valor, no una excepción, a propósito.** Hoy `shopify_connection` está
 * vacía en producción: «la tienda no está conectada» no es un caso raro sino el
 * primero que el admin va a ver, y tiene que llegar a la pantalla como un
 * estado que se puede explicar —«conectala en Conexión»— y no como un error
 * crudo de red o un `500`. `unreachable` es el otro: la conexión existe pero la
 * tienda no contestó, que se resuelve distinto.
 */
export type StoreRead<T> =
  | { store: "not_connected" }
  | { store: "unreachable"; error: string }
  | { store: "connected"; shopDomain: string; result: T };

/**
 * Busca productos en la tienda de una operación, por texto libre.
 *
 * Es el código que faltaba: `getProductsByIds` sabe leer productos que alguien
 * ya identificó, y `pingShopify` sabe si la tienda contesta, pero **no había
 * forma de listar ni de buscar** — o sea, no había forma de que el admin
 * conectara un producto sin conocer su id de memoria.
 *
 * Sin término devuelve el principio del catálogo ordenado por título, que es lo
 * que hace útil abrir el buscador vacío. El resultado **no se cachea**: la
 * caché de `getProductsByIds` es por id y sirve al agente, que pide lo mismo
 * muchas veces; una búsqueda es de una vez y cachearla haría que un producto
 * recién creado en la tienda no apareciera.
 */
export async function searchStoreProducts(
  op: Operation,
  term: string,
  limit = 25,
): Promise<StoreRead<ShopifyProduct[]>> {
  const conn = await getShopifyConnection(op);
  const cred = conn ? storeCredential(conn) : null;
  if (!conn || !cred || cred.kind === "none") {
    return { store: "not_connected" };
  }

  // La sintaxis de búsqueda de Shopify usa comillas dobles para las frases: un
  // término con comillas rompería la consulta, así que se escapan. El `*` final
  // hace que "revita" encuentre REVITALHAIR, que es como se busca de verdad.
  const clean = term.trim().replace(/["\\]/g, " ").trim();
  const query = clean ? `title:*${clean}* OR ${clean}` : null;

  try {
    const data = await adminGraphQL<{
      products: { edges: Array<{ node: ProductGqlNode }> };
    }>(conn, {
      query: PRODUCT_SEARCH_QUERY,
      variables: { query, first: Math.min(Math.max(limit, 1), 100) },
    });
    const found = data.products.edges
      .map((e) => toProduct(e.node))
      .filter((p): p is ShopifyProduct => Boolean(p));
    return {
      store: "connected",
      shopDomain: cred.shopDomain,
      result: found,
    };
  } catch (err) {
    logger.warn(
      { err, operation: op.countryCode },
      "shopify admin searchStoreProducts failed",
    );
    return {
      store: "unreachable",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Los productos conectados del catálogo, leídos de la tienda **en tiempo de
 * uso**.
 *
 * Es {@link getProductsByIds} con el estado de la tienda a la vista: el panel
 * necesita distinguir «no hay tienda conectada» de «la tienda no tiene ese
 * producto», porque la primera se arregla conectando y la segunda significa que
 * alguien lo borró allá y el catálogo quedó apuntando al vacío. Con una lista
 * vacía —lo que devuelve el hermano— las dos se ven igual.
 *
 * Sigue sin copiar nada a la base: eso es lo que hace que editar el producto en
 * la tienda se refleje acá sin desincronización silenciosa.
 */
export async function readStoreProducts(
  op: Operation,
  ids: Array<string | number>,
): Promise<StoreRead<ShopifyProduct[]>> {
  const conn = await getShopifyConnection(op);
  const cred = conn ? storeCredential(conn) : null;
  if (!conn || !cred || cred.kind === "none") {
    return { store: "not_connected" };
  }
  const found = await getProductsByIds(op, ids);
  return { store: "connected", shopDomain: cred.shopDomain, result: found };
}

export async function pingShopify(
  conn: QueryableConnection,
): Promise<{ ok: true; shopName: string } | { ok: false; error: string }> {
  const cred = storeCredential(conn);
  if (cred.kind === "none") {
    return { ok: false, error: credentialGapText(cred.reason) };
  }
  try {
    const data = await adminGraphQL<{ shop: { name: string } }>(conn, {
      query: `{ shop { name } }`,
    });
    return { ok: true, shopName: data.shop.name };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function extractProductIdsFromOrder(rawPayload: unknown): string[] {
  const p = (rawPayload ?? {}) as {
    line_items?: Array<{ product_id?: number | string | null }>;
  };
  const ids = (p.line_items ?? [])
    .map((it) => it.product_id)
    .filter((v): v is string | number => v !== null && v !== undefined && v !== "");
  return Array.from(new Set(ids.map(String)));
}

// ────────────────────────────────────────────────────────────────────────────
// La verificación de solo lectura · ticket 01
// ────────────────────────────────────────────────────────────────────────────

/**
 * La URL de la API de administración de una tienda, definida una sola vez.
 *
 * La exporta para el camino de **escritura** (`order-create.ts`), que no puede
 * reusar `adminGraphQL`: aquel lanza una excepción con el error adentro y el
 * camino de escritura necesita el código HTTP estructurado para decidir si
 * reintenta o llama a una persona. Lo que sí tiene que ser uno solo es cómo se
 * arma la URL, para que un cambio de versión de la API no deje media base
 * apuntando a la anterior.
 */
export function adminEndpoint(
  conn: Pick<ShopifyConnection, "shopDomain" | "apiVersion">,
): string {
  return `https://${conn.shopDomain}/admin/api/${conn.apiVersion}/graphql.json`;
}

/**
 * Qué permisos concede el token, preguntándoselo a la tienda.
 *
 * Es una lectura y solo una lectura, y es la que permite decirle al admin
 * **antes** de que se cierre una venta que su token no alcanza para crear
 * pedidos. Sin esto, un token corto se guarda sin ruido y falla semanas después
 * en el peor momento: con el cliente ya despedido creyendo que compró.
 *
 * El endpoint no lleva versión de API a propósito — es el de OAuth, no el de
 * datos, y no cambia con la versión que tenga configurada la conexión.
 */
export async function readGrantedScopes(
  conn: CredentialFields,
): Promise<{ ok: true; scopes: string[] } | { ok: false; error: string }> {
  const cred = storeCredential(conn);
  if (cred.kind === "none") {
    return { ok: false, error: credentialGapText(cred.reason) };
  }
  const resolved = await adminTokenFor(conn);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  // El grant de client credentials **ya dijo** qué permisos concede, así que si
  // el endpoint no contesta todavía se puede informar. No es lo mismo que
  // inventarlo: es la respuesta de la propia tienda a la petición del token.
  const fromGrant = conn.shopDomain ? mintedScopesFor(conn.shopDomain) : null;

  try {
    const res = await fetch(
      `https://${conn.shopDomain}/admin/oauth/access_scopes.json`,
      { headers: { "X-Shopify-Access-Token": resolved.token } },
    );
    if (!res.ok) {
      if (fromGrant?.length) return { ok: true, scopes: fromGrant };
      return { ok: false, error: `access_scopes ${res.status}` };
    }
    const json = (await res.json()) as {
      access_scopes?: Array<{ handle?: string }>;
    };
    return {
      ok: true,
      scopes: (json.access_scopes ?? [])
        .map((s) => s.handle ?? "")
        .filter(Boolean),
    };
  } catch (err) {
    if (fromGrant?.length) return { ok: true, scopes: fromGrant };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Qué se leyó de la tienda al conectarla, y qué queda habilitado.
 *
 * `scopeError` no vacía el informe: hay tokens antiguos de app privada a los
 * que el endpoint de permisos no les contesta. En ese caso el sistema no puede
 * afirmar qué falta, y **decirlo es distinto de decir que falta todo** — es la
 * regla de lectura del proyecto: una consulta que falla no es un dato que no
 * existe.
 */
export interface StoreVerification {
  shopName: string;
  /** Los permisos que concede el token, si se pudieron leer. */
  scopes: string[] | null;
  scopeError: string | null;
  /** Cuántos productos contestó la tienda a una búsqueda de una sola página. */
  productsReadable: number | null;
  productError: string | null;
}

/**
 * Verificación de la conexión, **entera de solo lectura**.
 *
 * Es el riesgo R6 de la no-regresión hecho código: al configurar la conexión se
 * le da al sistema capacidad de crear pedidos en una tienda viva, así que lo
 * primero que se hace con la credencial nueva es **leer** — nombre de la
 * tienda, permisos concedidos y un producto— y nunca escribir. La primera
 * escritura la decide una persona, con el interruptor de modo seco y contra un
 * pedido desechable.
 */
export async function verifyStoreConnection(
  conn: QueryableConnection,
): Promise<{ ok: true; verification: StoreVerification } | { ok: false; error: string }> {
  const ping = await pingShopify(conn);
  if (!ping.ok) return { ok: false, error: ping.error };

  const scopes = await readGrantedScopes(conn);

  let productsReadable: number | null = null;
  let productError: string | null = null;
  try {
    const data = await adminGraphQL<{
      products: { edges: Array<{ node: ProductGqlNode }> };
    }>(conn, {
      query: PRODUCT_SEARCH_QUERY,
      variables: { query: null, first: 1 },
    });
    productsReadable = data.products.edges.length;
  } catch (err) {
    productError = err instanceof Error ? err.message : String(err);
  }

  return {
    ok: true,
    verification: {
      shopName: ping.shopName,
      scopes: scopes.ok ? scopes.scopes : null,
      scopeError: scopes.ok ? null : scopes.error,
      productsReadable,
      productError,
    },
  };
}
