/**
 * Lo que el worker sabe de operaciones.
 *
 * Los accesores de la tabla `operations` **ya no viven aquí**: el contract
 * (ticket 06) los unificó en `@wa/db` (`operations.ts`), porque había dos
 * vocabularios para la misma idea —`getSingleOperationId()` aquí y
 * `requireSoleActiveOperation()` en `dropi/config.ts`, con dos
 * `listActiveOperations()` y dos cachés— y el panel los necesita también. Se
 * re-exportan desde aquí para que los llamadores del worker no tengan que saber
 * dónde quedaron.
 *
 * Lo propio del worker es lo de abajo: la regla pura de ruteo del entrante y la
 * caché por operación de las conexiones.
 */
import { eq } from "@wa/db";
import { contacts, conversations, type OperationId } from "@wa/db";
import { db } from "../db";

export {
  getOperationById,
  getSingleActiveOperation,
  invalidateOperationsCache,
  listActiveOperations,
  requireOperationById,
  requireOperationOrSole,
  requireSoleActiveOperation,
  resolveOperationForContact,
  type Operation,
  type OperationId,
} from "@wa/db";

export { OPERATION_CACHE_MS, OperationScopedCache } from "./cache";
export {
  type InboundOperationDecision,
  type OperationConnectionRef,
  decideInboundOperation,
  resolveOperationIdByPhoneNumberId,
} from "./resolve";

/** La operación que una conversación guarda, si ya tiene una. */
export async function getConversationOperationId(
  conversationId: string,
): Promise<OperationId | null> {
  const [row] = await db
    .select({ operationId: conversations.operationId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return row?.operationId ?? null;
}

/**
 * La operación de la conversación de un contacto. El índice único sobre
 * `contact_id` garantiza que sea una sola conversación por contacto.
 */
export async function getOperationIdByContactId(
  contactId: string,
): Promise<OperationId | null> {
  const [row] = await db
    .select({ operationId: conversations.operationId })
    .from(conversations)
    .where(eq(conversations.contactId, contactId))
    .limit(1);
  return row?.operationId ?? null;
}

/** La operación de la conversación de un `wa_id` (E.164 sin "+"). */
export async function getOperationIdByWaId(
  waId: string,
): Promise<OperationId | null> {
  const [row] = await db
    .select({ operationId: conversations.operationId })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(contacts.waId, waId))
    .limit(1);
  return row?.operationId ?? null;
}
