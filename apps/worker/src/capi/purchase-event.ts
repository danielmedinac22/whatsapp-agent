/**
 * El evento de compra que se le devuelve a Meta.
 *
 * Todo lo de este archivo es PURO: no toca la base, ni el reloj, ni la red.
 * Recibe el pedido cerrado, la atribución que se persistió en el primer
 * contacto y la operación —con su moneda y su destino de CAPI—, y devuelve o el
 * evento listo para postear, o **la ausencia de evento con su motivo**. Quien
 * lo envía, con qué versión de la API, con cuántos reintentos y qué hace si
 * falla es el ticket 03, que además está bloqueado por un permiso que el token
 * todavía no trae (`whatsapp_business_manage_events`).
 *
 * ## La forma del evento, medida contra la documentación vigente
 *
 * Verificado el 17-ago-2026 contra *Conversions API for Business Messaging*
 * (`developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/`
 * y la guía de onboarding en `/documentation/ads-commerce/conversions-api/
 * business-messaging`). Tres cosas de ahí no son negociables y ninguna es
 * evidente:
 *
 * 1. **`action_source` es `"business_messaging"`, no `"website"`.** Una
 *    conversión de anuncio de clic a WhatsApp mandada como evento web no se
 *    asocia al anuncio: Meta la recibe y no aprende nada de ella. Y va
 *    acompañada de `messaging_channel: "whatsapp"`, que es lo que la distingue
 *    de Messenger y de Instagram Direct.
 * 2. **El destino es un *dataset*, no el píxel del sitio.** El dataset se crea
 *    desde la cuenta de WhatsApp (`POST /{whatsapp_business_account_id}/
 *    dataset`; el `GET` devuelve el que ya exista) y los eventos se postean en
 *    `POST /v{VERSION}/{dataset_id}/events`. Por eso la columna de la `0023` se
 *    llama `capi_dataset_id` y no `pixel_id`: el identificador del píxel
 *    publicitario de la cuenta es otro valor y mandaría los eventos a otro
 *    lado.
 * 3. **`user_data` lleva dos cosas y ninguna se hashea**: el `ctwa_clid` tal
 *    cual llegó en el `referral` (la tabla de parámetros de CAPI lo marca
 *    explícitamente «Do not hash») y el `whatsapp_business_account_id` de la
 *    cuenta que recibió el mensaje. No hay teléfono, ni correo, ni nada
 *    hasheado: la identidad del evento **es** el clic.
 *
 * La versión de la Graph API que se ve en los ejemplos de esa página es la
 * `v16.0`, que está congelada en la documentación; la vigente al 17-ago-2026 es
 * la `v26.0` (anunciada el 29-jul-2026). La versión es parte de la URL, así que
 * la elige quien envía —este módulo no arma URLs— y conviene fijarla explícita
 * en vez de heredar la que Meta tenga por defecto.
 *
 * ## La deduplicación es nuestra, no de Meta
 *
 * La misma página lo dice sin ambigüedad: *«Meta does not assist with
 * deduplicating events for Conversions API for Business Messaging»*, y
 * recomienda deduplicar antes de enviar. Por eso {@link buildPurchaseEvent}
 * devuelve una `deduplicationKey` **al lado del evento y no dentro**: el
 * `event_id` del CAPI genérico no aparece en la forma documentada de este flujo
 * y meter un campo que la documentación no lista, en un evento que alimenta un
 * algoritmo que no se puede desenvenenar, no compensa. La llave es para la cola
 * del ticket 03: dos construcciones del mismo pedido dan la misma llave, así
 * que un reintento se reconoce y no cuenta dos veces.
 *
 * ## Por qué «no hay evento» es un resultado y no un `null`
 *
 * Un pedido sin identificador de clic **no genera un evento anónimo**: genera
 * ninguno. Y no es un error — es el caso mayoritario, el del cliente que llegó
 * sin pasar por un anuncio. Devolverlo como una forma legítima del resultado, y
 * no como `null` o como excepción, es lo que impide que alguien «arregle» el
 * `null` mandando un evento sin `ctwa_clid`, que Meta aceptaría y no podría
 * atribuir a nada.
 */

import type { KapsoConnection, Operation } from "@wa/db";

// ────────────────────────────────────────────────────────────────────────────
// La forma del evento, tal como Meta la documenta
// ────────────────────────────────────────────────────────────────────────────

/**
 * El evento de compra de *Conversions API for Business Messaging*, con los
 * nombres de campo de Meta y no los nuestros: es formato de cable, y verlo
 * escrito igual que en la documentación es lo que permite compararlo a ojo con
 * la página.
 *
 * Los cuatro literales están fijos en el tipo a propósito. Son la diferencia
 * entre una conversión que Meta atribuye al anuncio y una que recibe y
 * descarta, y ninguno tiene por qué ser configurable: no existe una compra por
 * WhatsApp que se reporte con otro `action_source`.
 */
export interface MetaBusinessMessagingPurchaseEvent {
  readonly event_name: "Purchase";
  /** Segundos desde epoch (no milisegundos): cuándo se cerró el pedido. */
  readonly event_time: number;
  readonly action_source: "business_messaging";
  readonly messaging_channel: "whatsapp";
  readonly user_data: {
    /** La cuenta de WhatsApp que recibió el mensaje. Sin hashear. */
    readonly whatsapp_business_account_id: string;
    /** El identificador de clic, tal cual llegó en el `referral`. Sin hashear. */
    readonly ctwa_clid: string;
  };
  readonly custom_data: {
    /** ISO 4217, el de la operación. */
    readonly currency: string;
    /** El total del pedido en esa moneda. */
    readonly value: number;
  };
}

/** El cuerpo del `POST` a `/{dataset_id}/events`. */
export interface CapiRequestBody {
  readonly data: readonly MetaBusinessMessagingPurchaseEvent[];
  /**
   * El código de prueba del administrador de eventos. **Solo va cuando quien
   * envía lo pasa**: es el mecanismo del CAPI genérico y la página de business
   * messaging no lo lista, así que el ticket 04 tiene que confirmar en el
   * administrador de eventos que el evento de prueba llega antes de habilitar
   * el envío real — que es justo lo que ese ticket existe para hacer.
   */
  readonly test_event_code?: string;
}

/**
 * Envuelve los eventos en el cuerpo que espera el endpoint. Existe para que
 * quien envía no tenga que reinventar el sobre —es una línea, y una línea mal
 * escrita es un lote entero rechazado— y para que el código de prueba sea un
 * parámetro con nombre en vez de un campo que alguien agrega a mano.
 */
export function capiRequestBody(
  events: readonly MetaBusinessMessagingPurchaseEvent[],
  testEventCode?: string,
): CapiRequestBody {
  return testEventCode === undefined
    ? { data: events }
    : { data: events, test_event_code: testEventCode };
}

// ────────────────────────────────────────────────────────────────────────────
// Lo que el constructor necesita saber
// ────────────────────────────────────────────────────────────────────────────

/**
 * Lo mínimo que hace falta del pedido cerrado. Forma estructural y no la fila
 * entera, como en `sales/recognition.ts` y `inbox/resolve.ts`: los tests
 * escriben fixtures de tres campos y el módulo sirve igual para un pedido de
 * tienda que para uno creado por el cierre de ventas.
 */
export interface ClosedOrder {
  /**
   * El identificador estable del pedido —`shopify_orders.order_id`—, del que
   * sale la llave de deduplicación. Tiene que ser el mismo en dos
   * construcciones del mismo pedido, así que no sirve un uuid de fila recién
   * insertada ni nada derivado del momento.
   */
  id: string;
  /**
   * El total del pedido, en la moneda de la operación.
   *
   * Acepta `string` porque así lo guarda la tienda (`shopify_orders.
   * total_price` es `text`) y `number` porque así lo calcula el cierre de
   * ventas. Las dos entran por el mismo parser estricto: lo que no se pueda
   * leer con certeza **no produce evento**, en vez de producir uno con un valor
   * inventado.
   */
  totalPrice: string | number;
  /** Cuándo se cerró el pedido. Es el `event_time`; el reloj no entra aquí. */
  closedAt: Date;
}

/**
 * La atribución que se persistió en el primer contacto (`conversations.
 * ctwa_clid`, ticket 01). Es un objeto de un campo y no un `string | null`
 * suelto para que el call site diga qué está pasando, y para que crezca sin
 * cambiar la firma si algún día el evento lleva también el id del anuncio.
 */
export interface AdAttribution {
  /** `referral.ctwa_clid`. `null` cuando el contacto no llegó por un anuncio. */
  ctwaClid: string | null;
}

/**
 * Lo que el evento necesita saber de la operación: su moneda, su dataset y la
 * cuenta de WhatsApp por la que entró el clic.
 *
 * Las tres viajan **juntas en un solo valor** a propósito. Vienen de dos filas
 * distintas —`operations` y `kapso_connection`— y aparearlas mal es el error
 * caro de este módulo: reportar en quetzales al dataset de otro país. Quien
 * arma este objeto a mano puede equivocarse; quien usa
 * {@link operationCapiFacts} no, porque esa función no acepta una conexión que
 * no sea de la misma operación.
 */
export interface OperationCapiFacts {
  /** `operations.id`. Entra en la llave de deduplicación. */
  id: string;
  /** `operations.currency`, ISO 4217: "GTQ" en Guatemala, "COP" en Colombia. */
  currency: string;
  /** `operations.capi_dataset_id` (migración `0023`). `null` sin configurar. */
  capiDatasetId: string | null;
  /** `kapso_connection.business_account_id` **de esta misma operación**. */
  whatsappBusinessAccountId: string | null;
}

/**
 * Los hechos de CAPI de una operación, a partir de sus dos filas.
 *
 * Es puro y es el único camino recomendado para armar un {@link
 * OperationCapiFacts}: **lanza si la conexión es de otra operación**. Cruzar
 * operaciones aquí no es un dato faltante que se pueda degradar a «no hay
 * evento» —sería un evento perfectamente formado reportado a la cuenta
 * equivocada, que es de los pocos errores que no se arreglan después—, así que
 * se trata como lo que es: un error de programación, ruidoso y en el borde.
 *
 * Una operación sin conexión todavía (`null`) sí es un estado normal: devuelve
 * los hechos con la cuenta de WhatsApp vacía y {@link buildPurchaseEvent}
 * responde «no hay evento» con su motivo.
 */
export function operationCapiFacts(
  operation: Pick<Operation, "id" | "currency" | "capiDatasetId">,
  connection: Pick<KapsoConnection, "operationId" | "businessAccountId"> | null,
): OperationCapiFacts {
  if (connection && connection.operationId !== operation.id) {
    throw new Error(
      `la conexión de WhatsApp es de la operación ${connection.operationId} y no de ${operation.id}`,
    );
  }
  return {
    id: operation.id,
    currency: operation.currency,
    capiDatasetId: operation.capiDatasetId,
    whatsappBusinessAccountId: connection?.businessAccountId ?? null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// El resultado
// ────────────────────────────────────────────────────────────────────────────

/**
 * Por qué un pedido no produce evento. Es telemetría, y las tres familias se
 * leen distinto en el log:
 *
 * - `no-click-id` **no es un problema**: es el pedido que no vino de un
 *   anuncio, y es la mayoría. No hay nada que reportar y nadie tiene que hacer
 *   nada.
 * - `operation-has-no-*` es configuración que le falta a un humano: la
 *   operación todavía no tiene dataset, o su conexión de WhatsApp no está
 *   puesta. Se arregla en el panel, y mientras tanto **se pierde atribución**,
 *   así que merece alarma.
 * - `order-has-no-*` es un pedido que llegó mal formado hasta aquí. Es un
 *   defecto, no una configuración.
 */
export type NoEventReason =
  | "no-click-id"
  | "operation-has-no-dataset"
  | "operation-has-no-whatsapp-account"
  | "operation-has-no-currency"
  | "order-has-no-id"
  | "order-has-no-value"
  | "order-has-no-close-time";

/**
 * Las dos formas del resultado. No hay una tercera «evento incompleto»: o el
 * evento está entero y es enviable, o no hay evento y consta por qué.
 */
export type PurchaseEventBuild =
  | {
      kind: "event";
      /** A dónde se postea: `POST /v{VERSION}/{datasetId}/events`. */
      datasetId: string;
      event: MetaBusinessMessagingPurchaseEvent;
      /**
       * La llave con la que la cola reconoce que este evento ya se mandó.
       * Derivada del pedido y de su operación, **nunca del momento**: dos
       * construcciones del mismo pedido dan la misma llave, y por eso un
       * reintento no infla las métricas propias. No viaja dentro del evento
       * (ver el encabezado del archivo: Meta no deduplica este flujo).
       */
      deduplicationKey: string;
    }
  | { kind: "no-event"; reason: NoEventReason };

// ────────────────────────────────────────────────────────────────────────────
// El constructor
// ────────────────────────────────────────────────────────────────────────────

/**
 * El evento de compra de un pedido cerrado, o la ausencia de evento con su
 * motivo.
 *
 * El orden de las comprobaciones es el orden en que alguien puede actuar:
 * primero si hay algo que reportar (el clic), después si la operación puede
 * reportar (dataset, cuenta, moneda) y al final si el pedido trae lo que el
 * evento necesita (id, valor, fecha). Un pedido sin clic devuelve `no-click-id`
 * aunque además falte la configuración: si no hay nada que reportar, lo demás
 * no importa todavía.
 *
 * Ni la moneda ni el valor tienen valor por defecto, y no es cosmético: sin el
 * valor Meta optimiza hacia *cantidad* de ventas en vez de hacia *ingreso*, que
 * con un catálogo de combos no es lo mismo. Un total que no se puede leer con
 * certeza produce «no hay evento», no un cero — un cero es una compra de valor
 * cero, y eso Meta sí lo aprende.
 */
export function buildPurchaseEvent(input: {
  order: ClosedOrder;
  attribution: AdAttribution;
  operation: OperationCapiFacts;
}): PurchaseEventBuild {
  const { order, attribution, operation } = input;

  const ctwaClid = trimmed(attribution.ctwaClid);
  if (!ctwaClid) return { kind: "no-event", reason: "no-click-id" };

  const datasetId = trimmed(operation.capiDatasetId);
  if (!datasetId) {
    return { kind: "no-event", reason: "operation-has-no-dataset" };
  }

  const wabaId = trimmed(operation.whatsappBusinessAccountId);
  if (!wabaId) {
    return { kind: "no-event", reason: "operation-has-no-whatsapp-account" };
  }

  const currency = trimmed(operation.currency)?.toUpperCase();
  if (!currency) {
    return { kind: "no-event", reason: "operation-has-no-currency" };
  }

  const orderId = trimmed(order.id);
  if (!orderId) return { kind: "no-event", reason: "order-has-no-id" };

  const value = parseValue(order.totalPrice);
  if (value === null) {
    return { kind: "no-event", reason: "order-has-no-value" };
  }

  const eventTime = unixSeconds(order.closedAt);
  if (eventTime === null) {
    return { kind: "no-event", reason: "order-has-no-close-time" };
  }

  return {
    kind: "event",
    datasetId,
    deduplicationKey: deduplicationKeyFor(operation.id, orderId),
    event: {
      event_name: "Purchase",
      event_time: eventTime,
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      user_data: {
        whatsapp_business_account_id: wabaId,
        ctwa_clid: ctwaClid,
      },
      custom_data: { currency, value },
    },
  };
}

/**
 * La llave de deduplicación de una compra.
 *
 * Legible a propósito —no un hash—: la cola del ticket 03 la va a mostrar en
 * logs y en reintentos, y una llave que se lee dice de qué pedido se trata sin
 * tener que buscarla. Lleva la operación porque el id de pedido de logística
 * solo es único **dentro** de una cuenta (es la misma razón del índice
 * `dropi_orders_operation_id_idx`), y lleva el nombre del evento para que el
 * día que se reporte también un `OrderShipped` del mismo pedido no colisione
 * con su compra.
 */
function deduplicationKeyFor(operationId: string, orderId: string): string {
  return `purchase:${operationId}:${orderId}`;
}

/**
 * El total del pedido como número, o `null` si no se puede leer con certeza.
 *
 * Estricto a propósito con el texto: solo dígitos con punto decimal opcional,
 * que es como lo escribe Shopify. Un `"1,199.00"` o un `"199,00"` **no se
 * interpretan**, porque las dos lecturas posibles se diferencian en cien veces
 * el valor y equivocarse envenena el aprendizaje del algoritmo con un ticket
 * promedio falso. Cero y negativos tampoco pasan: un pedido contraentrega
 * siempre tiene precio, así que un cero es un dato roto, no una venta gratis.
 *
 * Se redondea a dos decimales, que es lo que tienen tanto el quetzal como el
 * peso, para que un total calculado con coma flotante no viaje como
 * `199.99000000000001`.
 */
function parseValue(totalPrice: string | number): number | null {
  const raw =
    typeof totalPrice === "number"
      ? totalPrice
      : /^\d+(?:\.\d+)?$/.test(totalPrice.trim())
        ? Number(totalPrice.trim())
        : Number.NaN;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw * 100) / 100;
}

/** Segundos desde epoch, o `null` si la fecha no es una fecha. */
function unixSeconds(date: Date): number | null {
  const ms = date?.getTime?.();
  if (ms === undefined || !Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

/** El texto sin espacios, o `null` si no queda nada. */
function trimmed(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}
