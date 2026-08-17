import { and, desc, eq, gte, shopifyOrders } from "@wa/db";
import { db } from "../db";
import {
  getOperationById,
  getOperationIdByContactId,
  getSingleActiveOperation,
} from "../operations";
import { logger } from "../lib/logger";
import {
  extractProductIdsFromOrder,
  getProductsByIds,
  getShopifyConnection,
  type ShopifyProduct,
} from "../shopify/admin";

const ORDER_LOOKBACK_DAYS = 60;
const DESCRIPTION_MAX_CHARS = 800;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function formatPrice(amount: string | null, currency: string | null): string {
  if (!amount) return "";
  const clean = amount.endsWith(".00") ? amount.slice(0, -3) : amount;
  return currency ? `${clean} ${currency}` : clean;
}

function renderProduct(product: ShopifyProduct): string {
  const lines: string[] = [];
  lines.push(`- Producto: ${product.title}`);
  if (product.priceRange) {
    const price =
      product.priceRange.min === product.priceRange.max
        ? formatPrice(product.priceRange.min, product.priceRange.currency)
        : `${formatPrice(product.priceRange.min, product.priceRange.currency)} – ${formatPrice(product.priceRange.max, product.priceRange.currency)}`;
    if (price) lines.push(`  Precio: ${price}`);
  }
  const availableVariants = product.variants
    .filter((v) => v.available && v.title && v.title !== "Default Title")
    .slice(0, 8)
    .map((v) => v.title);
  if (availableVariants.length > 0) {
    lines.push(`  Variantes disponibles: ${availableVariants.join(", ")}`);
  }
  if (product.description) {
    const desc = truncate(product.description, DESCRIPTION_MAX_CHARS);
    lines.push(`  Descripción: ${desc}`);
  }
  return lines.join("\n");
}

/**
 * El bloque de contexto de tienda que se le inyecta al agente.
 *
 * La operación sale de la conversación del contacto y no se recibe por
 * parámetro: quien arma el prompt no tiene por qué saber de operaciones, y así
 * toda lectura contra la tienda pasa por la operación de la conversación sin
 * que ningún llamador pueda olvidarse de pasarla.
 */
export async function buildShopifyContextBlock(
  contactId: string,
): Promise<string | null> {
  // Con las primitivas que devuelven `null`, no con el puente que lanza: no
  // poder resolver la operación aquí solo apaga el bloque de productos del
  // prompt —que es lo que hace hoy, con la tabla de tiendas vacía—, y eso no
  // justifica reventar la respuesta del agente.
  const operationId = await getOperationIdByContactId(contactId);
  const op = operationId
    ? await getOperationById(operationId)
    : await getSingleActiveOperation();
  if (!op) return null;

  const conn = await getShopifyConnection(op);
  if (!conn?.shopDomain || !conn?.adminAccessToken) return null;

  const since = new Date(Date.now() - ORDER_LOOKBACK_DAYS * 24 * 60 * 60_000);

  const [order] = await db
    .select()
    .from(shopifyOrders)
    .where(
      and(
        eq(shopifyOrders.contactId, contactId),
        gte(shopifyOrders.receivedAt, since),
      ),
    )
    .orderBy(desc(shopifyOrders.receivedAt))
    .limit(1);

  if (!order) return null;

  const productIds = extractProductIdsFromOrder(order.rawPayload);
  if (productIds.length === 0) return null;

  let products: ShopifyProduct[] = [];
  try {
    products = await getProductsByIds(op, productIds);
  } catch (err) {
    logger.warn({ err, contactId }, "buildShopifyContextBlock: fetch failed");
    return null;
  }
  if (products.length === 0) return null;

  const orderDate = order.receivedAt
    ? new Date(order.receivedAt).toLocaleDateString("es-CO", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

  const total = order.totalPrice
    ? formatPrice(order.totalPrice, order.currency)
    : null;

  const lines: string[] = [];
  lines.push("## Contexto del cliente (Shopify)");
  lines.push(
    `El cliente realizó un pedido${orderDate ? ` el ${orderDate}` : ""}. Estado interno: ${order.status}.`,
  );
  if (total) lines.push(`Total del pedido: ${total}`);
  lines.push("");
  for (const p of products) lines.push(renderProduct(p));
  lines.push("");
  lines.push(
    "Usa esta información para responder preguntas específicas del producto que compró el cliente. No inventes datos que no estén aquí.",
  );
  return lines.join("\n");
}
