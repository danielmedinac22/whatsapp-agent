import { asc, eq } from "drizzle-orm";
import { getDb } from "./client";
import { conversations, operations, type Operation } from "./schema";

/**
 * Accesor único de la tabla `operations`.
 *
 * El contract (ticket 06) lo trajo aquí porque la migración terminó con **dos
 * vocabularios para la misma idea**: el lote de la conexión de WhatsApp dejó
 * `getSingleOperationId()` en `apps/worker/src/operations/` y el de logística
 * dejó `requireSoleActiveOperation()` en `dropi/config.ts`, con su propio
 * `listActiveOperations()` y su propia caché. Corrieron en paralelo y no podían
 * verse. Dos implementaciones de «cuál es la única operación activa» se
 * desincronizan en cuanto una se toque, y la que quede vieja responde con el
 * país equivocado.
 *
 * Vive en `@wa/db` y no en el worker por lo mismo que `getAgentSettings`: el
 * panel resuelve las mismas operaciones. Un solo accesor, no uno por
 * aplicación.
 *
 * **La forma que devuelve es la fila entera, no el uuid.** Un id de operación
 * es un `string` y también lo son un id de contacto y uno de conversación:
 * pasar la fila es lo que hace que `getDropiConnection(contactId)` no compile.
 * Los uuid solo viajan donde el dato vive —las columnas `operation_id`— y se
 * convierten en fila al entrar a un accesor.
 */

/** El uuid de una fila de `operations`. */
export type OperationId = string;

/** Mismo TTL que las conexiones: la lista de operaciones cambia casi nunca. */
const OPERATIONS_CACHE_MS = 30_000;

let activeCache: { rows: Operation[]; at: number } | null = null;

/**
 * A llamar cuando se da de alta, se activa o se desactiva una operación. Es lo
 * que arma o desarma el puente de {@link requireSoleActiveOperation}.
 */
export function invalidateOperationsCache(): void {
  activeCache = null;
}

/** Las operaciones que atienden hoy. `inactive` existe pero no opera. */
export async function listActiveOperations(): Promise<Operation[]> {
  if (activeCache && Date.now() - activeCache.at < OPERATIONS_CACHE_MS) {
    return activeCache.rows;
  }
  const rows = await getDb()
    .select()
    .from(operations)
    .where(eq(operations.status, "active"))
    .orderBy(asc(operations.countryCode));
  activeCache = { rows, at: Date.now() };
  return rows;
}

/**
 * La operación activa **única**, o `null` si hay cero o dos o más.
 *
 * Es la primitiva, y devuelve `null` en vez de lanzar por una razón que no es
 * cosmética: de ella cuelga la red del pipeline de entrada, que **no puede
 * lanzar**. Un mensaje que revienta al resolver su operación es la operación
 * muda sin que salte ninguna alarma, y ningún test lo ve porque el sistema
 * «funciona». Quien sí deba detenerse usa {@link requireSoleActiveOperation},
 * que es esta misma pregunta con la respuesta convertida en error.
 *
 * Cuenta solo las `active` a propósito: dar de alta Colombia en `inactive` deja
 * el puente puesto hasta que Colombia opere de verdad.
 */
export async function getSingleActiveOperation(): Promise<Operation | null> {
  const rows = await listActiveOperations();
  return rows.length === 1 ? (rows[0] ?? null) : null;
}

/**
 * Puente para quien todavía no puede recibir la operación por parámetro: el
 * panel, que no tiene selector hasta el ticket 07, y las filas de datos cuya
 * `operation_id` sigue siendo nullable.
 *
 * **Con dos operaciones activas lanza en vez de elegir.** Elegir en silencio es
 * exactamente el error que esta migración existe para hacer imposible: un
 * pedido colombiano confirmado contra la logística guatemalteca. Lanzar
 * convierte el puente en algo que hay que quitar antes de abrir Colombia, no en
 * un default que sobrevive callado.
 */
export async function requireSoleActiveOperation(): Promise<Operation> {
  const rows = await listActiveOperations();
  const only = rows[0];
  if (!only) {
    throw new Error("no hay ninguna operación activa configurada");
  }
  if (rows.length > 1) {
    const codes = rows.map((r) => r.countryCode).join(", ");
    throw new Error(
      `hay ${rows.length} operaciones activas (${codes}): quien llama tiene que decir de cuál`,
    );
  }
  return only;
}

/**
 * De qué operación habla el panel.
 *
 * Hasta que exista el selector (ticket 07) el panel no manda ninguna, así que
 * resuelve la única activa — y con dos falla en vez de adivinar. Es el mismo
 * puente de arriba con nombre propio: cuando llegue el selector se cambia aquí
 * y todas las pantallas quedan migradas de una vez, en vez de repartir
 * `requireSoleActiveOperation()` por seis rutas y dos páginas.
 */
export function panelOperation(): Promise<Operation> {
  return requireSoleActiveOperation();
}

/**
 * La fila de una operación por su uuid. Sirve la lista activa cacheada y solo
 * consulta la base cuando el id no está ahí — una operación `inactive` o un id
 * que ya no existe.
 */
export async function getOperationById(
  operationId: OperationId,
): Promise<Operation | null> {
  const active = await listActiveOperations();
  const hit = active.find((o) => o.id === operationId);
  if (hit) return hit;
  const [row] = await getDb()
    .select()
    .from(operations)
    .where(eq(operations.id, operationId))
    .limit(1);
  return row ?? null;
}

/** La fila de una operación que tiene que existir. */
export async function requireOperationById(
  operationId: OperationId,
): Promise<Operation> {
  const op = await getOperationById(operationId);
  if (!op) {
    throw new Error(`la operación ${operationId} no existe`);
  }
  return op;
}

/**
 * La operación de una fila que **todavía puede no traerla**, con el puente.
 *
 * Las tablas de configuración ya la traen obligatoria (migración `0021`), pero
 * `conversations.operation_id` sigue siendo nullable a propósito: quien la
 * escribe —el pipeline de entrada y el webhook de la tienda— puede legítimamente
 * no saber la operación, y convertir «no la sé» en «pierdo el mensaje» sería
 * cambiar una decisión tomada, no cerrar una puerta.
 *
 * Cada llamada a esta función es una fila que todavía no dice de qué operación
 * es. Es greppable a propósito: es la lista de trabajo del ticket que vuelva
 * obligatoria `conversations.operation_id`.
 */
export async function requireOperationOrSole(
  operationId: OperationId | null | undefined,
): Promise<Operation> {
  if (!operationId) return requireSoleActiveOperation();
  return requireOperationById(operationId);
}

/**
 * La operación de un contacto es la de su conversación. El índice único sobre
 * `contact_id` garantiza que sea una sola conversación por contacto.
 *
 * Una conversación recién creada, o una que entró por un número que no
 * reconocemos, todavía la trae vacía: ahí cae al puente.
 */
export async function resolveOperationForContact(
  contactId: string | null,
): Promise<Operation> {
  if (contactId) {
    const [row] = await getDb()
      .select({ operation: operations })
      .from(conversations)
      .innerJoin(operations, eq(operations.id, conversations.operationId))
      .where(eq(conversations.contactId, contactId))
      .limit(1);
    if (row) return row.operation;
  }
  return requireSoleActiveOperation();
}
