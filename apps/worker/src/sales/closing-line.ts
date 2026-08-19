/**
 * Con qué se arma la línea del pedido, y por qué a veces no se puede.
 *
 * Todo lo de este archivo es PURO: recibe la fila del catálogo, lo que dijo el
 * cliente y —solo cuando hace falta— lo que contestó la tienda, y devuelve la
 * línea o el motivo. No toca la base, ni la tienda, ni el reloj. Quien las
 * consigue es `agent/sales-closing-tool.ts`.
 *
 * ## Por qué salió de ahí
 *
 * Estaba dentro del adaptador, mezclada con la consulta a `products` y la
 * llamada a la tienda, así que la regla que decide si una venta se cierra sola
 * o pasa a un asesor no se podía probar sin base ni credenciales — y las
 * credenciales de la tienda no existen. Es el mismo movimiento con el que se
 * resolvieron `resolveInbox`, `resolveConversationOwner` y
 * `decideNewContactAgentMode`: la regla enredada se saca a una función pura y
 * se prueba con fixtures.
 *
 * ## Las dos mitades del catálogo, y de dónde sale el precio de cada una
 *
 * - **Conectado a la tienda** — el precio vive allá y se lee **en tiempo de
 *   uso**, cada vez. No se copia a esta base, no se cachea, y este archivo no
 *   mira `products.price` para uno de estos ni aunque la columna trajera algo:
 *   {@link planClosingLine} devuelve `ask_store` y el precio entra por
 *   {@link storeClosingLine}. Es criterio explícito de `ventas-panel/02` y la
 *   razón por la que `products.name` es nullable — un precio copiado es el
 *   panel cobrando lo que la tienda ya cambió, sin que nada avise.
 * - **Nativo** — creado en el panel porque todavía no existe en la tienda. Su
 *   precio es el de `products.price`, que la `0028` agregó y que solo los
 *   nativos pueden tener. Sin él **no hay línea**, y el caso va a una persona:
 *   escalar cuesta atención, y cerrar con un importe inventado se descubre con
 *   el repartidor en la puerta cobrando otra cifra.
 *
 * ## Lo que este archivo sigue sin dejar hacer
 *
 * El modelo no escribe precios ni identificadores. Lo único que aporta de la
 * conversación es **la cantidad y qué presentación eligió el cliente**, que es
 * lo que el cliente dijo. Todo lo demás sale del catálogo o de la tienda.
 */

import { productPriceFromColumn } from "@wa/shared";
import type { ClosingLine } from "./order";
import { pickVariant } from "./closing-capture";

/** Lo mínimo que se necesita de la fila de `products` para decidir. */
export interface CatalogProductRow {
  id: string;
  operationId: string;
  source: "shopify" | "native";
  shopifyProductId: string | null;
  name: string | null;
  /** `products.price`: texto de `numeric`, o `null`. **Solo los nativos.** */
  price: string | null;
}

/** Lo que la tienda contesta de un producto conectado. */
export interface StoreProductRead {
  title: string;
  variants: readonly StoreVariantRead[];
}

export interface StoreVariantRead {
  id: string;
  title: string;
  available: boolean;
  price: string | null;
}

/** Lo que el cliente dijo, y es lo único que aporta el modelo. */
export interface LineCapture {
  cantidad: number;
  presentacion: string | null;
}

/**
 * La línea, el motivo por el que no la hay, o «hay que preguntarle a la
 * tienda».
 *
 * Los cinco casos se atienden distinto y por eso son cinco: `no_product` y
 * `not_sellable` escalan a un asesor, `ambiguous_variant` lo contesta el modelo
 * preguntándole al cliente, `ask_store` es el único que necesita red, y `ok` es
 * la venta.
 */
export type ClosingLineResolution =
  | { kind: "ok"; line: ClosingLine }
  /** No hay producto, o el producto es de otra operación. */
  | { kind: "no_product" }
  /** Hay producto y **no se puede armar la línea**. `detail` dice por qué. */
  | { kind: "not_sellable"; detail: string }
  /** Varias presentaciones y el cliente no dijo cuál. Se le pregunta. */
  | { kind: "ambiguous_variant"; options: readonly string[] }
  /** Es un producto conectado: su precio y su variante los tiene la tienda. */
  | { kind: "ask_store"; shopifyProductId: string };

/**
 * Lo que queda una vez que ya no hay nada que preguntarle a la tienda.
 *
 * Es el tipo con el que trabaja quien dispara el cierre, y `ask_store` no puede
 * estar: si estuviera, el adaptador podría olvidarse de resolverlo y armar un
 * pedido sin línea. Que el compilador lo exija es más barato que un test.
 */
export type ResolvedClosingLine = Exclude<
  ClosingLineResolution,
  { kind: "ask_store" }
>;

/**
 * Qué hacer con el producto que la conversación tiene reconocido.
 *
 * Decide **sin red**: para un producto nativo la línea sale entera de acá, y la
 * tienda no se consulta ni una vez. Eso no es una optimización — es que un
 * producto nativo no tiene nada que preguntarle a la tienda, y preguntarle
 * igual haría que una venta que no la necesita se cayera cuando la tienda no
 * contesta.
 *
 * El orden de las comprobaciones es el orden en que alguien puede actuar:
 * primero si hay producto, después si es de esta operación —la columna
 * `conversations.product_id` es suelta y no tiene clave foránea compuesta que
 * lo garantice—, y al final de dónde sale su precio.
 */
export function planClosingLine(input: {
  operationId: string;
  product: CatalogProductRow | null;
  capture: LineCapture;
}): ClosingLineResolution {
  const { product } = input;
  if (!product) return { kind: "no_product" };
  if (product.operationId !== input.operationId) return { kind: "no_product" };

  if (product.source === "shopify") {
    const gid = product.shopifyProductId?.trim();
    // Un conectado sin identificador es una fila que el `check` de la base no
    // deja escribir. Si aparece igual, no se inventa un precio: va a una
    // persona.
    if (!gid) {
      return {
        kind: "not_sellable",
        detail: "el producto dice estar en la tienda y no tiene identificador",
      };
    }
    return { kind: "ask_store", shopifyProductId: gid };
  }

  const price = productPriceFromColumn(product.price);
  if (price === null) {
    return {
      kind: "not_sellable",
      detail: nativeWithoutPriceDetail(product.name),
    };
  }

  return {
    kind: "ok",
    line: {
      productId: product.id,
      // Sin variante: no está en la tienda. Entra como línea suelta.
      variantId: null,
      // El nombre del panel es el único que hay — no hay tienda de dónde
      // leerlo. El `check` de la `0022` lo hace obligatorio para los nativos;
      // el respaldo existe para que una fila rota no produzca un pedido sin
      // nombre que nadie pueda despachar.
      title: product.name?.trim() || "Producto sin nombre",
      quantity: input.capture.cantidad,
      unitPrice: price,
    },
  };
}

/**
 * Lo que hay que decirle al equipo cuando un producto nativo no tiene precio.
 *
 * Nombra el producto, porque quien lee la alerta tiene que saber **cuál** ir a
 * completar en el panel; sin el nombre, «un producto no tiene precio» obliga a
 * abrir el catálogo entero.
 */
export function nativeWithoutPriceDetail(name: string | null): string {
  const cual = name?.trim() ? `«${name.trim()}»` : "el producto";
  return `${cual} se creó en el panel y todavía no tiene precio, así que no hay con qué armar la línea del pedido`;
}

/**
 * La línea de un producto **conectado**, con lo que contestó la tienda.
 *
 * El precio y el identificador de la variante salen de acá y de ningún otro
 * lado: es el mismo camino de siempre, sacado a una función para poder probarlo
 * sin credenciales.
 */
export function storeClosingLine(input: {
  productId: string;
  live: StoreProductRead | null;
  capture: LineCapture;
}): ResolvedClosingLine {
  const { live } = input;
  if (!live) {
    return {
      kind: "not_sellable",
      detail: "la tienda no devolvió el producto al armar el pedido",
    };
  }

  // Solo las disponibles: cerrar sobre una presentación agotada es una venta
  // que se cae al día siguiente, y en contraentrega se cae después de
  // despachar.
  const sellable = live.variants.filter((v) => v.available && v.price !== null);
  const pick = pickVariant(sellable, input.capture.presentacion);
  if (pick.kind === "none") {
    return {
      kind: "not_sellable",
      detail: "la tienda no tiene ninguna presentación disponible con precio",
    };
  }
  if (pick.kind === "ambiguous") {
    return { kind: "ambiguous_variant", options: pick.options };
  }

  const unitPrice = Number(pick.variant.price);
  if (!Number.isFinite(unitPrice)) {
    return {
      kind: "not_sellable",
      detail: `la tienda devolvió un precio ilegible (${pick.variant.price})`,
    };
  }

  const variantTitle = pick.variant.title;
  return {
    kind: "ok",
    line: {
      productId: input.productId,
      variantId: pick.variant.id,
      // El título que va al pedido lleva la presentación cuando la hay: es lo
      // que el cliente lee en el mensaje de confirmación y lo que el equipo ve
      // en la tienda, y «Colágeno» a secas no alcanza para despachar.
      title:
        variantTitle && variantTitle !== "Default Title"
          ? `${live.title} — ${variantTitle}`
          : live.title,
      quantity: input.capture.cantidad,
      unitPrice,
    },
  };
}
