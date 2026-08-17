/**
 * Qué primer mensaje recibe un pedido, por qué mecanismo y con cuánta demora.
 *
 * Todo lo de este archivo es PURO: recibe el pedido —sus etiquetas— y el estado
 * de la ventana de conversación, y devuelve el plan. No lee la base, no manda
 * nada y no sabe redactar: el texto lo compone quien envía.
 *
 * ## Dos dimensiones, y separarlas es el punto
 *
 * **El origen decide el contenido. La ventana decide el mecanismo.**
 *
 * - Origen ventas → contenido que reconoce la compra, y diez minutos.
 * - Origen directo → contenido y demora **actuales, sin cambio alguno**. Es el
 *   camino que factura hoy (1.678 pedidos, 88,4% de confirmación) y este módulo
 *   no lo altera.
 * - Ventana abierta → texto libre. Ventana cerrada → plantilla.
 *
 * Atar el mecanismo al origen —«los de ventas van en texto libre porque el
 * cliente acaba de escribir»— parece razonable y tiene un borde que lo rompe: si
 * un pedido de ventas se atrasa en la cola de reintentos **más de veinticuatro
 * horas**, su ventana se cierra igual que la de cualquiera. Con las dos
 * dimensiones pegadas, ese mensaje saldría como texto libre, Meta lo rechazaría
 * y **fallaría en silencio** justo en el caso donde ya hubo un problema. Por eso
 * {@link FollowupPlan.template} no es opcional: la plantilla existe siempre, sea
 * cual sea el origen, y es el camino seguro.
 */

import type { ServiceWindowState } from "../kapso/service-window";
import { CONFIRMACION_PEDIDO_TEMPLATE } from "../kapso/templates";
import { SALES_ORDER_TAG } from "./order";

/**
 * La demora del primer toque de un pedido de ventas: **diez minutos**, contra
 * los cinco del pedido web.
 *
 * Es una constante y no un campo de configuración, por lo mismo que el umbral
 * de `recognition.ts`: cada perilla es superficie de falla y soporte no
 * cotizado. La demora del pedido directo sí es configurable —ya lo era— y este
 * módulo la recibe; lo que el spec pedía era que dejara de ser **un único**
 * campo para los dos orígenes, no que naciera un segundo campo.
 *
 * Diez y no la de hoy porque el cliente acaba de despedirse del vendedor:
 * escribirle a los dos minutos para preguntarle por el pedido que acaba de
 * hacer se lee como que nadie se enteró. (Guatemala tiene configurados 120.000
 * ms; el spec habla de cinco minutos, que es el valor por defecto del esquema y
 * el respaldo de la ruta del webhook, no lo que la operación usa.)
 */
export const SALES_FOLLOWUP_DELAY_MS = 10 * 60_000;

/** De dónde viene el pedido. Lo dice su etiqueta, no quién lo consulta. */
export type FollowupOrigin = "sales" | "direct";

/** Cómo sale el mensaje. Lo decide la ventana de veinticuatro horas. */
export type FollowupMechanism = "free_text" | "template";

/**
 * Qué se dice. Lo decide el origen.
 *
 * - `sales_purchase_ack` — reconoce la compra que el cliente acaba de hacer y
 *   se enfoca en verificar la dirección, que en contraentrega es donde se caen
 *   las entregas.
 * - `order_data_confirmation` — el de hoy: presenta el pedido y pide validar los
 *   datos. Es lo que recibe quien compró directo en la tienda y puede no haber
 *   escrito nunca al número.
 */
export type FollowupContent = "sales_purchase_ack" | "order_data_confirmation";

/** El plan del primer toque. */
export interface FollowupPlan {
  origin: FollowupOrigin;
  content: FollowupContent;
  mechanism: FollowupMechanism;
  delayMs: number;
  /**
   * La plantilla aprobada con la que sale el mensaje cuando el mecanismo es
   * `template` — y el respaldo cuando es `free_text` y Meta lo rechaza igual.
   *
   * **No es opcional a propósito**, ni siquiera para ventas: un plan sin
   * plantilla es un mensaje que puede quedarse sin forma de salir.
   *
   * Es la misma para los dos orígenes, y eso es una decisión, no un descuido:
   * `confirmacion_datos_cod` ya reconoce el pedido y pide validar la dirección,
   * que es justo el contenido de ventas, y está **aprobada**. Una plantilla
   * nueva de ventas volvería a meter una aprobación de Meta en el camino
   * crítico, que es lo que el spec sacó de ahí al decidir un número por
   * operación. Si algún día se aprueba una, se cambia aquí y en un solo sitio.
   */
  template: string;
}

/**
 * Si un pedido nació en el vendedor, según sus etiquetas.
 *
 * La etiqueta la escribe el constructor de orden ({@link SALES_ORDER_TAG}), así
 * que el string está definido una sola vez: quien lo escribe y quien lo lee no
 * pueden desincronizarse. Se compara sin distinguir mayúsculas ni espacios
 * porque las etiquetas de Shopify pasan por manos humanas en el panel de la
 * tienda.
 */
export function followupOriginFromTags(
  tags: readonly string[],
): FollowupOrigin {
  const wanted = SALES_ORDER_TAG.toLowerCase();
  return tags.some((tag) => tag.trim().toLowerCase() === wanted)
    ? "sales"
    : "direct";
}

/**
 * El plan de seguimiento de un pedido.
 *
 * `directDelayMs` es la demora vigente del pedido web —`agent_settings
 * .followup_delay_ms` de la operación dueña, tal como la resuelve hoy
 * `routes/shopify.ts`— y se devuelve **tal cual** para el origen directo: es la
 * garantía de que este módulo no cambia el camino que factura. No se toca ni se
 * compara con nada; lo que entra sale.
 *
 * Una ventana `unknown` —no hay ningún entrante registrado— sale como plantilla.
 * Es la dirección segura del error: una plantilla dentro de la ventana abierta
 * se entrega igual (y siendo UTILITY, ni se cobra), mientras que un texto libre
 * fuera de la ventana no se entrega en absoluto. Es además el comportamiento
 * exacto de hoy para el pedido web, donde el cliente suele no haber escrito
 * nunca.
 */
export function resolveFollowupPlan(input: {
  /** Las etiquetas del pedido, tal como quedaron en la tienda. */
  tags: readonly string[];
  window: ServiceWindowState;
  /** La demora configurada hoy para el pedido que no viene de ventas. */
  directDelayMs: number;
}): FollowupPlan {
  const origin = followupOriginFromTags(input.tags);
  const sales = origin === "sales";
  return {
    origin,
    content: sales ? "sales_purchase_ack" : "order_data_confirmation",
    mechanism: input.window === "open" ? "free_text" : "template",
    delayMs: sales ? SALES_FOLLOWUP_DELAY_MS : input.directDelayMs,
    template: CONFIRMACION_PEDIDO_TEMPLATE,
  };
}
