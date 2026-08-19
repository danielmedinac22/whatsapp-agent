/**
 * Lo que el cliente lee cuando su cierre no se pudo convertir en pedido, y lo
 * que lee cuando sí.
 *
 * Todo lo de este archivo es PURO: recibe los errores del constructor de orden
 * —o el pedido ya creado— y devuelve texto. No manda nada, no sabe de la red y
 * no consulta la base. Por eso la redacción se puede probar con fixtures, que
 * es lo único de este ticket que el cliente va a leer palabra por palabra.
 *
 * ## La distinción que gobierna este archivo
 *
 * **No todo error es del cliente.** Que su ciudad no exista en la lista es algo
 * que él puede corregir; que el país de la operación no tenga listas, que el
 * carrito venga vacío o que una línea traiga un precio negativo **no lo es**.
 * Pedirle al cliente que corrija un error del sistema es la peor respuesta
 * posible: lo deja intentando algo imposible y sin nadie mirando.
 *
 * Por eso cada error declara **a quién le habla** ({@link closingErrorAudience})
 * y la orquestación se parte en dos: si hay aunque sea un error del equipo, el
 * caso escala a un asesor en vez de volver a preguntarle al cliente.
 *
 * ## Todo lo que falta, de una vez
 *
 * Los errores salen todos juntos del constructor de orden, y acá salen todos
 * juntos en un mensaje. Una corrección por mensaje —«falta el apellido»,
 * «ahora el teléfono», «ahora la ciudad»— es cómo se pierde a alguien que ya
 * había decidido comprar.
 */

import type { RequiredField, SalesOrderError } from "./order";

/** Quién puede resolver el error. */
export type ClosingErrorAudience = "lead" | "team";

/**
 * A quién le habla cada error.
 *
 * Los cuatro del equipo no son bugs teóricos: `country_unsupported` es una
 * operación cuyo país no tiene listas cargadas, y `no_lines` / `line_invalid`
 * es el carrito que el vendedor armó mal o el catálogo que devolvió un precio
 * imposible. Ninguno mejora repreguntándole al cliente.
 */
export function closingErrorAudience(
  error: SalesOrderError,
): ClosingErrorAudience {
  switch (error.code) {
    case "country_unsupported":
    case "no_lines":
    case "line_invalid":
      return "team";
    default:
      return "lead";
  }
}

/** Cómo se le nombra al cliente cada dato que falta. */
const REQUIRED_LABEL: Record<RequiredField, string> = {
  firstName: "tu nombre",
  lastName: "tu apellido",
  phone: "tu número de teléfono",
  city: "tu municipio",
  division: "tu departamento",
  addressOrPickup:
    "tu dirección de entrega (o decime si preferís reclamar en oficina)",
};

/**
 * Una línea por error, en segunda persona y diciendo **qué hacer**, no qué
 * pasó. «Ese municipio no aparece» le dice al cliente que se equivocó; «¿me lo
 * escribís de nuevo?» le dice qué hacer con eso.
 */
function leadLine(error: SalesOrderError): string {
  switch (error.code) {
    case "missing_required":
      return `Me falta ${REQUIRED_LABEL[error.field]}.`;
    case "address_and_pickup_conflict":
      // Las dos cosas a la vez no se resuelven eligiendo por él: dijo dos cosas
      // distintas y la equivocada cuesta un envío perdido.
      return "Me diste dirección y también dijiste que reclamás en oficina — ¿cuál de las dos preferís?";
    case "phone_invalid":
      return `El número *${error.value}* no me cuadra para acá. ¿Me lo pasás de nuevo?`;
    case "division_unknown":
      return `No encuentro el departamento *${error.value}*. ¿Me lo confirmás?`;
    case "city_unknown":
      return `No encuentro el municipio *${error.value}*. ¿Me lo escribís de nuevo?`;
    case "city_in_other_division":
      // El caso real: «Antigua Guatemala» con departamento «Guatemala». El
      // municipio existe, así que repreguntar por el municipio entero sería
      // hacerle repetir lo que ya escribió bien.
      return `*${error.value}* me aparece en ${listar(error.divisions)}, no en el departamento que me diste. ¿Cuál es?`;
    default:
      return "";
  }
}

/** «A», «A o B», «A, B o C» — sin coma antes del último. */
function listar(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} o ${items[items.length - 1]}`;
}

/**
 * El mensaje que corrige el cierre, con todo lo que falta junto.
 *
 * Devuelve `null` cuando ningún error es del cliente: no hay nada que
 * preguntarle y el caso es del equipo.
 */
export function closingCorrectionMessage(
  errors: readonly SalesOrderError[],
): string | null {
  const lines = errors
    .filter((e) => closingErrorAudience(e) === "lead")
    .map(leadLine)
    .filter(Boolean);
  if (lines.length === 0) return null;

  const encabezado =
    lines.length === 1
      ? "¡Casi listo! Solo me falta un dato para dejar tu pedido:"
      : "¡Casi listo! Me faltan estos datos para dejar tu pedido:";
  return [encabezado, "", ...lines.map((l) => `• ${l}`)].join("\n");
}

/** Lo mínimo que un mensaje necesita saber del pedido creado. */
export interface CreatedOrderSummary {
  /** El número visible del pedido en la tienda: `#1042`. */
  orderName: string;
  /** Qué compró, ya legible: «2 × Colágeno Hidrolizado». */
  productSummary: string;
  total: number;
  currency: string;
  /** La dirección tal como quedó, o la etiqueta de reclamo en oficina. */
  destination: string;
  pickupAtOffice: boolean;
}

function money(total: number, currency: string): string {
  return `${total.toFixed(2).replace(/\.00$/, "")} ${currency}`;
}

/**
 * «Tu pedido quedó registrado» — el mensaje que cierra la conversación de
 * venta.
 *
 * Lleva el número del pedido a propósito: es lo que el cliente puede repetir si
 * escribe después, y es lo que convierte «creo que compré» en «compré el
 * #1042». En contraentrega, donde no hay comprobante de pago, ese número es
 * todo lo que tiene.
 */
export function orderRegisteredMessage(order: CreatedOrderSummary): string {
  const entrega = order.pickupAtOffice
    ? `📦 Lo reclamás en oficina — ${order.destination}`
    : `📍 Entrega en ${order.destination}`;
  return [
    `¡Listo! Tu pedido quedó registrado ✅`,
    "",
    `*${order.orderName}* — ${order.productSummary}`,
    entrega,
    `💵 Pagás ${money(order.total, order.currency)} al recibir`,
  ].join("\n");
}

/**
 * El aviso de que confirmaciones lo va a contactar.
 *
 * El texto lo escribe el admin en `sales_agent_settings.funnel_message`, y por
 * eso este ayudante recibe el configurado y solo pone un respaldo cuando está
 * vacío — la tabla se llena de a poco desde el panel y un campo vacío no puede
 * dejar al cliente sin el aviso. Sin él, el mensaje de confirmación que llega
 * diez minutos después se lee como que nadie se enteró de la venta.
 */
export function funnelHandoffMessage(configured: string): string {
  const texto = configured.trim();
  return texto.length > 0
    ? texto
    : "En un ratito te escribe el equipo de confirmaciones por este mismo chat para validar tu dirección antes de despachar 🙌";
}

/**
 * Lo que el cliente lee cuando dio todos sus datos y el pedido **todavía no
 * existe**.
 *
 * Son los dos casos en que el cierre calla a propósito: el modo seco, que no
 * escribió nada, y el cierre que no llegó a la tienda y quedó en la cola. En los
 * dos, callar del todo tampoco sirve — el cliente acaba de dictar su dirección y
 * el silencio se lee como que se cayó la conversación.
 *
 * **No dice que el pedido quedó registrado, y esa es toda su razón de ser.**
 * Decirlo sería el mismo fallo silencioso que este camino existe para evitar,
 * solo que al revés: el cliente se va tranquilo con un pedido que nadie creó.
 * Dice lo único que es cierto en los dos casos — que sus datos están y que una
 * persona le confirma— y no promete cuándo, porque no se sabe.
 */
export function closingPendingMessage(): string {
  return [
    "¡Listo! Ya tengo todos tus datos ✅",
    "",
    "Un asesor te confirma el pedido por este mismo chat en un ratito 🙌",
  ].join("\n");
}

/**
 * El primer toque del pedido de ventas, diez minutos después.
 *
 * **Reconoce la compra en vez de preguntar si quiere comprar**, que es el punto
 * entero del ticket 05: el cliente acaba de despedirse del vendedor y recibir
 * «¿querés confirmar tu pedido?» se lee como que nadie se enteró.
 *
 * Y se enfoca en **la dirección**, que es lo que la confirmación existe para
 * validar: en contraentrega la dirección sin verificar es la causa número uno
 * de devolución. Por eso el mensaje la repite entera y pide un sí o un no — no
 * se salta la confirmación, la hace en un mensaje.
 */
export function salesPurchaseAckMessage(input: {
  customerFirstName: string;
  productSummary: string;
  destination: string;
  total: string;
}): string {
  const saludo = input.customerFirstName.trim()
    ? `¡Hola ${input.customerFirstName.trim()}!`
    : "¡Hola!";
  return [
    `${saludo} 👋 Soy del equipo de confirmaciones de Vorare.`,
    "",
    `Ya tengo tu pedido de *${input.productSummary}* por ${input.total}, pago contraentrega.`,
    "",
    `Antes de despacharlo necesito confirmar la dirección:`,
    `📍 ${input.destination}`,
    "",
    "¿Está correcta? Si hay algo que ajustar, decímelo por acá 🙌",
  ].join("\n");
}
