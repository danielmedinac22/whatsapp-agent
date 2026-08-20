import { eq, sql } from "@wa/db";
import {
  dropiConnection,
  invalidateAssetsBaseUrlCache,
  operations,
  type DropiConnection,
  type Operation,
} from "@wa/db";
import { db } from "../db";
import { OperationScopedCache } from "../operations";

// ────────────────────────────────────────────────────────────────────────────
// Los helpers de operación **ya no viven aquí**.
//
// Este archivo tenía su propio `listActiveOperations`, `requireSoleActiveOperation`
// y `resolveOperationForContact`, y una caché en `Map` equivalente a
// `OperationScopedCache`, porque el lote de logística corrió en paralelo con el
// de WhatsApp y no podían verse. El contract (ticket 06) los unificó en
// `@wa/db` (`operations.ts`): dos implementaciones de «cuál es la única
// operación activa» se desincronizan en cuanto una se toque, y la que quede
// vieja responde con el país equivocado.
//
// Lo único que se quedó es lo que de verdad es de logística: encontrar la
// operación por el teléfono del administrador de Dropi.
// ────────────────────────────────────────────────────────────────────────────

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

/**
 * Caché indexada por operación. Con una sola entrada —como estaba antes de la
 * migración— la segunda operación recibiría la conexión de la primera durante
 * 30 segundos, sin fallar ni compilar mal: pediría guías al Dropi del país
 * equivocado.
 *
 * Es la misma `OperationScopedCache` que usan las conexiones de WhatsApp y de
 * la tienda: el contract cambió el `Map` propio de este archivo por la clase
 * compartida y probada.
 */
const connectionCache = new OperationScopedCache<DropiConnection | null>();

/**
 * La conexión de logística de una operación. **Estricta.**
 *
 * El contract (ticket 06) borró `resolveDropiConnection`, la versión con red:
 * caía en la fila «huérfana» —una `dropi_connection` con `operation_id` en
 * `NULL`, la que habría dejado el código anterior a la migración— cuando `op`
 * era la única operación activa. La `0021` volvió `operation_id` obligatoria,
 * así que esa fila huérfana ya no puede existir y la red no tenía nada que
 * atrapar. Una red que no puede atrapar nada promete una garantía que nadie
 * prueba.
 */
export async function getDropiConnection(
  op: Operation,
): Promise<DropiConnection | null> {
  const hit = connectionCache.get(op.id);
  if (hit) return hit.value;
  const [row] = await db
    .select()
    .from(dropiConnection)
    .where(eq(dropiConnection.operationId, op.id))
    .limit(1);
  const value = row ?? null;
  connectionCache.set(op.id, value);
  return value;
}

/** Invalida solo la operación tocada: la de al lado sigue siendo válida. */
export function invalidateDropiConnectionCache(op: Operation): void {
  connectionCache.invalidate(op.id);
  // El Inbox del panel cachea aparte la URL base de los archivos —es lo único
  // que usa de esta fila, y la lee cruzando el país (PRO-15)—. Se cuelga del
  // invalidador que ya existía: `upsertDropiConnection` es el único que
  // escribe y ya pasa por acá.
  invalidateAssetsBaseUrlCache(op.id);
}

export async function upsertDropiConnection(
  op: Operation,
  patch: Partial<DropiConnection>,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(dropiConnection)
    .where(eq(dropiConnection.operationId, op.id))
    .limit(1);
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
