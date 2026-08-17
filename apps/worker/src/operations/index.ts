/**
 * Accesores de la tabla `operations`.
 *
 * Es el módulo compartido de la migración multi-operación: de aquí sale la
 * operación que después se le pasa a cada conexión (WhatsApp, tienda,
 * logística, configuración de agente). La regla pura de resolución vive en
 * `./resolve.ts` y se prueba sin base.
 */
import { eq } from "@wa/db";
import { contacts, conversations, operations } from "@wa/db";
import { db } from "../db";
import { OPERATION_CACHE_MS } from "./cache";
import type { OperationId } from "./resolve";

export { OPERATION_CACHE_MS, OperationScopedCache } from "./cache";
export {
  type InboundOperationDecision,
  type OperationConnectionRef,
  type OperationId,
  type OperationRef,
  SINGLE_OPERATION_CACHE_KEY,
  canUseSingleOperationFallback,
  decideInboundOperation,
  operationCacheKey,
  resolveOperationIdByPhoneNumberId,
} from "./resolve";

const CACHE_MS = OPERATION_CACHE_MS;

let singleOperationCache: { id: OperationId | null; at: number } | null = null;

/**
 * El id de la operación activa **única**, o `null` si hay cero o más de una.
 *
 * Es la red de seguridad de toda la migración. Mientras el sistema tenga una
 * sola operación activa, cualquier camino que no logre resolver la suya puede
 * seguir atendiéndola sin ambigüedad: no hay a quién más atribuirle el trabajo.
 * En cuanto se dé de alta la segunda operación activa esta función devuelve
 * `null`, la red se desarma sola y los caminos tienen que resolver de verdad.
 *
 * Cuenta solo las `active` a propósito: dar de alta Colombia en `inactive` deja
 * la red puesta hasta que Colombia realmente empiece a operar.
 */
export async function getSingleOperationId(): Promise<OperationId | null> {
  if (singleOperationCache && Date.now() - singleOperationCache.at < CACHE_MS) {
    return singleOperationCache.id;
  }
  // `limit(2)`: no hace falta contarlas todas, solo saber si hay más de una.
  const rows = await db
    .select({ id: operations.id })
    .from(operations)
    .where(eq(operations.status, "active"))
    .limit(2);
  const id = rows.length === 1 ? (rows[0]?.id ?? null) : null;
  singleOperationCache = { id, at: Date.now() };
  return id;
}

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

/**
 * A llamar cuando se da de alta o se desactiva una operación: es lo que arma o
 * desarma la red de seguridad de {@link getSingleOperationId}.
 */
export function invalidateSingleOperationCache(): void {
  singleOperationCache = null;
}
