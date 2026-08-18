/**
 * Qué agente es dueño de una conversación en cada momento: el de confirmación
 * —el que hoy atiende a los clientes de Guatemala— o el vendedor.
 *
 * Todo lo de este archivo es PURO: no toca la base ni el reloj.
 *
 * **No hay columna de dueño, y es deliberado.** El dueño se deriva de la
 * bandeja (`inbox/resolve.ts`), que a su vez se deriva de la atribución y de
 * los pedidos; una columna tendría que mantenerse de acuerdo con las tres
 * máquinas de estado que el sistema ya tiene, y la que miente siempre es la que
 * alguien olvidó actualizar. Con una conversación por contacto **para siempre**
 * el problema es peor: un campo escrito en julio le quedaría encima al
 * recomprador de agosto. Es la misma decisión —y por las mismas razones— que
 * tomó la función de ruteo, y por eso la `0022` puso columnas para la
 * atribución y para la asignación a un asesor, pero ninguna para esto. Lo que
 * la conversación «registra» es la respuesta a la pregunta, calculada en cada
 * mensaje entrante y anotada en el log: incapaz de desactualizarse.
 *
 * **Mientras no haya vendedor configurado, el dueño es siempre el agente de
 * confirmación.** Es el riesgo R8 de la no-regresión —introducir esta lógica
 * sobre el número que hoy factura podría mandar a un cliente de postventa al
 * vendedor— y el tipo lo hace inescribible: sin vendedor configurado no se
 * puede siquiera pasar una bandeja, así que no hay forma de escribir un
 * `if` que la mire.
 */

import type { Inbox } from "@wa/db";

/**
 * Los dos agentes. `confirmacion` es el que existe en producción desde antes
 * del proyecto; `ventas` es el vendedor, que solo puede ser dueño de algo
 * cuando la operación lo tiene configurado.
 *
 * Son los agentes automáticos, no las personas: quién *toma* una conversación
 * es `conversations.assigned_user_id`, y eso sí se guarda porque el sistema no
 * lo puede deducir.
 */
export type OwnerAgent = "confirmacion" | "ventas";

/**
 * Cuál de las tres reglas decidió el dueño. Igual que el `rule` del ruteo, no
 * es decorativo: es lo que hace verificable en un test que Guatemala sigue
 * atendida por el agente de confirmación **por no tener vendedor** y no por
 * casualidad de la bandeja.
 */
export type OwnerRule =
  /** La operación no tiene vendedor configurado. El comportamiento de siempre. */
  | "no_sales_agent"
  /** Hay vendedor y la conversación pertenece a la bandeja de ventas. */
  | "sales_inbox"
  /** Hay vendedor, pero la conversación es de postventa. */
  | "operations_inbox";

export interface ConversationOwner {
  agent: OwnerAgent;
  rule: OwnerRule;
}

/**
 * Los hechos que hacen falta para saber el dueño — y **solo** los que hacen
 * falta.
 *
 * Es una unión discriminada a propósito: sin vendedor configurado la bandeja no
 * se puede pasar porque no hace falta derivarla, lo que ahorra al pipeline
 * consultar los pedidos del contacto en cada mensaje entrante de una operación
 * que todavía no vende. Y con vendedor configurado la bandeja es obligatoria:
 * no existe forma de preguntar por el dueño «a medias».
 */
export type ConversationOwnerFacts =
  | { salesAgentConfigured: false }
  | { salesAgentConfigured: true; inbox: Inbox };

/** El agente dueño de la conversación, y por qué. */
export function resolveConversationOwner(
  facts: ConversationOwnerFacts,
): ConversationOwner {
  if (!facts.salesAgentConfigured) {
    return { agent: "confirmacion", rule: "no_sales_agent" };
  }
  return facts.inbox === "ventas"
    ? { agent: "ventas", rule: "sales_inbox" }
    : { agent: "confirmacion", rule: "operations_inbox" };
}
