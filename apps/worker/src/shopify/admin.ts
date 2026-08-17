import { eq } from "@wa/db";
import {
  shopifyConnection,
  type Operation,
  type ShopifyConnection,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { OperationScopedCache } from "../operations";

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

/** Sin argumento borra la caché entera; con una operación, solo su entrada. */
export function invalidateShopifyConnectionCache(op?: Operation): void {
  connectionCache.invalidate(op?.id);
  productCache.clear();
}

export interface ShopifyVariant {
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

async function adminGraphQL<T>(
  conn: ShopifyConnection,
  options: AdminQueryOptions,
): Promise<T> {
  if (!conn.shopDomain || !conn.adminAccessToken) {
    throw new Error("shopify connection missing domain or token");
  }
  const url = `https://${conn.shopDomain}/admin/api/${conn.apiVersion}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": conn.adminAccessToken,
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

const PRODUCT_QUERY = /* GraphQL */ `
  query GetProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
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
              title
              price
              availableForSale
              sku
            }
          }
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
  if (!conn?.shopDomain || !conn?.adminAccessToken) return [];

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

export async function pingShopify(
  conn: Pick<ShopifyConnection, "shopDomain" | "adminAccessToken" | "apiVersion">,
): Promise<{ ok: true; shopName: string } | { ok: false; error: string }> {
  if (!conn.shopDomain || !conn.adminAccessToken) {
    return { ok: false, error: "missing domain or token" };
  }
  try {
    const data = await adminGraphQL<{ shop: { name: string } }>(
      conn as ShopifyConnection,
      { query: `{ shop { name } }` },
    );
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
