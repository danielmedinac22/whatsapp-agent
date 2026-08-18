/**
 * A qué bandeja pertenece una conversación: la de ventas o la de operaciones.
 *
 * Todo lo de este archivo es PURO: no toca la base ni el reloj. Recibe hechos
 * —cuándo fue el último clic de anuncio, qué pedidos tiene el contacto y en qué
 * estado van— y devuelve la bandeja. Se prueba con fixtures de dos campos, no
 * con una conexión a producción.
 *
 * **La bandeja no se guarda en ninguna parte, a propósito.** El sistema ya
 * tiene tres máquinas de estado —el pipeline del pedido de tienda
 * (`order_status`), la confirmación de la conversación y los quince estados de
 * logística (`dropi_status`)— y una cuarta *guardada* tendría que mantenerse de
 * acuerdo con las tres; la que miente siempre es la que un humano olvidó
 * actualizar. Derivarla la vuelve incapaz de desactualizarse. Y como hay **una
 * conversación por contacto, para siempre** (`conversations.contact_id` es
 * único), un campo que se sobrescribiera dejaría al recomprador con su estado
 * de julio encima.
 *
 * Reglas, de mayor a menor precedencia:
 *
 * 1. Clic de anuncio **posterior al último pedido** → ventas. Es el
 *    recomprador: un clic nuevo es intención de compra nueva.
 * 2. Pedido en curso (ni entregado ni cancelado) → operaciones.
 * 3. Pedido terminado (entregado o cancelado), sin clic posterior → operaciones.
 * 4. Nada de lo anterior → ventas. Un mensaje sin pedido es un lead.
 *
 * Quien alimenta {@link resolveInbox} carga: `lastAdClickAt` con la atribución
 * de anuncio **más reciente** de la conversación (no la primera: si solo se
 * guardara el primer clic, el recomprador nunca volvería a ventas), y `orders`
 * con los pedidos de tienda del contacto cruzados con su fila de logística, más
 * los pedidos que existen solo en logística.
 */

import type { DropiOrder, ShopifyOrder } from "./schema";

/**
 * Las dos bandejas. Son los mismos nombres que los roles `ventas` y
 * `operaciones` (ticket 01): quien tiene el rol ve la bandeja homónima.
 */
export type Inbox = "ventas" | "operaciones";

/**
 * Estado del pipeline del pedido de tienda (`order_status`). Es el tipo del
 * enum real y no una copia a mano: si el esquema gana un estado, el `switch`
 * exhaustivo de {@link resolveOrderPhase} deja de compilar hasta que alguien
 * decida en qué fase cae. Es un import solo de tipo —no trae la tabla ni el
 * cliente— y es el mismo idioma que `jobs/dropi-poll.ts` y `dropi/notify.ts`.
 */
export type OrderPipelineStatus = ShopifyOrder["status"];

/** Estado logístico del pedido (`dropi_status`). Mismo criterio que arriba. */
export type OrderLogisticsStatus = DropiOrder["status"];

/**
 * Lo mínimo que hace falta saber de un pedido para rutear. Es una forma
 * estructural y no la fila entera para que los tests escriban fixtures de dos
 * o tres campos.
 */
export interface OrderFacts {
  /**
   * Cuándo se creó el pedido —`shopify_orders.received_at`, o el `created_at`
   * de la fila de logística si nunca pasó por la tienda—. Es contra lo que se
   * compara el clic de anuncio.
   */
  createdAt: Date;
  /** Estado del pipeline de tienda. `null` si el pedido no vino por la tienda. */
  pipelineStatus: OrderPipelineStatus | null;
  /** Estado logístico. `null` si el pedido todavía no existe en logística. */
  logisticsStatus: OrderLogisticsStatus | null;
}

/**
 * En qué punto de su vida está un pedido, a los ojos del ruteo.
 *
 * - `in_progress`: a operaciones le queda algo por empujar — confirmar, generar
 *   guía, seguir el envío, resolver una novedad, lograr que el cliente reclame
 *   en oficina.
 * - `finished`: la historia logística terminó. Entregado, o la entrega no se
 *   dio (anulado, rechazado, devuelto, retornado). No queda nada por empujar.
 *
 * Hoy las dos fases rutean a operaciones; la fase se expone igual porque es
 * la decisión que las reglas 2 y 3 enuncian por separado, y porque la bandeja
 * de operaciones (ticket 03) distingue «por confirmar y en camino» de lo que ya
 * terminó.
 */
export type OrderPhase = "in_progress" | "finished";

/**
 * Lo que la logística dice de la fase del pedido, si dice algo.
 *
 * `null` solo para `unknown`: es «Dropi reportó algo que no supimos mapear» o
 * la fila recién creada, no una fase. Ahí decide el pipeline de tienda.
 *
 * Los tres estados que ya mordieron antes están decididos aquí a conciencia:
 * `en_oficina` no es `entregado` (el paquete está en la oficina esperando a
 * que el cliente lo reclame; decirle «ya fue entregado» a quien no lo tiene
 * fue un problema real), `novedad_solucionada` no es `entregado` (la novedad
 * se resolvió, la entrega sigue), y `devolucion` / `rechazado` / `retornado`
 * son terminales: la entrega no se dio y el paquete volvió — un nuevo intento
 * es un pedido nuevo en Dropi, no una continuación de este. Es como
 * `dropi/normalize.ts` ya los nombra («terminales de devolución») y como
 * `@wa/shared` los agrupa en la situación «Devuelto / retornado».
 */
function logisticsPhase(status: OrderLogisticsStatus): OrderPhase | null {
  switch (status) {
    case "unknown":
      return null;
    case "pendiente_confirmacion":
    case "pendiente":
    case "guia_generada":
    case "preparado_transportadora":
    case "recolectado":
    case "en_transito":
    case "con_mensajero":
    case "en_oficina":
    case "novedad":
    case "novedad_solucionada":
      return "in_progress";
    case "entregado":
    case "anulada":
    case "rechazado":
    case "devolucion":
    case "retornado":
      return "finished";
    default: {
      // Si esto deja de compilar es que el esquema ganó un estado logístico y
      // hay que decidir aquí en qué fase cae — no dejarlo caer en un `else`.
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/**
 * Lo que el pipeline de tienda dice de la fase del pedido.
 *
 * `no_response` no es cancelado: el cliente no contestó el seguimiento, pero
 * el pedido sigue ahí sin confirmar ni anular; a operaciones le queda cerrarlo
 * por un lado o por el otro. Solo `cancelled` termina el pedido desde la tienda.
 */
function pipelinePhase(status: OrderPipelineStatus): OrderPhase {
  switch (status) {
    case "received":
    case "followup_scheduled":
    case "followup_sent":
    case "confirmed":
    case "no_response":
      return "in_progress";
    case "cancelled":
      return "finished";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/**
 * La fase de un pedido, combinando sus dos máquinas de estado.
 *
 * **Cuando la logística sabe, la logística manda.** El pipeline de tienda habla
 * de la confirmación y se queda quieto en cuanto el pedido entra a Dropi: en
 * producción hay pedidos `followup_sent` que la logística entregó igual, y
 * pedidos `confirmed` que Dropi anuló. Por eso el pipeline solo decide cuando
 * no hay información logística (`null` o `unknown`), y un pedido del que no se
 * sabe nada cuenta como en curso: existe, y nadie ha dicho que terminó.
 */
export function resolveOrderPhase(order: OrderFacts): OrderPhase {
  if (order.logisticsStatus !== null) {
    const phase = logisticsPhase(order.logisticsStatus);
    if (phase !== null) return phase;
  }
  if (order.pipelineStatus !== null) return pipelinePhase(order.pipelineStatus);
  return "in_progress";
}

/** Los hechos de una conversación que el ruteo necesita. Nada más. */
export interface InboxFacts {
  /**
   * Cuándo llegó el último mensaje con atribución de anuncio (referral CTWA).
   * `null` si el contacto nunca llegó por un anuncio. Tiene que ser el **más
   * reciente**, no el primero: la regla del recomprador compara este instante
   * con el del último pedido.
   */
  lastAdClickAt: Date | null;
  /** Todos los pedidos del contacto, en cualquier orden. */
  orders: readonly OrderFacts[];
}

/**
 * Cuál de las cuatro reglas decidió la bandeja. No es decorativo: es lo que
 * hace verificable en un test que el recomprador cayó en ventas *por el clic*
 * y no por casualidad, y le da a la bandeja de operaciones (ticket 03) la
 * diferencia entre «en camino» y «terminado» sin volver a derivarla.
 */
export type InboxRule =
  /** Regla 1: clic de anuncio posterior al último pedido. El recomprador. */
  | "ad_click_after_last_order"
  /** Regla 2: hay al menos un pedido en curso. */
  | "order_in_progress"
  /** Regla 3: todos los pedidos terminaron y no hubo clic después. */
  | "order_finished"
  /** Regla 4: sin pedido. Un lead, o un contacto sin nada. */
  | "no_order";

/**
 * La bandeja y la regla que la decidió. No existe un caso «ninguna bandeja»,
 * y eso es deliberado: toda conversación cae en una, así que ninguna se puede
 * perder entre las dos. Si el llamador no sabe nada del contacto, es un lead.
 */
export interface InboxDecision {
  inbox: Inbox;
  rule: InboxRule;
}

/** El pedido más reciente por fecha de creación, o `null` si no hay ninguno. */
function latestOrder(orders: readonly OrderFacts[]): OrderFacts | null {
  let latest: OrderFacts | null = null;
  for (const order of orders) {
    if (latest === null || order.createdAt.getTime() > latest.createdAt.getTime()) {
      latest = order;
    }
  }
  return latest;
}

/**
 * A qué bandeja pertenece la conversación, y por qué.
 *
 * El clic tiene que ser **estrictamente** posterior al último pedido: el pedido
 * que nace de una venta se crea después del clic que la trajo, así que «clic
 * anterior o igual» significa «esa venta ya cerró» y la conversación pasa a
 * operaciones. Un clic posterior es otra intención de compra, aunque el pedido
 * anterior siga en camino: ventas la toma, y las notificaciones logísticas del
 * pedido en curso siguen saliendo por su cuenta porque no dependen de la
 * bandeja.
 */
export function resolveInbox(facts: InboxFacts): InboxDecision {
  const last = latestOrder(facts.orders);
  if (last === null) {
    return { inbox: "ventas", rule: "no_order" };
  }
  if (
    facts.lastAdClickAt !== null &&
    facts.lastAdClickAt.getTime() > last.createdAt.getTime()
  ) {
    return { inbox: "ventas", rule: "ad_click_after_last_order" };
  }
  const anyInProgress = facts.orders.some(
    (order) => resolveOrderPhase(order) === "in_progress",
  );
  return {
    inbox: "operaciones",
    rule: anyInProgress ? "order_in_progress" : "order_finished",
  };
}
