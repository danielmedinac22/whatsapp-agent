/**
 * El precio de un producto **nativo**: la regla de qué es un precio válido, en
 * un solo lugar. **Todo esto es puro**: no toca la base, ni la red, ni el reloj.
 *
 * Vive en `@wa/shared` por la misma razón que `product-media.ts`: **el
 * navegador rechaza antes de guardar y la ruta rechaza antes de escribir**, y
 * las dos tienen que estar de acuerdo sobre qué se acepta. Dos copias de esa
 * respuesta se desincronizan en cuanto una se toque, y lo que sale de ahí es un
 * precio que el panel da por bueno y la base rechaza — o el revés, peor: un
 * precio que entra raro y termina siendo lo que el repartidor cobra en la
 * puerta.
 *
 * ## Lo que este archivo NO cubre, y es la mitad del ticket
 *
 * **El precio de un producto conectado a la tienda no pasa por acá.** Ese vive
 * en Shopify y se lee en tiempo de uso, cada vez, sin copiarse a esta base — es
 * criterio explícito de `ventas-panel/02` y es la razón por la que
 * `products.name` es nullable. Esta columna, y estas reglas, son **solo para
 * los nativos**: los productos creados en el panel porque todavía no existen en
 * la tienda. La base lo hace cumplir con su propio `check`; esto existe para
 * que la pantalla pueda decir *por qué* antes de intentarlo.
 *
 * ## La moneda no se guarda con el precio, y es a propósito
 *
 * Un producto pertenece a una operación y la operación dice su moneda
 * (`operations.currency`). Guardar la moneda al lado del precio permitiría
 * escribir un producto guatemalteco con precio en pesos colombianos, que es
 * exactamente el dato que nadie miraría hasta que el repartidor cobre 150.000
 * quetzales. No hay conversión en ninguna parte de este camino y no la va a
 * haber: el precio está en la moneda de su operación, siempre.
 */

/** Cuántos decimales aguanta el dinero de una tienda. El mismo `round2` de `sales/order.ts`. */
const DECIMALS = 2;

/**
 * El techo de la columna: `numeric(12,2)`, o sea 10 dígitos enteros.
 *
 * No es una regla de negocio sino el borde del tipo, y se comprueba acá para
 * que un dedo de más en el panel devuelva «ese precio no entra» en vez de un
 * error de Postgres que nadie sabe leer. Para dimensionarlo: el producto más
 * caro del catálogo real ronda los 400 GTQ, y en pesos colombianos un combo
 * ronda los 200.000 COP.
 */
export const MAX_PRODUCT_PRICE = 9_999_999_999.99;

/** Por qué un precio no se puede guardar. Cada uno se le dice distinto al admin. */
export type ProductPriceRejection =
  /** No es un número: letras, vacío después de limpiar, dos comas. */
  | { reason: "not_a_number" }
  /** Cero o negativo. Un producto que se cobra contraentrega vale algo. */
  | { reason: "not_positive" }
  /** Por encima del techo de la columna. */
  | { reason: "too_large" };

export type ProductPriceParse =
  | { ok: true; value: number }
  | ({ ok: false } & ProductPriceRejection);

/**
 * De lo que el admin escribió al número que se guarda.
 *
 * Acepta lo que una persona teclea de verdad —`150.000`, `1.234,50`, `Q 400`,
 * `199,99`— porque el panel es de Guatemala y de Colombia y en los dos países
 * el separador de miles es el punto. **Ambigüedad resuelta por la coma**: si
 * hay coma, la coma es el decimal y los puntos son miles; si no hay coma, un
 * punto seguido de exactamente dos dígitos al final es decimal y cualquier otro
 * punto es de miles. Es la lectura que coincide con lo que el admin quiso decir
 * en los dos países, y la que evita el error caro —`150.000` entendido como
 * ciento cincuenta— que en contraentrega se descubre con el repartidor cobrando
 * mil veces menos.
 *
 * Redondea a dos decimales en vez de rechazar: `33.333` es un precio que
 * alguien escribió pensando en un tercio, no un error que valga la pena
 * devolverle.
 */
export function parseProductPrice(raw: string | number): ProductPriceParse {
  const value = typeof raw === "number" ? raw : parseTypedPrice(raw);
  if (value === null || !Number.isFinite(value)) return { ok: false, reason: "not_a_number" };
  const rounded = Math.round(value * 10 ** DECIMALS) / 10 ** DECIMALS;
  if (rounded <= 0) return { ok: false, reason: "not_positive" };
  if (rounded > MAX_PRODUCT_PRICE) return { ok: false, reason: "too_large" };
  return { ok: true, value: rounded };
}

/** Lo que se le dice al admin cuando el precio no entra. */
export function productPriceRejectionText(
  rejection: ProductPriceRejection,
): string {
  switch (rejection.reason) {
    case "not_a_number":
      return "el precio tiene que ser un número";
    case "not_positive":
      return "el precio tiene que ser mayor que cero: un producto contraentrega se cobra al entregar";
    case "too_large":
      return "ese precio no entra en la columna";
  }
}

/**
 * El precio como lo guarda la base: texto con dos decimales.
 *
 * `numeric` viaja como texto por el driver —igual que `shopify_orders
 * .total_price`— así que el valor que se escribe y el que se lee tienen la
 * misma forma, y comparar dos precios no depende de cómo los formateó nadie.
 */
export function productPriceToColumn(value: number): string {
  return value.toFixed(DECIMALS);
}

/**
 * El precio como lo lee el resto del sistema: número, o `null`.
 *
 * `null` cuando la columna está vacía **y también cuando trae algo ilegible**.
 * Los dos significan lo mismo para quien pregunta —este producto no tiene
 * precio con el que armar una línea de pedido— y esa es la respuesta segura:
 * sin precio se escala a un asesor, que es mejor que cerrar con un importe
 * inventado.
 */
export function productPriceFromColumn(
  column: string | null | undefined,
): number | null {
  if (column === null || column === undefined) return null;
  const n = Number(column);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * El precio con su moneda, para leerlo en pantalla: `GTQ 399` · `GTQ 449,50`.
 *
 * Mismo formato que el precio que el catálogo ya muestra para los productos de
 * la tienda (`formatPrice` de `lib/catalogo.ts`), para que las dos mitades de
 * la misma columna no se vean como dos cosas distintas.
 *
 * **Los centavos van los dos o ninguno.** Un precio redondo se escribe redondo
 * —`GTQ 399`, que es como se dicen los precios en los dos países— pero uno con
 * centavos los muestra completos: `449,5` se lee como un precio a medio
 * escribir, y en una columna donde se comparan importes eso es exactamente la
 * duda que no tiene que haber.
 */
export function formatProductPrice(value: number, currency: string): string {
  const decimales = Number.isInteger(value) ? 0 : DECIMALS;
  return `${currency} ${value.toLocaleString("es", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })}`;
}

/**
 * El número detrás de lo que tecleó una persona, o `null`.
 *
 * Ver {@link parseProductPrice} para por qué la coma manda sobre el punto.
 */
function parseTypedPrice(raw: string): number | null {
  // Se van los símbolos de moneda, los espacios y cualquier letra: `Q 400`,
  // `$150.000`, `400 GTQ`. Lo que queda son dígitos, separadores y el signo.
  const cleaned = raw.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned) return null;

  const hasComma = cleaned.includes(",");
  let normalized: string;
  if (hasComma) {
    // La coma es el decimal; los puntos son miles. `1.234,50` → `1234.50`.
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    const parts = cleaned.split(".");
    const last = parts[parts.length - 1];
    // Un solo punto con exactamente dos dígitos detrás es un decimal
    // (`199.99`). Todo lo demás es separador de miles (`150.000`, `1.234.567`).
    normalized =
      parts.length === 2 && last !== undefined && last.length === DECIMALS
        ? cleaned
        : parts.join("");
  }

  // Más de un separador decimal después de normalizar no es un número.
  if ((normalized.match(/\./g) ?? []).length > 1) return null;
  if (!/^-?\d*\.?\d*$/.test(normalized) || !/\d/.test(normalized)) return null;
  return Number(normalized);
}
