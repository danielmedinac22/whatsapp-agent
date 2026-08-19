/**
 * El bloque de contexto del producto del que le escriben a Sebastián.
 *
 * Se compone como **bloque de texto** y se pega al prompt efectivo, igual que
 * ya se hace con el contexto de Shopify y el de Dropi (`agent/shopify-context.ts`,
 * `agent/dropi-context.ts`). No es un mecanismo nuevo: es el mismo, para otro
 * agente y otra pregunta — los de Katherine hablan de *el pedido que el cliente
 * ya hizo*; este habla de *el producto que todavía no compró*.
 *
 * Dos fuentes, según de dónde salió el producto:
 *
 * - **Conectado a la tienda** (`source = 'shopify'`): se lee **en tiempo de
 *   uso** contra la tienda de la operación, nunca de una copia. Editar el
 *   producto en Shopify se refleja en la siguiente conversación sin que nadie
 *   sincronice nada. Es el mismo `getProductsByIds` que ya usa el bloque de
 *   postventa, con su caché de diez minutos.
 * - **Nativo** (`source = 'native'`): sale del panel, o sea de la fila de
 *   `products`. No hay tienda a la que preguntarle.
 *
 * **Si no hay producto identificado, no hay bloque.** Devolver `null` es lo que
 * hace verdadera la frase del ticket: mientras el producto no esté
 * identificado, Sebastián conversa sin contexto de producto y sin inventarlo.
 * Lo mismo si el producto está conectado a la tienda y la tienda no responde:
 * la alternativa sería contestar con una copia vieja, que es exactamente lo que
 * «en tiempo de uso» descarta.
 *
 * **Los archivos enviables ya están aquí, y son una sección más del bloque.**
 * El ticket 03 construyó el envío —`sales/product-media-send.ts` decide cuáles
 * salen en el turno y `jobs/outbound.ts` los manda—, así que nombrarlos dejó de
 * ser una promesa vacía. Antes no estaban a propósito: anunciarle al modelo unos
 * archivos que no podía mandar habría prometido adjuntos que nunca llegan.
 *
 * Lo que la sección hace es al revés de lo que parece: **no le da permiso de
 * mandar nada**, porque el modelo no manda archivos —salen solos, por la cola—.
 * Le dice qué está recibiendo el cliente mientras él escribe, para dos cosas que
 * sin la sección salen mal: que no ofrezca «te paso unas fotos» cuando no hay
 * ninguna, y que no se quede callado mientras al cliente le llegan tres.
 */

import {
  eq,
  listSendableProductMedia,
  products,
  type Operation,
  type Product,
} from "@wa/db";
import { mediaKind } from "@wa/shared";
import { db } from "../db";
import { logger } from "../lib/logger";
import { getProductsByIds, type ShopifyProduct } from "../shopify/admin";

/** Igual que en el bloque de postventa: la descripción larga se recorta. */
const DESCRIPTION_MAX_CHARS = 800;

/** Cuántas variantes disponibles caben antes de que dejen de informar. */
const MAX_VARIANTS = 8;

/**
 * Lo que el bloque necesita saber de un producto, ya venga de la tienda o del
 * panel. Forma estructural, para que el renderizado se pruebe sin tienda ni
 * base: es el mismo criterio que `CatalogProduct` en el reconocimiento.
 */
export interface ProductContext {
  name: string;
  description: string | null;
  /** Ya formateado («199 GTQ» o un rango). `null` si la fuente no da precio. */
  price: string | null;
  /** Nombres de variante disponibles. Vacío si no aplica. */
  variants: readonly string[];
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function formatPrice(amount: string | null, currency: string | null): string {
  if (!amount) return "";
  const clean = amount.endsWith(".00") ? amount.slice(0, -3) : amount;
  return currency ? `${clean} ${currency}` : clean;
}

/**
 * El bloque, dado el producto. **Puro.**
 *
 * La última línea no es de adorno: es la única defensa contra que el modelo
 * complete con especificaciones plausibles el hueco que la ficha no llena.
 */
export function renderProductContextBlock(product: ProductContext): string {
  const lines: string[] = [];
  lines.push("## Producto del que te escriben");
  lines.push(`Producto: ${product.name}`);
  if (product.price) lines.push(`Precio: ${product.price}`);
  const variants = product.variants.slice(0, MAX_VARIANTS);
  if (variants.length > 0) {
    lines.push(`Presentaciones disponibles: ${variants.join(", ")}`);
  }
  const description = product.description?.trim();
  if (description) {
    lines.push(`Descripción y especificaciones: ${truncate(description, DESCRIPTION_MAX_CHARS)}`);
  }
  lines.push("");
  lines.push(
    "Es el producto del que te está escribiendo esta persona. Responde sus preguntas con esta información y solo con esta: si algo no está aquí, dile que se lo confirmas y no lo inventes.",
  );
  return lines.join("\n");
}

/** Cómo se nombra un archivo suelto en una frase: «foto», no «imágenes». */
function tipoEnSingular(mime: string): string {
  switch (mediaKind(mime)) {
    case "image":
      return "foto";
    case "video":
      return "video";
    case "audio":
      return "audio";
    default:
      return "documento";
  }
}

/**
 * La sección de los archivos que el cliente recibe, o `null` si no hay ninguno.
 * **Pura.**
 *
 * Las tres frases del cierre son las tres formas que tiene esto de salir mal, y
 * ninguna es hipotética: prometer un archivo que no existe, ofrecer un enlace
 * que nadie va a mandar, y describir como «te lo adjunto» algo que ya salió por
 * su cuenta. Las tres terminan igual —el cliente esperando algo que no llega—,
 * que es justo lo contrario de para qué se mandan las fotos.
 *
 * **Sin archivos no hay sección**, por la misma razón que sin producto no hay
 * ficha: una sección que dijera «no hay archivos» le daría al modelo un tema del
 * que hablar y algo que disculpar.
 */
export function renderVisualSupportSection(
  archivos: readonly { filename: string; mime: string }[],
): string | null {
  if (archivos.length === 0) return null;
  const lines: string[] = [];
  lines.push("## Fotos y archivos que le llegan al cliente");
  lines.push(
    "En esta misma conversación el cliente recibe, por aparte y sin que tú hagas nada, los archivos que el equipo autorizó para este producto:",
  );
  for (const a of archivos) {
    lines.push(`- ${a.filename} (${tipoEnSingular(a.mime)})`);
  }
  lines.push("");
  lines.push(
    "Puedes darlos por recibidos y hablar de lo que muestran. No prometas ningún otro archivo, no ofrezcas enlaces ni catálogos, y no digas que se los vas a enviar tú: ya van en camino.",
  );
  return lines.join("\n");
}

/**
 * Un producto de la tienda, traducido a la forma del bloque.
 *
 * El precio es el rango de la tienda cuando las variantes cuestan distinto, y
 * las variantes son las que están disponibles: ofrecer una presentación agotada
 * es una venta que se cae al día siguiente. Es la misma traducción que hace el
 * bloque de postventa, y a propósito se ve igual en el prompt.
 */
export function shopifyProductContext(product: ShopifyProduct): ProductContext {
  const range = product.priceRange;
  const price = range
    ? range.min === range.max
      ? formatPrice(range.min, range.currency)
      : `${formatPrice(range.min, range.currency)} – ${formatPrice(range.max, range.currency)}`
    : "";
  return {
    name: product.title,
    description: product.description || null,
    price: price || null,
    variants: product.variants
      .filter((v) => v.available && v.title && v.title !== "Default Title")
      .map((v) => v.title),
  };
}

/**
 * Un producto nativo, traducido a la forma del bloque.
 *
 * Sin precio ni variantes: la `0022` le dio a `products` el mínimo que el
 * reconocimiento necesitaba para existir —nombre y descripción— y nada más. Un
 * precio nativo es una columna que todavía no está, no un dato que este archivo
 * pueda deducir.
 */
export function nativeProductContext(row: Pick<Product, "name" | "description">): ProductContext | null {
  const name = row.name?.trim();
  if (!name) return null;
  return {
    name,
    description: row.description,
    price: null,
    variants: [],
  };
}

/**
 * El bloque del producto que la conversación tiene identificado, o `null`.
 *
 * La operación va primero y se verifica contra la fila, como en todos los
 * accesores desde la migración: un `product_id` de otra operación no produce
 * bloque. La clave foránea compuesta de `product_ads` ya impide cruzar
 * operaciones por el lado del anuncio; esto cierra el lado de la conversación,
 * que es una columna suelta sin esa garantía.
 */
export async function buildProductContextBlock(
  op: Operation,
  productId: string | null,
): Promise<string | null> {
  if (!productId) return null;

  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!row) return null;
  if (row.operationId !== op.id) {
    logger.warn(
      { productId, operationId: op.id, productOperationId: row.operationId },
      "product-context: el producto de la conversación es de otra operación; sin bloque",
    );
    return null;
  }

  const ficha = await buildFicha(op, row).catch((err) => {
    logger.warn(
      { err, productId },
      "product-context: no se pudo armar la ficha; se conversa sin ella",
    );
    return null;
  });

  // Los archivos van aparte de la ficha y no dentro, porque **fallan aparte**:
  // la ficha del producto conectado se lee contra la tienda y los archivos
  // contra nuestra base. Que la tienda esté caída no tiene por qué borrar del
  // prompt las fotos que el cliente está recibiendo igual.
  const archivos = await listSendableProductMedia(op, productId).catch((err) => {
    logger.warn(
      { err, productId },
      "product-context: no se pudieron leer los archivos del producto; el bloque sigue sin ellos",
    );
    return [];
  });
  const apoyos = renderVisualSupportSection(archivos);

  const partes = [ficha, apoyos].filter((p): p is string => Boolean(p));
  return partes.length > 0 ? partes.join("\n\n") : null;
}

/** La ficha del producto, según de dónde salga. `null` si su fuente no la da. */
async function buildFicha(
  op: Operation,
  row: Product,
): Promise<string | null> {
  if (row.source === "native") {
    const context = nativeProductContext(row);
    return context ? renderProductContextBlock(context) : null;
  }

  // Conectado a la tienda: en tiempo de uso, contra la tienda de **esta**
  // operación. Sin tienda conectada, o con la tienda caída, no hay ficha —
  // `products.name` puede tener una copia del nombre y usarla sería justo la
  // información copiada que el ticket descarta.
  if (!row.shopifyProductId) return null;
  const [live] = await getProductsByIds(op, [row.shopifyProductId]);
  if (!live) {
    logger.warn(
      { productId: row.id, shopifyProductId: row.shopifyProductId },
      "product-context: la tienda no devolvió el producto; se conversa sin ficha",
    );
    return null;
  }
  return renderProductContextBlock(shopifyProductContext(live));
}
