/**
 * De los datos de un cierre a un pedido listo para crear en la tienda — o al
 * conjunto de errores que lo impiden.
 *
 * Todo lo de este archivo es PURO: no toca la base, ni el reloj, ni la red, ni
 * Shopify. **Construye el payload; no crea nada.** La creación real es otro
 * ticket y hoy además es imposible: la conexión de administración de la tienda
 * está vacía. Que esta parte sea pura es lo que permite tenerla probada y
 * terminada antes de que exista la credencial.
 *
 * **Una sola función exportada, y es deliberado.** Validación, mapeo al payload,
 * clamp del descuento y derivación de la llave de idempotencia son una sola
 * decisión de negocio: «¿este cierre se puede convertir en pedido, y en cuál?».
 * Partirla en cuatro funciones exportadas daría cuatro seams para probar lo
 * mismo, y dejaría que alguien llamara al mapeo sin haber pasado por la
 * validación. Los ayudantes de abajo no se exportan: no son costuras.
 *
 * ## Los tres errores caros y cómo los evita el tipo
 *
 * 1. **Un pedido de una operación creado en la tienda de otra** — el error más
 *    caro del módulo, porque despacha al país equivocado. La tienda, la moneda
 *    y el país no llegan sueltos: llegan en un {@link SalesOrderStore}, un valor
 *    marcado que **solo** {@link salesOrderStore} puede fabricar, y que se niega
 *    a existir si la conexión de tienda no es la de esa operación. No hay forma
 *    de escribir la mezcla.
 * 2. **Una moneda por defecto.** Sale de la operación, dentro del mismo valor.
 *    En este archivo no hay ninguna constante `"GTQ"`, y no puede haberla: el
 *    tipo no ofrece de dónde sacarla si no es de ahí.
 * 3. **Dirección y reclamo en oficina a la vez.** En la entrada es escribible
 *    —el cliente puede decir las dos cosas y hay que detectarlo—, así que es un
 *    error de validación. En la **salida** no: {@link SalesOrderShipping} es una
 *    unión, y un pedido con las dos no se puede representar.
 *
 * ## Lo que no falla nunca
 *
 * El descuento. Un valor pactado por encima del límite **no rechaza el cierre**:
 * el pedido sale al precio válido y el resultado lo señala, para que el
 * orquestador escale el caso a un asesor. Rechazarlo perdería una venta ya
 * pagada en publicidad por una negociación que el vendedor no tenía autorizada;
 * clamparlo protege el margen y deja rastro. Con el límite en cero —el valor por
 * defecto de la tabla, que prohíbe descuentos— pasa lo mismo: sale al precio de
 * lista y avisa.
 */

import { createHash } from "node:crypto";
import type { OperationId } from "@wa/db";
import {
  countryRules,
  findCity,
  resolveDivision,
  resolvePhone,
  type CountryRules,
} from "../geo/country";

/**
 * La etiqueta que marca el pedido como originado en el vendedor. Es el contrato
 * entre este módulo y `followup-plan.ts`, que la lee para decidir el contenido
 * del primer toque, y —más adelante— entre este módulo y el ticket 05, que la
 * necesita para no aplicarle a un pedido de ventas el heurístico de «el cliente
 * ya respondió». Un solo string, definido donde se escribe.
 */
export const SALES_ORDER_TAG = "origen-ventas";

/** Prefijo de la etiqueta del vendedor: `vendedor:Sebastián`. */
export const SELLER_TAG_PREFIX = "vendedor:";

/** La etiqueta que le dice a logística que el cliente reclama en oficina. */
export const PICKUP_AT_OFFICE_TAG = "reclamo-en-oficina";

/**
 * La etiqueta que avisa que el pedido lleva algo que **la tienda no tiene**.
 *
 * Es la parte del ticket 05 que mira hacia afuera del sistema: un producto
 * nativo entra como línea suelta, así que en la tienda ese renglón **no tiene
 * variante ni SKU, no descuenta inventario y no aparece en ningún informe por
 * producto**. Quien arma el despacho tiene que poder darse cuenta antes de ir a
 * buscarlo a la estantería, y tiene que poder **listar** esos pedidos: las
 * etiquetas son el único campo del pedido que la API sabe buscar (`tag:...`),
 * que es la misma razón por la que la llave de idempotencia viaja como
 * etiqueta.
 *
 * Va además de la nota del pedido, que dice **cuál** de las líneas es. La
 * etiqueta se busca; la nota se lee.
 */
export const OFF_CATALOG_TAG = "producto-fuera-de-la-tienda";

// ────────────────────────────────────────────────────────────────────────────
// La tienda de la operación · el valor que no se puede mezclar
// ────────────────────────────────────────────────────────────────────────────

declare const storeBrand: unique symbol;

/**
 * La tienda de una operación, con su moneda y su país, en un solo valor.
 *
 * Está **marcado**: la propiedad de marca no existe en tiempo de ejecución y su
 * símbolo no sale de este archivo, así que nadie puede construir uno a mano
 * desde fuera. La única puerta es {@link salesOrderStore}, y ahí se comprueba
 * que la conexión de tienda pertenezca a la operación. El resultado es que
 * «pedido de Guatemala hacia la tienda colombiana» no es un bug que haya que
 * atrapar en un test: es código que no compila.
 */
export interface SalesOrderStore {
  readonly [storeBrand]: "sales-order-store";
  readonly operationId: OperationId;
  /** ISO 3166-1 alfa-2, en mayúsculas. */
  readonly countryCode: string;
  /** ISO 4217, en mayúsculas. La moneda del pedido, sin valor por defecto. */
  readonly currency: string;
  readonly shopDomain: string;
}

/**
 * La única forma de fabricar un {@link SalesOrderStore}.
 *
 * Devuelve `null` —y no lanza— en los cuatro casos en que no hay tienda a la
 * que mandarle un pedido: no hay conexión, la conexión es de **otra** operación,
 * le falta el dominio, o la operación no dice moneda o país. Los cuatro
 * significan lo mismo para quien llama: esta operación todavía no puede crear
 * pedidos, y eso se alerta, no se sortea con un valor por defecto.
 *
 * Hoy los cuatro casos son uno solo y real: `shopify_connection` está vacía.
 */
export function salesOrderStore(
  operation: { id: OperationId; countryCode: string; currency: string },
  connection: { operationId: OperationId; shopDomain: string | null } | null,
): SalesOrderStore | null {
  if (!connection) return null;
  if (connection.operationId !== operation.id) return null;
  const shopDomain = connection.shopDomain?.trim();
  const currency = operation.currency.trim().toUpperCase();
  const countryCode = operation.countryCode.trim().toUpperCase();
  if (!shopDomain || !currency || !countryCode) return null;
  return {
    operationId: operation.id,
    countryCode,
    currency,
    shopDomain,
  } as SalesOrderStore;
}

// ────────────────────────────────────────────────────────────────────────────
// La entrada · lo que el cierre capturó
// ────────────────────────────────────────────────────────────────────────────

/**
 * Los datos que el vendedor le pidió al cliente. Todos llegan como texto crudo
 * y pueden venir vacíos: es lo que hay que validar, no lo que ya está validado.
 */
export interface ClosingContact {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  /** Municipio, tal como lo dijo el cliente. */
  city: string | null;
  /** Departamento, tal como lo dijo el cliente. */
  division: string | null;
  /** Dirección de entrega. Excluyente con {@link pickupAtOffice}. */
  address: string | null;
  /** El cliente prefiere reclamar en la oficina de la transportadora. */
  pickupAtOffice: boolean;
  /** El único opcional de verdad. */
  email: string | null;
}

/**
 * Una línea del pedido, ya resuelta contra el catálogo: qué producto, qué
 * variante —si la hay—, cuántas y a qué precio de lista. El precio va en la
 * moneda de la operación — no hay conversión en ninguna parte de este módulo.
 */
export interface ClosingLine {
  productId: string;
  /**
   * La variante de la tienda. Shopify crea líneas por variante, no por
   * producto… **salvo cuando el producto no está en la tienda**.
   *
   * `null` es un producto **nativo**: creado en el panel porque todavía no
   * existe allá, con su precio puesto a mano (`ventas-panel/05`). Entra al
   * pedido como una **línea suelta** —título y precio, sin variante—, que es
   * cómo la API de la tienda vende algo que su catálogo no tiene. Ver
   * `shopify/order-payload.ts` para qué cambia en el pedido y qué ve logística.
   *
   * Nullable y no opcional a propósito: quien arma una línea tiene que
   * **decidir** si tiene variante, no olvidarse del campo.
   */
  variantId: string | null;
  /** Nombre visible, para que el pedido se lea sin volver a consultar la tienda. */
  title: string;
  quantity: number;
  /** Precio unitario de lista, antes de descuento. */
  unitPrice: number;
}

/** Un cierre completo: de quién, de qué, y con qué descuento pactado. */
export interface SalesClosing {
  /**
   * La referencia del lead — en producción, el uuid de su conversación, que es
   * único por contacto y para siempre.
   *
   * **De aquí sale la llave de idempotencia**, y por eso no hay ningún campo de
   * fecha ni de intento en esta interfaz: si el instante pudiera entrar en la
   * llave, dos disparos del mismo cierre darían llaves distintas y saldrían dos
   * envíos contraentrega del mismo producto al mismo cliente.
   */
  leadRef: string;
  contact: ClosingContact;
  lines: readonly ClosingLine[];
  /**
   * Descuento pactado por el vendedor, en porcentaje sobre el precio de lista.
   * Es lo que el vendedor **propuso**; lo que se aplica lo decide el límite.
   */
  discountPct: number;
}

/**
 * Lo que el constructor necesita de `sales_agent_settings`. Los **recibe**: este
 * módulo no consulta la base, y por eso el límite se puede probar en cero, en
 * cincuenta y en cien sin tocar producción.
 */
export interface SalesSettings {
  /** `sales_agent_settings.discount_limit_pct`. La base lo restringe a 0..100. */
  discountLimitPct: number;
  /** `sales_agent_settings.display_name`: «Sebastián». */
  sellerName: string;
}

// ────────────────────────────────────────────────────────────────────────────
// La salida · el pedido, o los errores
// ────────────────────────────────────────────────────────────────────────────

/** Los seis requeridos del cierre. El sexto es «dirección o reclamo en oficina». */
export type RequiredField =
  | "firstName"
  | "lastName"
  | "phone"
  | "city"
  | "division"
  | "addressOrPickup";

/**
 * Por qué un cierre no se puede convertir en pedido. Salen **todos** los que
 * apliquen, no el primero: el vendedor tiene que poder pedir de una vez todo lo
 * que falta, y no arrastrar al cliente por una corrección por mensaje.
 */
export type SalesOrderError =
  | { code: "missing_required"; field: RequiredField }
  /** Dio dirección **y** dijo que reclama en oficina. No se elige por él. */
  | { code: "address_and_pickup_conflict" }
  | { code: "phone_invalid"; value: string }
  | { code: "division_unknown"; value: string }
  /** Ese municipio no existe en el país de la operación. */
  | { code: "city_unknown"; value: string }
  /**
   * El municipio existe en el país pero no en el departamento que dijo el
   * cliente. `divisions` trae dónde sí está, para poder preguntar con precisión
   * en vez de volver a pedir la dirección entera.
   */
  | { code: "city_in_other_division"; value: string; divisions: readonly string[] }
  /** No hay listas para el país de la operación: no se puede validar nada. */
  | { code: "country_unsupported"; countryCode: string }
  | { code: "no_lines" }
  | { code: "line_invalid"; index: number; reason: "quantity" | "price" };

/**
 * A dónde va el pedido. Es una unión, así que la coexistencia de dirección y
 * reclamo en oficina —que en la entrada es un error de validación— aquí no se
 * puede ni escribir.
 */
export type SalesOrderShipping =
  | {
      kind: "delivery";
      address: string;
      /** Nombre **canónico**, no lo que tecleó el cliente. */
      city: string;
      division: string;
      countryCode: string;
    }
  | {
      kind: "pickup_at_office";
      city: string;
      division: string;
      countryCode: string;
    };

/** Una línea del payload, con los dos precios a la vista. */
export interface SalesOrderLine {
  productId: string;
  /** `null` = línea suelta: el producto no está en la tienda. Ver {@link ClosingLine}. */
  variantId: string | null;
  title: string;
  quantity: number;
  /** Precio de lista, sin descuento. */
  listUnitPrice: number;
  /** Precio al que se cobra, con el descuento ya aplicado y clampeado. */
  unitPrice: number;
  lineTotal: number;
}

/** El pedido listo para crear en la tienda de su operación. */
export interface SalesOrderDraft {
  /** La tienda destino, tomada del mismo valor que la moneda. */
  store: { operationId: OperationId; shopDomain: string };
  /** ISO 4217 de la operación. */
  currency: string;
  /** Contraentrega: el cobro no ocurrió, ocurre al entregar. */
  financialStatus: "pending";
  paymentMethod: "cash_on_delivery";
  customer: {
    firstName: string;
    lastName: string;
    /** E.164, validado contra el país de la operación. */
    phone: string;
    email: string | null;
  };
  shipping: SalesOrderShipping;
  lines: readonly SalesOrderLine[];
  totals: { subtotal: number; discount: number; total: number };
  /** Origen de ventas, vendedor y —si aplica— reclamo en oficina. */
  tags: readonly string[];
  /** Derivada del lead y de lo que compró. Ver {@link idempotencyKeyFor}. */
  idempotencyKey: string;
}

/**
 * Qué pasó con el descuento. `clamped` es la señal que el orquestador escala:
 * hubo una negociación fuera de rango, el pedido se creó igual al precio bueno,
 * y un asesor tiene que decidir si la honra.
 */
export interface DiscountOutcome {
  /** Lo que el vendedor pactó. */
  requestedPct: number;
  /** Lo que se aplicó de verdad. */
  appliedPct: number;
  /** El límite vigente de la operación. */
  limitPct: number;
  clamped: boolean;
}

/**
 * O un pedido, o los errores. Nunca las dos cosas, y nunca ninguna: la lista de
 * errores del caso fallido tiene **al menos uno** por tipo.
 */
export type SalesOrderResult =
  | { ok: true; order: SalesOrderDraft; discount: DiscountOutcome }
  | { ok: false; errors: readonly [SalesOrderError, ...SalesOrderError[]] };

// ────────────────────────────────────────────────────────────────────────────
// La función
// ────────────────────────────────────────────────────────────────────────────

/**
 * El constructor de orden.
 *
 * Valida contra el país de la operación, mapea al payload, aplica el clamp del
 * descuento y deriva la llave de idempotencia. Es donde el límite de descuento
 * deja de ser texto en un prompt y se vuelve una regla.
 */
export function buildSalesOrder(input: {
  store: SalesOrderStore;
  closing: SalesClosing;
  settings: SalesSettings;
}): SalesOrderResult {
  const { store, closing, settings } = input;
  const validated = validateClosing(store, closing);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const discount = resolveDiscount(closing.discountPct, settings.discountLimitPct);
  const lines = validated.value.lines.map((line) =>
    priceLine(line, discount.appliedPct),
  );
  // Los totales se derivan de las líneas ya redondeadas, no de la entrada
  // cruda: lo que suma el pedido tiene que ser lo que dicen sus líneas.
  const subtotal = round2(
    lines.reduce((sum, l) => sum + l.listUnitPrice * l.quantity, 0),
  );
  const total = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));

  return {
    ok: true,
    discount,
    order: {
      store: { operationId: store.operationId, shopDomain: store.shopDomain },
      currency: store.currency,
      financialStatus: "pending",
      paymentMethod: "cash_on_delivery",
      customer: validated.value.customer,
      shipping: validated.value.shipping,
      lines,
      totals: { subtotal, discount: round2(subtotal - total), total },
      tags: orderTags(settings.sellerName, validated.value.shipping, lines),
      idempotencyKey: idempotencyKeyFor(store, closing),
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Ayudantes · no se exportan a propósito: no son costuras
// ────────────────────────────────────────────────────────────────────────────

interface ValidClosing {
  customer: SalesOrderDraft["customer"];
  shipping: SalesOrderShipping;
  lines: readonly ClosingLine[];
}

type Validation =
  | { ok: true; value: ValidClosing }
  | { ok: false; errors: readonly [SalesOrderError, ...SalesOrderError[]] };

function validateClosing(
  store: SalesOrderStore,
  closing: SalesClosing,
): Validation {
  const errors: SalesOrderError[] = [];
  const c = closing.contact;

  const firstName = trimmed(c.firstName);
  const lastName = trimmed(c.lastName);
  const phoneRaw = trimmed(c.phone);
  const cityRaw = trimmed(c.city);
  const divisionRaw = trimmed(c.division);
  const address = trimmed(c.address);

  if (!firstName) errors.push({ code: "missing_required", field: "firstName" });
  if (!lastName) errors.push({ code: "missing_required", field: "lastName" });
  if (!phoneRaw) errors.push({ code: "missing_required", field: "phone" });
  if (!cityRaw) errors.push({ code: "missing_required", field: "city" });
  if (!divisionRaw) errors.push({ code: "missing_required", field: "division" });

  // Los dos modos de entrega son excluyentes en ambos sentidos: ni ninguno ni
  // los dos. Que coexistan no se resuelve eligiendo — el cliente dijo dos cosas
  // distintas y hay que preguntarle cuál.
  if (address && c.pickupAtOffice) {
    errors.push({ code: "address_and_pickup_conflict" });
  } else if (!address && !c.pickupAtOffice) {
    errors.push({ code: "missing_required", field: "addressOrPickup" });
  }

  const rules = countryRules(store.countryCode);
  if (!rules) {
    errors.push({ code: "country_unsupported", countryCode: store.countryCode });
  }

  const phone = rules && phoneRaw ? resolvePhone(rules, phoneRaw) : null;
  if (rules && phoneRaw && !phone) {
    errors.push({ code: "phone_invalid", value: phoneRaw });
  }

  const place = rules ? resolvePlace(rules, cityRaw, divisionRaw) : null;
  if (place) errors.push(...place.errors);

  errors.push(...validateLines(closing.lines));

  const [first, ...rest] = errors;
  if (first) return { ok: false, errors: [first, ...rest] };

  // Sin errores, teléfono y lugar quedaron resueltos. Lo único que puede
  // dejarlos en `null` sin haber empujado un error es que no hubiera reglas de
  // país, y eso ya empujó `country_unsupported` arriba — así que esto es
  // inalcanzable. Se comprueba igual, y con el error que le corresponde, para
  // que el compilador no tenga que creerme y para que un cambio futuro que
  // rompa la invariante devuelva un error en vez de fabricar medio pedido.
  if (!phone || !place?.city || !place.division) {
    return {
      ok: false,
      errors: [{ code: "country_unsupported", countryCode: store.countryCode }],
    };
  }

  const location = {
    city: place.city,
    division: place.division,
    countryCode: store.countryCode,
  };
  return {
    ok: true,
    value: {
      customer: { firstName, lastName, phone, email: trimmed(c.email) || null },
      shipping: c.pickupAtOffice
        ? { kind: "pickup_at_office", ...location }
        : { kind: "delivery", address, ...location },
      lines: closing.lines,
    },
  };
}

interface PlaceResolution {
  city: string | null;
  division: string | null;
  errors: readonly SalesOrderError[];
}

/**
 * Ciudad y departamento contra la lista **del país de la operación**.
 *
 * Los dos errores salen juntos cuando los dos aplican, y el caso intermedio
 * —«el municipio existe, pero en otro departamento»— es su propio error: es la
 * confusión real («Antigua Guatemala» con departamento «Guatemala») y merece
 * una repregunta distinta a «ese municipio no existe».
 */
function resolvePlace(
  rules: CountryRules,
  cityRaw: string,
  divisionRaw: string,
): PlaceResolution {
  const errors: SalesOrderError[] = [];
  const division = divisionRaw ? resolveDivision(rules, divisionRaw) : null;
  if (divisionRaw && !division) {
    errors.push({ code: "division_unknown", value: divisionRaw });
  }

  const match = cityRaw ? findCity(rules, cityRaw) : null;
  if (cityRaw && !match) {
    errors.push({ code: "city_unknown", value: cityRaw });
  } else if (match && division && !match.divisions.includes(division)) {
    errors.push({
      code: "city_in_other_division",
      value: cityRaw,
      divisions: match.divisions,
    });
  }

  return { city: match?.name ?? null, division, errors };
}

function validateLines(lines: readonly ClosingLine[]): SalesOrderError[] {
  if (lines.length === 0) return [{ code: "no_lines" }];
  const errors: SalesOrderError[] = [];
  lines.forEach((line, index) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      errors.push({ code: "line_invalid", index, reason: "quantity" });
    }
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
      errors.push({ code: "line_invalid", index, reason: "price" });
    }
  });
  return errors;
}

/**
 * El clamp. `applied = min(pactado, límite)`, y nunca falla.
 *
 * Un pactado negativo se lee como cero —un «descuento» que sube el precio no es
 * una negociación, es un dato malo— y un límite fuera de 0..100 se recorta,
 * aunque la base ya lo restrinja: este módulo no supone que su entrada venga de
 * la base.
 */
function resolveDiscount(
  requestedPct: number,
  limitPct: number,
): DiscountOutcome {
  const requested = clampPct(requestedPct);
  const limit = clampPct(limitPct);
  const applied = Math.min(requested, limit);
  return {
    requestedPct: requested,
    appliedPct: applied,
    limitPct: limit,
    clamped: applied < requested,
  };
}

function priceLine(line: ClosingLine, appliedPct: number): SalesOrderLine {
  const unitPrice = round2((line.unitPrice * (100 - appliedPct)) / 100);
  return {
    productId: line.productId,
    variantId: line.variantId,
    title: line.title,
    quantity: line.quantity,
    listUnitPrice: round2(line.unitPrice),
    unitPrice,
    lineTotal: round2(unitPrice * line.quantity),
  };
}

/**
 * Las etiquetas del pedido: origen de ventas siempre, vendedor cuando la
 * operación lo tiene configurado, y reclamo en oficina cuando aplica.
 *
 * El nombre del vendedor arranca vacío en `sales_agent_settings` y el panel lo
 * llena. Vacío se omite la etiqueta en vez de escribir `vendedor:`, que en los
 * reportes de la tienda es ruido que parece un vendedor llamado «nada».
 */
function orderTags(
  sellerName: string,
  shipping: SalesOrderShipping,
  lines: readonly SalesOrderLine[],
): readonly string[] {
  const tags = [SALES_ORDER_TAG];
  const seller = sellerName.trim();
  if (seller) tags.push(`${SELLER_TAG_PREFIX}${seller}`);
  if (shipping.kind === "pickup_at_office") tags.push(PICKUP_AT_OFFICE_TAG);
  // Basta **una** línea suelta para que el pedido entero necesite otro trato en
  // la bodega, así que la etiqueta es del pedido y no de la línea. Un pedido
  // enteramente de la tienda sale con exactamente las etiquetas de antes de
  // este ticket.
  if (lines.some((l) => l.variantId === null)) tags.push(OFF_CATALOG_TAG);
  return tags;
}

/**
 * **Qué compró**, como un texto estable: la única derivación del carrito.
 *
 * Se exporta —y es la única excepción a «una sola función exportada»— porque la
 * escribe este archivo y la lee también `sales/closing.ts`, que deduplica el
 * cierre en la cola **antes** de que exista la llave de idempotencia. Las dos
 * tienen que ser la misma cuenta: si se separaran, dos disparos del mismo
 * cierre podrían colisionar en una y no en la otra, y esa grieta se paga con un
 * segundo envío contraentrega del mismo producto al mismo cliente.
 *
 * Un producto **nativo** no tiene variante, así que se identifica por su
 * producto. El prefijo impide que un id de producto pueda hacerse pasar por uno
 * de variante — hoy no podría (uno es uuid y el otro un GID de Shopify), pero
 * la llave que evita el pedido duplicado no es el sitio donde uno se apoya en
 * «no puede pasar». Para un producto conectado la cuenta es **idéntica a la de
 * antes de este ticket**: mismo texto, misma llave, mismo pedido.
 */
export function cartOf(lines: readonly ClosingLine[]): string {
  return lines
    .map(
      (l) =>
        `${l.variantId === null ? `producto:${l.productId}` : l.variantId}x${l.quantity}`,
    )
    .sort()
    .join("|");
}

/**
 * La llave de idempotencia: **del lead y de lo que compró**, de nada más.
 *
 * Ni el instante ni un aleatorio entran, que es lo que hace que dos disparos del
 * mismo cierre colisionen y produzcan una sola orden — la protección contra dos
 * envíos contraentrega del mismo producto al mismo cliente.
 *
 * Lo que sí entra además del lead son las líneas, y eso no es un adorno: hay
 * **una conversación por contacto para siempre** (`conversations.contact_id` es
 * único), así que una llave que fuera solo del lead bloquearía la recompra de
 * ese cliente hasta el fin de los tiempos. Con las líneas dentro, el reintento
 * del mismo cierre colisiona y la compra nueva no.
 *
 * Lo que **no** entra son los datos personales: corregir un dígito del teléfono
 * o completar la dirección entre dos intentos no puede crear un pedido nuevo —
 * ese es exactamente el duplicado que se quiere evitar. Las líneas se ordenan
 * antes de mezclarlas para que el orden en que el vendedor las agregó no cambie
 * la llave.
 */
function idempotencyKeyFor(
  store: SalesOrderStore,
  closing: SalesClosing,
): string {
  const digest = createHash("sha256")
    .update(
      [store.operationId, closing.leadRef, cartOf(closing.lines)].join(" "),
    )
    .digest("hex");
  return `ventas-${digest.slice(0, 24)}`;
}

function trimmed(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Dos decimales, que es lo que aguanta el dinero de una tienda. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
