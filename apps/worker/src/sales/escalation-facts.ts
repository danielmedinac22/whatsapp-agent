/**
 * De dónde salen los hechos que evalúa `sales/escalation.ts`.
 *
 * La decisión es pura y vive allá; aquí está la única parte que toca la base:
 * traer los turnos del lead y decir en qué punto va el reconocimiento del
 * producto. Separado a propósito, igual que el reconocimiento y el ruteo — lo
 * que se prueba con fixtures no puede necesitar una conexión.
 */

import { and, desc, eq, gte, isNotNull, messages, type Conversation } from "@wa/db";
import { db } from "../db";
import type { SalesEscalationFacts } from "./escalation-triggers";

/**
 * Cuántos turnos del lead mirar hacia atrás.
 *
 * Una conversación de venta que llega a veinte turnos del cliente sin cerrar ya
 * es un caso para un humano por otras razones; y las reglas de repetición no
 * mejoran con más historia, solo se vuelven más caras.
 */
const MAX_TURNS = 20;

/**
 * Los hechos de escalamiento de una conversación de venta.
 *
 * **Los turnos se cuentan desde el clic del anuncio.** Un recomprador tiene
 * meses de postventa encima: la objeción que repitió en marzo sobre un pedido
 * ya entregado no dice nada de la venta de hoy, y contarla escalaría la
 * conversación antes de que Sebastián diga una palabra. Sin clic —un lead
 * orgánico— se mira la conversación entera, que por definición empieza ahí.
 *
 * `productAttempts` es cuántos turnos del lead se procesaron sin producto
 * identificado, que en esa ventana son todos los que se leyeron: si el producto
 * se hubiera identificado, `productIdentified` sería `true` y el disparador no
 * se evalúa. Es la lectura literal de «dos intentos sin identificar el
 * producto», y no necesita columna nueva para contarse.
 */
export async function loadSalesEscalationFacts(
  conversation: Pick<Conversation, "id" | "productId" | "adReferralAt">,
): Promise<SalesEscalationFacts> {
  const since = conversation.adReferralAt;
  const rows = await db
    .select({ body: messages.body })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        eq(messages.direction, "in"),
        isNotNull(messages.body),
        ...(since ? [gte(messages.createdAt, since)] : []),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(MAX_TURNS);

  const inbound = rows
    .map((r) => r.body)
    .filter((b): b is string => Boolean(b?.trim()))
    .reverse();

  return {
    inbound,
    productIdentified: conversation.productId !== null,
    productAttempts: inbound.length,
  };
}
