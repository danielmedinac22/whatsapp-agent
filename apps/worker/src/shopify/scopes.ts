/**
 * Qué permisos necesita la tienda de una operación, y qué habilita cada uno.
 *
 * Todo lo de este archivo es PURO: declara los permisos y traduce «lo que el
 * token concede» a «lo que el sistema puede hacer». No pide nada por red — eso
 * es {@link readGrantedScopes} en `admin.ts`.
 *
 * ## Por qué existe
 *
 * `shopify_connection` está **vacía en producción**, así que hoy el sistema no
 * puede escribir en ninguna tienda. Cuando Vorare traiga las credenciales, el
 * token que peguen en el panel decide qué funciona: con `read_products` el
 * vendedor conversa con la ficha del producto, y solo con permiso de pedidos se
 * puede **crear** uno. Un token corto no falla al guardarse: falla más tarde,
 * en el cierre de una venta, con un `403` que nadie está mirando.
 *
 * Por eso los permisos se declaran acá y se **verifican en lectura al
 * conectar**, que es el riesgo R6 de la no-regresión: pedir solo lo necesario,
 * comprobar primero leyendo, y no conectar la creación automática hasta haberla
 * probado contra un pedido desechable.
 *
 * ## Solo lo necesario, y por qué no más
 *
 * - `read_products` — la ficha del producto en el prompt del vendedor y el
 *   buscador del catálogo del panel. Ya se usa hoy.
 * - `read_orders` — **la comprobación previa a crear**: se busca si el cierre
 *   ya produjo un pedido antes de crear otro. Es la mitad leída de la
 *   idempotencia, y sin ella un reintento duplica un envío contraentrega.
 * - `write_orders` — crear el pedido. Es el único permiso de escritura del
 *   sistema entero.
 *
 * **Lo que deliberadamente NO se pide:** `read_customers` (los datos del
 * cliente los captura la conversación, no se leen de la tienda),
 * `read_all_orders` (la ventana de 60 días de la API alcanza de sobra para
 * comprobar un cierre que acaba de ocurrir), `write_products`, `write_inventory`
 * y `write_fulfillments` (la guía nace de la integración Shopify↔Dropi, que es
 * ajena a este sistema). Cada permiso que no se pide es una escritura que no
 * puede ocurrir por error.
 */

/** Leer productos: la ficha en el prompt y el buscador del catálogo. */
export const SCOPE_READ_PRODUCTS = "read_products";
/** Leer pedidos: la comprobación previa que evita el duplicado. */
export const SCOPE_READ_ORDERS = "read_orders";
/** Crear pedidos. El único permiso de escritura del sistema. */
export const SCOPE_WRITE_ORDERS = "write_orders";

/**
 * Los permisos que se le piden a la tienda, en el orden en que conviene
 * explicarlos. Es la lista que se replica en Colombia sin adivinar.
 */
export const REQUESTED_SCOPES: readonly string[] = [
  SCOPE_READ_PRODUCTS,
  SCOPE_READ_ORDERS,
  SCOPE_WRITE_ORDERS,
];

/** Qué sabe hacer el sistema con la tienda, una vez conectada. */
export type StoreCapability =
  /** Conversar con la ficha del producto y buscar en el catálogo. */
  | "product_context"
  /** Comprobar si un cierre ya produjo pedido, antes de crear otro. */
  | "order_lookup"
  /** Crear el pedido del cierre. */
  | "order_create";

export interface CapabilitySpec {
  capability: StoreCapability;
  /** Todos los permisos de la lista, no cualquiera. */
  scopes: readonly string[];
  /** Qué deja de funcionar sin ella, en lenguaje de operación. */
  label: string;
  missingConsequence: string;
}

/**
 * Qué habilita cada permiso, en lenguaje de operación.
 *
 * Las consecuencias están redactadas para que el admin del panel entienda qué
 * pierde sin leer código: es la pantalla honesta que pide el encargo, y su
 * texto sale de acá y no de un `if` en el componente.
 */
export const STORE_CAPABILITIES: readonly CapabilitySpec[] = [
  {
    capability: "product_context",
    scopes: [SCOPE_READ_PRODUCTS],
    label: "Leer productos",
    missingConsequence:
      "El vendedor conversa sin la ficha del producto y el catálogo no puede buscar en la tienda.",
  },
  {
    capability: "order_lookup",
    scopes: [SCOPE_READ_ORDERS],
    label: "Leer pedidos",
    missingConsequence:
      "No se puede comprobar si un cierre ya creó su pedido, así que un reintento podría duplicarlo. La creación queda bloqueada.",
  },
  {
    capability: "order_create",
    scopes: [SCOPE_READ_ORDERS, SCOPE_WRITE_ORDERS],
    label: "Crear pedidos",
    missingConsequence:
      "Una venta cerrada no aterriza en la tienda: queda en la cola de cierres pendientes esperando a una persona.",
  },
];

export interface CapabilityStatus extends CapabilitySpec {
  granted: boolean;
  /** Los permisos de {@link CapabilitySpec.scopes} que faltan. */
  missing: readonly string[];
}

export interface StoreCapabilityReport {
  /** Los permisos que el token concede, ya expandidos y normalizados. */
  granted: readonly string[];
  capabilities: readonly CapabilityStatus[];
  /** Permisos concedidos que el sistema no pide. Ver {@link excessScopes}. */
  excess: readonly string[];
}

/**
 * En Shopify, conceder `write_x` concede también `read_x`.
 *
 * Importa acá porque el token puede venir con `write_orders` y sin
 * `read_orders` en la lista, y sin esta expansión el panel diría que falta un
 * permiso que sí está — y bloquearía la creación por un dato mal leído.
 */
function expandGranted(granted: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of granted) {
    const scope = raw.trim().toLowerCase();
    if (!scope) continue;
    out.add(scope);
    if (scope.startsWith("write_")) out.add(`read_${scope.slice("write_".length)}`);
  }
  return out;
}

/**
 * Qué permisos de más trae el token.
 *
 * No es un fallo y no bloquea nada: es lo que hace verificable el criterio «no
 * más de lo necesario» del ticket 01, para que quien conecte la tienda vea de
 * una que pegó el token de otra app o que marcó de más en la pantalla de
 * Shopify. Un token con `write_products` sobre la tienda que factura es
 * capacidad de escritura que nadie pidió.
 *
 * Los `read_*` implícitos de un `write_*` concedido no cuentan como exceso: no
 * los concedió nadie, los deduce {@link expandGranted}.
 */
function excessScopes(granted: readonly string[]): string[] {
  const wanted = new Set(REQUESTED_SCOPES);
  return granted
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && !wanted.has(s))
    .filter((s, i, all) => all.indexOf(s) === i)
    .sort();
}

/**
 * De la lista de permisos que concede el token, a lo que el sistema puede
 * hacer con esa tienda.
 *
 * Es lo que la pantalla de conexión muestra después de guardar, y lo que
 * `order-create.ts` consulta antes de intentar una escritura que iba a fallar.
 */
export function resolveStoreCapabilities(
  granted: readonly string[],
): StoreCapabilityReport {
  const have = expandGranted(granted);
  return {
    granted: [...have].sort(),
    capabilities: STORE_CAPABILITIES.map((spec) => {
      const missing = spec.scopes.filter((s) => !have.has(s));
      return { ...spec, granted: missing.length === 0, missing };
    }),
    excess: excessScopes(granted),
  };
}

/** Si el token alcanza para una capacidad concreta. */
export function hasCapability(
  report: StoreCapabilityReport,
  capability: StoreCapability,
): boolean {
  return report.capabilities.some(
    (c) => c.capability === capability && c.granted,
  );
}
