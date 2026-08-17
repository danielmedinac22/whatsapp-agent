import { asc, eq, isNull, sql } from "@wa/db";
import {
  conversations,
  dropiConnection,
  operations,
  type DropiConnection,
  type Operation,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";

// ────────────────────────────────────────────────────────────────────────────
// Operación · helpers locales
//
// Deliberadamente locales a `dropi/`: el lote de la conexión de WhatsApp y la
// tienda define la forma común de resolver operaciones, y ahí se unifican.
// Esto es lo mínimo para que la conexión de logística cuelgue de su operación
// sin inventar vocabulario compartido que después haya que deshacer.
// ────────────────────────────────────────────────────────────────────────────

/** Las operaciones que atienden hoy. `inactive` existe pero no opera. */
export async function listActiveOperations(): Promise<Operation[]> {
  return db
    .select()
    .from(operations)
    .where(eq(operations.status, "active"))
    .orderBy(asc(operations.countryCode));
}

/**
 * Puente de la migración, para quien todavía no recibe la operación por
 * parámetro: el panel (que no tiene selector hasta el ticket 07) y las filas
 * sin conversación de la que deducirla.
 *
 * Con dos operaciones activas **lanza en vez de elegir**. Elegir en silencio es
 * exactamente el error que este lote existe para hacer imposible: un pedido
 * colombiano confirmado contra la logística guatemalteca. Lanzar convierte el
 * puente en algo que hay que quitar antes de abrir Colombia, no en un default
 * que sobrevive callado. El contract (ticket 06) lo borra.
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
 * La operación de un contacto es la de su conversación — `operation_id` la
 * backfilleó el ticket 01 (1.688/1.688 en producción) y la empieza a escribir
 * el lote de la conexión de WhatsApp.
 *
 * Una conversación recién creada todavía la trae vacía, así que cae al puente:
 * con una sola operación eso es Guatemala, que es la respuesta correcta hoy.
 */
export async function resolveOperationForContact(
  contactId: string | null,
): Promise<Operation> {
  if (contactId) {
    const [row] = await db
      .select({ operation: operations })
      .from(conversations)
      .innerJoin(operations, eq(operations.id, conversations.operationId))
      .where(eq(conversations.contactId, contactId))
      .limit(1);
    if (row) return row.operation;
  }
  return requireSoleActiveOperation();
}

/**
 * La operación cuya logística tiene configurado ese teléfono de administrador.
 * Es el camino del 2FA entrante: el código llega por WhatsApp sin más contexto
 * que quién lo mandó, así que la operación se resuelve por el dato, no por el
 * llamador.
 */
export async function findOperationByDropiAdminPhone(
  digits: string,
): Promise<{ operation: Operation; connection: DropiConnection } | null> {
  if (!digits) return null;
  const rows = await db
    .select({ operation: operations, connection: dropiConnection })
    .from(dropiConnection)
    .innerJoin(operations, eq(operations.id, dropiConnection.operationId))
    .where(eq(operations.status, "active"));
  return (
    rows.find(
      (r) => (r.connection.adminPhone ?? "").replace(/\D/g, "") === digits,
    ) ?? null
  );
}

// ────────────────────────────────────────────────────────────────────────────
// La conexión de logística de una operación
// ────────────────────────────────────────────────────────────────────────────

const CONNECTION_TTL_MS = 30 * 1000;

/**
 * Caché indexada por operación. Con una sola entrada —como estaba— la segunda
 * operación recibiría la conexión de la primera durante 30 segundos, sin fallar
 * ni compilar mal: pediría guías al Dropi del país equivocado.
 */
const connectionCache = new Map<
  string,
  { value: DropiConnection | null; expires: number }
>();

export async function getDropiConnection(
  op: Operation,
): Promise<DropiConnection | null> {
  const now = Date.now();
  const cached = connectionCache.get(op.id);
  if (cached && cached.expires > now) {
    return cached.value;
  }
  const [row] = await db
    .select()
    .from(dropiConnection)
    .where(eq(dropiConnection.operationId, op.id))
    .limit(1);
  const value = row ?? null;
  connectionCache.set(op.id, { value, expires: now + CONNECTION_TTL_MS });
  return value;
}

/** Invalida solo la operación tocada: la de al lado sigue siendo válida. */
export function invalidateDropiConnectionCache(op: Operation): void {
  connectionCache.delete(op.id);
}

/**
 * Busca la fila singleton huérfana —la que quedaría si alguien creara una
 * conexión con el código viejo, que insertaba sin operación— y solo la
 * devuelve si `op` es la única operación activa: en ese caso esa fila no puede
 * ser de otro país.
 *
 * La red se desarma sola el día que Colombia opere, sin que nadie tenga que
 * acordarse de quitarla.
 */
async function orphanConnectionFor(
  op: Operation,
): Promise<DropiConnection | null> {
  const activas = await listActiveOperations();
  if (activas.length !== 1 || activas[0]?.id !== op.id) return null;
  const [huerfana] = await db
    .select()
    .from(dropiConnection)
    .where(isNull(dropiConnection.operationId))
    .limit(1);
  return huerfana ?? null;
}

/**
 * La conexión de logística de una operación, **con red**: si la operación no
 * tiene conexión propia pero es la única activa, cae en la fila huérfana y lo
 * grita en los logs.
 *
 * La red va aquí y no en `getDropiConnection` porque perder la logística frena
 * las confirmaciones de la operación que factura, y porque una fila sin
 * operación solo puede existir por el código viejo. Quien pinta el panel usa
 * la versión estricta: la pantalla tiene que decir la verdad.
 */
export async function resolveDropiConnection(
  op: Operation,
): Promise<DropiConnection | null> {
  const propia = await getDropiConnection(op);
  if (propia) return propia;
  const huerfana = await orphanConnectionFor(op);
  if (!huerfana) return null;
  logger.error(
    { operation: op.countryCode, dropiConnectionId: huerfana.id },
    "dropi_connection sin operación: usando la fila huérfana porque solo hay una operación activa",
  );
  return huerfana;
}

export async function upsertDropiConnection(
  op: Operation,
  patch: Partial<DropiConnection>,
): Promise<void> {
  // La misma red que la lectura, y de paso la repara: escribir sobre la fila
  // huérfana la deja asociada a su operación en vez de crear una duplicada.
  const [propia] = await db
    .select()
    .from(dropiConnection)
    .where(eq(dropiConnection.operationId, op.id))
    .limit(1);
  const existing = propia ?? (await orphanConnectionFor(op));
  if (existing) {
    await db
      .update(dropiConnection)
      .set({ ...patch, operationId: op.id, updatedAt: new Date() })
      .where(eq(dropiConnection.id, existing.id));
  } else {
    // `id` es el entero con default 1 que heredó del singleton: la conexión de
    // una segunda operación necesita el suyo o choca contra la clave primaria.
    const [top] = await db
      .select({ maxId: sql<number | null>`max(${dropiConnection.id})` })
      .from(dropiConnection);
    await db
      .insert(dropiConnection)
      .values({ ...patch, id: Number(top?.maxId ?? 0) + 1, operationId: op.id });
  }
  invalidateDropiConnectionCache(op);
}
