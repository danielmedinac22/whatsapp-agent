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
 * **La bandeja de ventas se define en positivo, no por resta.** Una conversación
 * es del vendedor si hay un motivo para creerlo —llegó por un anuncio, o nació
 * después de que se encendiera el vendedor—, nunca por *no* tener pedido. Esa
 * frase costó 110 conversaciones: la regla `no_order` mandaba a ventas todo
 * contacto sin fila de pedido, y en Guatemala eso eran 110 contactos que
 * escribieron y nunca compraron —de Katherine, todos— presentados como
 * pendientes de un vendedor que ni siquiera estaba encendido.
 *
 * Reglas, de mayor a menor precedencia:
 *
 * 1. Clic de anuncio **posterior al último pedido** → ventas. Es el
 *    recomprador: un clic nuevo es intención de compra nueva.
 * 2. Pedido en curso (ni entregado ni cancelado) → operaciones.
 * 3. Pedido terminado (entregado o cancelado), sin clic posterior → operaciones.
 * 4. Sin pedido y **nacida después de la línea de corte** → ventas. Es el lead
 *    del vendedor.
 * 5. Sin pedido, nacida antes del corte, pero con un **clic de anuncio
 *    posterior al corte** → ventas. Es la regla 1 para quien nunca compró: la 1
 *    compara el clic contra el último pedido, y sin ningún pedido no llega a
 *    dispararse.
 * 6. Nada de lo anterior → operaciones. Es el histórico de Katherine, y lo es
 *    para siempre.
 *
 * Quien alimenta {@link resolveInbox} carga: `lastAdClickAt` con la atribución
 * de anuncio **más reciente** de la conversación (no la primera: si solo se
 * guardara el primer clic, el recomprador nunca volvería a ventas), y `orders`
 * con los pedidos de tienda del contacto cruzados con su fila de logística, más
 * los pedidos que existen solo en logística. La línea de corte va aparte, en
 * {@link SalesCutoff}: no es un hecho de la conversación sino de la operación.
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
 * **La línea de corte del vendedor**, frente a una conversación concreta.
 *
 * Va aparte de {@link InboxFacts} porque mezcla dos cosas de origen distinto: el
 * instante en que la operación encendió al vendedor —`activated_at`, uno solo
 * para toda la operación— y el nacimiento de esta conversación. Los hechos de
 * la conversación no saben de configuración, y meter `activated_at` entre ellos
 * invitaría a cargarlo por conversación.
 *
 * **Mira la fecha de nacimiento y no la última actividad.** Lo histórico es de
 * Katherine para siempre: mirar la actividad movería conversaciones vivas de
 * bandeja sin que nadie lo pida, que es justo lo que `no-regresion.md` prohíbe.
 * El caso que eso querría cubrir —el que vuelve con intención nueva— lo cubren
 * las reglas del clic, la 1 y la 5, el día que haya anuncios.
 */
export interface SalesCutoff {
  /**
   * `sales_agent_settings.activated_at`. `null` cuando la operación no tiene
   * vendedor encendido —el estado de producción hoy—, y entonces **nada** cae
   * en ventas por no tener pedido.
   */
  activatedAt: Date | null;
  /**
   * Cuándo nació la conversación (`conversations.created_at`).
   *
   * Se eligió la conversación y no el contacto porque es la conversación lo que
   * se rutea, y porque {@link InboxFacts} ya es «los hechos de una
   * conversación». Da igual cuál: hay **una conversación por contacto** —1.760
   * y 1.760 en producción el 19-ago-2026— y la conversación se crea en el mismo
   * `handleInbound` que el contacto, medido a menos de medio segundo de
   * distancia en las 54 filas donde los dos instantes no coinciden al segundo.
   */
  bornAt: Date;
}

/**
 * Sin vendedor no hay línea de corte, y sin línea de corte la bandeja de ventas
 * no recibe nada por la regla 4.
 *
 * Es el valor que {@link resolveInbox} usa cuando el llamador no pasa corte, y
 * está nombrado para que en el sitio donde se usa se lea qué significa omitirlo.
 */
const SIN_VENDEDOR: SalesCutoff = {
  activatedAt: null,
  // Nunca se compara: sin `activatedAt` las reglas 4 y 5 salen antes de mirarlo.
  bornAt: new Date(0),
};

/**
 * Cuál de las seis reglas decidió la bandeja. No es decorativo: es lo que
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
  /**
   * Regla 4: sin pedido y nacida después de encender al vendedor. **El lead.**
   */
  | "born_after_activation"
  /**
   * Regla 5: sin pedido, más vieja que el corte, y con un clic de anuncio
   * posterior al corte.
   *
   * **Es el agujero que el ticket no vio, y es el caso que la pauta paga.** La
   * regla 1 trae al recomprador comparando el clic contra su último pedido; a
   * quien nunca compró no lo alcanza, porque sin ningún pedido esa comparación
   * no llega a hacerse. En Guatemala son **110 conversaciones** —contactos que
   * escribieron y nunca generaron pedido, medido el 19-ago-2026—: sin esta
   * regla, el día que empiecen a llegar anuncios, un clic de cualquiera de esos
   * 110 caería en la bandeja de Katherine.
   *
   * El clic tiene que ser **posterior al corte** por lo mismo que el
   * nacimiento: un clic anterior es historia, y mover historia de bandeja es lo
   * que `no-regresion.md` prohíbe. Con `activated_at` en `null` no se dispara
   * nunca, así que no cambia nada de lo de hoy.
   */
  | "ad_click_after_activation"
  /**
   * Regla 6: sin pedido y sin ningún motivo posterior al corte. Es el contacto
   * que escribió y nunca compró **antes** de que existiera el vendedor:
   * histórico de Katherine, y sigue siéndolo.
   */
  | "no_order";

/**
 * La bandeja y la regla que la decidió. No existe un caso «ninguna bandeja»,
 * y eso es deliberado: toda conversación cae en una, así que ninguna se puede
 * perder entre las dos. Si el llamador no sabe nada del contacto, la bandeja es
 * la de operaciones —la de siempre—: el módulo nuevo no se queda con lo que no
 * puede explicar.
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
 * Qué motivo hay, si hay alguno, para creer que una conversación **sin pedido**
 * es del vendedor. `null` cuando no hay ninguno.
 *
 * Los dos motivos son **estrictamente posteriores** al corte, por el mismo
 * criterio con el que el clic del recomprador tiene que ser estrictamente
 * posterior al pedido: lo que ya existía en el instante del encendido no lo
 * trajo el vendedor, y lo que ocurre en el mismo milisegundo es una
 * coincidencia de reloj, no una venta suya. El borde cae del lado conservador,
 * que es el lado en el que Katherine conserva lo que ya atendía.
 */
function salesLeadRule(
  facts: InboxFacts,
  cutoff: SalesCutoff,
): Extract<InboxRule, "born_after_activation" | "ad_click_after_activation"> | null {
  const activatedAt = cutoff.activatedAt;
  if (activatedAt === null) return null;
  if (cutoff.bornAt.getTime() > activatedAt.getTime()) {
    return "born_after_activation";
  }
  if (
    facts.lastAdClickAt !== null &&
    facts.lastAdClickAt.getTime() > activatedAt.getTime()
  ) {
    return "ad_click_after_activation";
  }
  return null;
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
 *
 * **Omitir el corte significa «no hay vendedor»**, y con eso lo único que puede
 * caer en la bandeja de ventas es el recomprador de la regla 1. El valor por
 * defecto es el conservador a propósito: un llamador que todavía no carga
 * `activated_at` —el panel, hasta el ticket 03— deja la conversación sin pedido
 * en la bandeja de Katherine, que es donde estaba antes de que existiera el
 * módulo. El error posible es no mostrarle un lead al vendedor, nunca mudarle
 * una conversación viva a Katherine.
 */
export function resolveInbox(
  facts: InboxFacts,
  cutoff: SalesCutoff = SIN_VENDEDOR,
): InboxDecision {
  const last = latestOrder(facts.orders);
  if (last === null) {
    const lead = salesLeadRule(facts, cutoff);
    return lead === null
      ? { inbox: "operaciones", rule: "no_order" }
      : { inbox: "ventas", rule: lead };
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

/**
 * La línea de corte tal como era en un instante pasado.
 *
 * Un vendedor que se encendió **después** de `at` no existía entonces, así que
 * a esa fecha la conversación sin pedido era de Katherine. El nacimiento no se
 * recorta: una conversación no puede haber sido asignada antes de existir.
 */
function cutoffAsOf(cutoff: SalesCutoff, at: Date): SalesCutoff {
  return cutoff.activatedAt !== null && cutoff.activatedAt.getTime() <= at.getTime()
    ? cutoff
    : { activatedAt: null, bornAt: cutoff.bornAt };
}

/**
 * Los hechos tal como eran en un instante pasado.
 *
 * Solo recorta lo que **nació** después de `at`: los pedidos por su fecha de
 * creación y el clic de anuncio por la suya. No intenta reconstruir el estado
 * de un pedido a esa fecha, y no hace falta —ver {@link resolveInboxAsOf}.
 */
function factsAsOf(facts: InboxFacts, at: Date): InboxFacts {
  const t = at.getTime();
  return {
    lastAdClickAt:
      facts.lastAdClickAt !== null && facts.lastAdClickAt.getTime() <= t
        ? facts.lastAdClickAt
        : null,
    orders: facts.orders.filter((order) => order.createdAt.getTime() <= t),
  };
}

/**
 * En qué bandeja estaba la conversación en un instante pasado.
 *
 * **Es exacto, no una aproximación**, y la razón está en las cuatro reglas: la
 * bandeja depende de si había pedidos y de si el clic es posterior al último —
 * dos hechos de *creación*, que ya no cambian—. La fase del pedido (`en curso`
 * o `terminado`) sí cambia con el tiempo y aquí se usa la de hoy, pero las dos
 * fases rutean a operaciones, así que no puede alterar la respuesta. Si algún
 * día una fase rutea distinto, esta función deja de ser exacta y hay que
 * cargar el estado histórico: queda dicho acá para que se vea al cambiarlo.
 *
 * El límite real es otro y es del esquema: `conversations.ad_referral_at`
 * guarda **solo el clic más reciente**, así que un clic anterior a `at` que
 * después fue pisado por otro ya no existe para nadie. En ese caso esta
 * función responde con lo que se puede saber —sin clic—, no con un invento.
 */
export function resolveInboxAsOf(
  facts: InboxFacts,
  at: Date,
  cutoff: SalesCutoff = SIN_VENDEDOR,
): InboxDecision {
  return resolveInbox(factsAsOf(facts, at), cutoffAsOf(cutoff, at));
}

/**
 * Si la conversación cambió de bandeja desde un instante.
 *
 * Es lo que libera la asignación (`ventas-modulos-y-ruteo/04`): quien la vendía
 * ya no la está trabajando cuando la venta cerró y la conversación pasó a
 * operaciones. **No hay columna de bandeja que comparar** —la bandeja se
 * deriva, y ese es el punto de todo este archivo—, así que el cambio se detecta
 * volviendo a preguntar la misma regla sobre los hechos de entonces.
 *
 * Compara bandejas y no reglas a propósito: un pedido nuevo sobre una
 * conversación que ya estaba en operaciones cambia la regla —de
 * `order_finished` a `order_in_progress`— y **no cambia la bandeja**. Soltarle
 * la conversación a quien la está trabajando por eso sería castigar a un asesor
 * por un hecho que no lo movió de sitio.
 */
export function inboxChangedSince(
  facts: InboxFacts,
  since: Date,
  cutoff: SalesCutoff = SIN_VENDEDOR,
): boolean {
  return (
    resolveInboxAsOf(facts, since, cutoff).inbox !== resolveInbox(facts, cutoff).inbox
  );
}

/**
 * **La criba de la bandeja de ventas**: qué conversación *puede* caer en ella,
 * mirando solo lo que una consulta puede filtrar sin derivar nada.
 *
 * Es un **superconjunto declarado**, no la regla. Deja pasar de más —una
 * conversación con clic de anuncio anterior a su último pedido la pasa y
 * {@link resolveInbox} la manda a operaciones— y **no deja fuera ninguna que
 * la regla mandaría a ventas**. Esa asimetría es todo el contrato: equivocarse
 * de más cuesta derivar una fila que no hacía falta; equivocarse de menos
 * esconde una conversación, y eso es un cambio de producto disfrazado de
 * optimización.
 *
 * Existe por la misma razón y con la misma forma que
 * {@link puedeEstarSinResponder} (`sin-responder.ts`): para mostrar 200
 * conversaciones de la bandeja había que traer **todas** las de la operación,
 * pedir los pedidos de todos esos contactos y decidir fila por fila en
 * memoria. Con la bandeja apagada el Inbox lee 1.256 filas y no crece con la
 * tabla; encendida leía 8.606 y crecía en línea recta con cada conversación
 * que la operación acumulara. El render pasaba de O(recientes) a O(todas).
 * Cribar antes lo devuelve a O(las que pueden ser de ventas).
 *
 * **Por qué estos tres hechos y no otros.** Salen de leer las seis reglas al
 * revés, preguntando qué hace falta para que alguna mande a ventas:
 *
 * - regla 1 (el recomprador) y regla 5 (el clic sin pedido) **exigen un clic de
 *   anuncio**: sin `lastAdClickAt` ninguna de las dos llega a compararse;
 * - regla 4 (el lead) exige **no tener pedidos** y haber **nacido después del
 *   corte**;
 * - las reglas 2, 3 y 6 mandan a operaciones siempre.
 *
 * De ahí que baste con: *hubo clic de anuncio alguna vez*, **o** *no hay
 * ningún pedido y nació después del corte*. Sin línea de corte —la operación
 * no tiene vendedor encendido— la regla 4 no puede dispararse y solo queda el
 * clic.
 *
 * **El «sin pedidos» es lo que la vuelve pequeña, y por eso está.** Con solo
 * las dos columnas de `conversations` la criba deja pasar todo lo nacido desde
 * el encendido: el día uno son cero filas y un año después son todas las del
 * año, o sea el mismo problema con un año de atraso. Es el único de los tres
 * hechos que vive en otra tabla, y es el que hace que la criba mida la bandeja
 * y no el calendario.
 *
 * Lo que esta función **no** hace es decidir. Quien decide sigue siendo
 * {@link resolveInbox}, sobre lo que la criba deja pasar; el test que las ata
 * recorre todas las combinaciones de hechos y falla si alguna cae en ventas
 * sin haber pasado por acá.
 */
export interface SalesSieveFacts {
  /**
   * `conversations.ad_referral_at` — el clic de anuncio más reciente, o `null`.
   * Es el mismo campo que {@link InboxFacts.lastAdClickAt}; se nombra igual a
   * propósito, porque es el mismo hecho leído por la consulta que criba.
   */
  lastAdClickAt: Date | null;
  /** `conversations.created_at`: cuándo nació. La otra mitad del corte. */
  bornAt: Date;
  /**
   * Si el contacto tiene **algún** pedido en esta operación, de tienda o de
   * logística. Es `facts.orders.length > 0` dicho sin traer los pedidos: la
   * consulta lo responde con un `not exists` y no cargando las filas.
   */
  hasOrders: boolean;
}

/**
 * Si esta conversación puede caer en la bandeja de ventas. Ver
 * {@link SalesSieveFacts} para el contrato y por qué son estos tres hechos.
 */
export function puedeSerDeVentas(
  facts: SalesSieveFacts,
  activatedAt: Date | null,
): boolean {
  if (facts.lastAdClickAt !== null) return true;
  if (activatedAt === null) return false;
  return !facts.hasOrders && facts.bornAt.getTime() > activatedAt.getTime();
}
