/**
 * Qué se hace con un pedido que todavía no se le reportó a Meta.
 *
 * Todo lo de este archivo es PURO: recibe el pedido, su atribución y su
 * operación, y devuelve **reportar**, **esperar** o **saltar** — con el motivo.
 * No toca la base, ni el reloj, ni la red. El barrido de `jobs/capi-conversion
 * .ts` trae las filas y ejecuta lo que esto decide.
 *
 * ## Por qué el disparo es un barrido y no una llamada desde el cierre
 *
 * La venta se cierra en `sales/closing.ts`, y llamar desde ahí habría sido lo
 * obvio y lo equivocado por dos razones distintas:
 *
 * 1. **El ticket pide envío asíncrono.** Un fallo de Meta no puede bloquear ni
 *    demorar la respuesta al cliente. Colgado del cierre, cualquier latencia de
 *    Meta se le cobra al cliente que está esperando saber si compró.
 * 2. **El orden importa.** El evento va *después* de que el pedido existe en la
 *    tienda y de que el cliente recibió su confirmación. Desde el cierre, lo
 *    primero es cierto pero lo segundo todavía no: el mensaje recién se está
 *    encolando.
 *
 * Un barrido periódico resuelve las dos: mira el mundo ya establecido —el
 * pedido está en `shopify_orders` porque la tienda mandó su webhook, y el
 * mensaje de confirmación está en `outbound_messages` con fecha de salida— y
 * decide sobre hechos, no sobre intenciones.
 *
 * ## «Esperar» y «saltar» no son lo mismo, y por eso son dos
 *
 * - **Esperar** es un pedido que *todavía* no se puede reportar pero que puede
 *   volverse reportable: falta que salga la confirmación al cliente, o falta
 *   que alguien configure el dataset de la operación. Se cuenta y se muestra,
 *   porque es lo que le dice al admin que el reporte está esperando algo suyo.
 * - **Saltar** es un pedido que **nunca** se va a reportar: no vino de un
 *   anuncio, no lo tomó el vendedor, o llegó tan tarde que Meta ya no lo
 *   aceptaría. No hay nada que hacer y no merece alarma.
 *
 * Colapsarlos en «no se reportó» es cómo un tablero se ve tranquilo mientras
 * hace un mes que falta un dato de configuración.
 */

import { SALES_ORDER_TAG } from "../sales/order";
import {
  buildPurchaseEvent,
  type MetaBusinessMessagingPurchaseEvent,
  type NoEventReason,
  type OperationCapiFacts,
} from "./purchase-event";

/**
 * La etiqueta que marca el pedido como originado en el vendedor.
 *
 * Se compara contra la constante de `sales/order.ts`, que es quien la escribe.
 * Se importa el valor y no se copia el texto: son el mismo contrato que ya usa
 * `followup-plan.ts` para decidir el primer toque.
 */
export { SALES_ORDER_TAG };

/**
 * Cuánto puede tener un pedido y todavía reportarse: **siete días**.
 *
 * No es una elección nuestra sino el límite de Meta: la Conversions API rechaza
 * eventos con `event_time` más viejo que eso. Reportarlo igual sería mandar un
 * evento que Meta descarta, y peor, reintentarlo seis veces. Además pone un
 * techo a lo que pasa el día que alguien enciende el interruptor después de un
 * mes apagado: entra la última semana, no el mes entero.
 */
export const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60_000;

/** Lo que el barrido sabe de un pedido candidato. */
export interface ReportableOrder {
  /** `shopify_orders.order_id`. El identificador estable del pedido. */
  orderId: string;
  /** `shopify_orders.total_price`, tal como lo guardó la tienda. */
  totalPrice: string | null;
  /**
   * Cuándo llegó el pedido a la tienda. Es lo más cerca del momento del cierre
   * que hay observable —el webhook llega segundos después de crearse— y es lo
   * que viaja como `event_time`. El cierre en sí no deja marca de tiempo
   * propia en la base.
   */
  receivedAt: Date;
  /** Las etiquetas del pedido, ya extraídas de la carga cruda del webhook. */
  tags: readonly string[];
  /** `conversations.ctwa_clid`: el identificador de clic, o `null`. */
  ctwaClid: string | null;
  /**
   * Cuándo salió el mensaje que le dijo al cliente que su pedido quedó
   * registrado. `null` mientras no haya salido.
   */
  confirmedToCustomerAt: Date | null;
}

/** Por qué un pedido todavía no se puede reportar, pero podría después. */
export type WaitReason =
  /** El cliente aún no recibió su confirmación. El evento va después. */
  | "awaiting-customer-confirmation"
  /** La operación no tiene dataset configurado. Lo arregla el panel. */
  | "operation-has-no-dataset"
  /** La operación no tiene conexión de WhatsApp. Lo arregla el panel. */
  | "operation-has-no-whatsapp-account"
  /** La operación no dice su moneda. Lo arregla el panel. */
  | "operation-has-no-currency";

/** Por qué un pedido no se va a reportar nunca. */
export type SkipReason =
  /** No lo tomó el vendedor. Es el caso de los 1.735 pedidos de hoy. */
  | "not-a-sales-order"
  /** No vino de un anuncio: no hay conversión que atribuir. */
  | "no-click-id"
  /** Meta ya no lo aceptaría por antigüedad. */
  | "too-old"
  /** El pedido llegó mal formado hasta acá. Es un defecto, no configuración. */
  | "order-has-no-id"
  | "order-has-no-value"
  | "order-has-no-close-time";

export type ConversionPlan =
  | {
      kind: "report";
      /** A dónde: `POST /v{VERSION}/{datasetId}/events`. Es un dataset, no un píxel. */
      datasetId: string;
      event: MetaBusinessMessagingPurchaseEvent;
      /** La llave del libro de conversiones. Ver `capi/conversion-record.ts`. */
      deduplicationKey: string;
    }
  | { kind: "wait"; reason: WaitReason }
  | { kind: "skip"; reason: SkipReason };

/**
 * Qué hacer con un pedido candidato.
 *
 * El orden de las comprobaciones es el orden en que alguien puede actuar, igual
 * que en {@link buildPurchaseEvent}: primero si el pedido es de los que se
 * reportan, después si es el momento, y al final si están los datos. Un pedido
 * que no vino del vendedor devuelve `not-a-sales-order` aunque además le falte
 * la configuración: si no hay nada que reportar, lo demás no importa todavía.
 *
 * **La ventana de siete días se comprueba contra `now` y no contra el reloj**:
 * el reloj no entra a este archivo, entra como parámetro. Es lo que permite
 * probar el borde exacto con una fecha fija.
 */
export function planConversion(input: {
  order: ReportableOrder;
  operation: OperationCapiFacts;
  now: Date;
}): ConversionPlan {
  const { order, operation, now } = input;

  if (!hasSalesOrigin(order.tags)) {
    return { kind: "skip", reason: "not-a-sales-order" };
  }

  // Antes que cualquier configuración: sin clic no hay nada que reportar, y es
  // el caso mayoritario, no un problema.
  if (!order.ctwaClid?.trim()) {
    return { kind: "skip", reason: "no-click-id" };
  }

  if (now.getTime() - order.receivedAt.getTime() > MAX_EVENT_AGE_MS) {
    return { kind: "skip", reason: "too-old" };
  }

  // **El evento va después de que el cliente supo que compró.** Es criterio del
  // ticket y además es el orden que tiene sentido: primero la persona, después
  // la telemetría.
  if (!order.confirmedToCustomerAt) {
    return { kind: "wait", reason: "awaiting-customer-confirmation" };
  }

  const built = buildPurchaseEvent({
    order: {
      id: order.orderId,
      totalPrice: order.totalPrice ?? "",
      closedAt: order.receivedAt,
    },
    attribution: { ctwaClid: order.ctwaClid },
    operation,
  });

  if (built.kind === "no-event") {
    return noEventToPlan(built.reason);
  }

  return {
    kind: "report",
    datasetId: built.datasetId,
    event: built.event,
    deduplicationKey: built.deduplicationKey,
  };
}

/**
 * Del motivo del constructor al plan del barrido.
 *
 * La traducción no es mecánica y ahí está el valor: lo que le falta a la
 * **operación** es configuración que un humano puede poner mañana, así que el
 * pedido *espera*; lo que le falta al **pedido** no se arregla solo, así que se
 * salta. El constructor ya separa las dos familias en su documentación; esto es
 * esa separación hecha comportamiento.
 */
function noEventToPlan(reason: NoEventReason): ConversionPlan {
  switch (reason) {
    case "operation-has-no-dataset":
    case "operation-has-no-whatsapp-account":
    case "operation-has-no-currency":
      return { kind: "wait", reason };
    case "no-click-id":
    case "order-has-no-id":
    case "order-has-no-value":
    case "order-has-no-close-time":
      return { kind: "skip", reason };
  }
}

/**
 * Si el pedido lo tomó el vendedor.
 *
 * Comparación sin distinguir mayúsculas y con espacios recortados, igual que en
 * `followup-plan.ts`: las etiquetas de la tienda pasan por manos humanas y por
 * dos formatos distintos —cadena con comas en el webhook, arreglo en la API de
 * administración—, y leerlas mal acá significa no reportar una venta que sí se
 * hizo.
 */
function hasSalesOrigin(tags: readonly string[]): boolean {
  const wanted = SALES_ORDER_TAG.toLowerCase();
  return tags.some((t) => t.trim().toLowerCase() === wanted);
}
