import { getDb } from "./client";
import { OPERATION_CACHE_MS, OperationScopedCache } from "./cache";
import type { OperationId } from "./operations";
import { kapsoConnection } from "./schema";

/**
 * **Las lecturas del panel que dejaron de viajar** (PRO-15).
 *
 * Un render del Inbox hacía trece consultas y cuatro de ellas traían datos que
 * cambian una vez al mes: las plantillas aprobadas de WhatsApp, la URL base de
 * los archivos de logística, los teléfonos del selector de operación y la
 * configuración del vendedor. Cada una paga la distancia entera —el panel corre
 * en Vercel y cruza el país hasta Postgres— para traer lo mismo que el render
 * anterior.
 *
 * **Por qué las cachés viven acá y no junto a su consulta.** Las cuatro se
 * *leen* desde `apps/web` y tres se *escriben* desde `apps/worker`, que son dos
 * procesos y dos despliegues. Una caché cuyo invalidador no puede alcanzar al
 * que escribe es una caché que miente, así que el almacén tiene que estar donde
 * los dos lo alcanzan: en el paquete que comparten. Las consultas se quedan en
 * su sitio —`listApprovedWaTemplates` sigue en `queries.ts`, con su filtro por
 * operación a la vista de la red de alcance—; lo que sube es dónde se guarda lo
 * que trajeron.
 *
 * **Y lo que la invalidación NO alcanza, dicho acá y no descubierto después.**
 * El panel corre en funciones de Vercel: hay varias instancias vivas a la vez y
 * cada una tiene su propio proceso, o sea su propia copia de estos `Map`.
 * Invalidar en el punto de escritura vacía **la instancia que atendió esa
 * escritura**, no las demás; y cuando quien escribe es el worker, no vacía
 * ninguna del panel. Lo que de verdad acota el desfase es el TTL. Por eso el
 * TTL es corto para lo que es un interruptor y no un dato: ver
 * {@link CACHE_DEL_VENDEDOR_MS}.
 *
 * Nada de lo que entra acá depende de la conversación ni del usuario: son datos
 * de la operación. Es la línea que separa esto de cachear una pantalla.
 */

/**
 * Las plantillas aprobadas de WhatsApp de una operación, por su nombre.
 *
 * Las escribe el worker —`ensureKapsoTemplates` cuando somete el catálogo y
 * `refreshKapsoTemplateStatuses` cuando Meta cambia un estado— y las lee el
 * Inbox del panel, que las usa para armar el menú de plantillas de la barra de
 * envío.
 */
export const plantillasAprobadasCache = new OperationScopedCache<string[]>();

/**
 * A llamar cuando se somete una plantilla o cuando cambia su estado en Meta.
 * **Editar plantillas invalida plantillas**: sin esto, una plantilla recién
 * aprobada no aparece en la barra de envío y nadie sabe por qué.
 */
export function invalidateApprovedWaTemplatesCache(op?: OperationId): void {
  plantillasAprobadasCache.invalidate(op);
}

/**
 * La URL base desde la que se sirven los PDF de las guías de una operación.
 *
 * La escribe `upsertDropiConnection` en el worker, desde la pantalla de
 * Conexión. Se guarda ya normalizada —sin la barra final— porque es como la
 * pantalla la usa, y normalizar dos veces el mismo dato es cómo se separan.
 */
export const urlDeArchivosCache = new OperationScopedCache<string>();

/** A llamar al guardar la conexión de logística de una operación. */
export function invalidateAssetsBaseUrlCache(op?: OperationId): void {
  urlDeArchivosCache.invalidate(op);
}

/**
 * **El TTL del vendedor es más corto que el de los demás, y a propósito.**
 *
 * `sales_agent_settings` no es un dato: es el interruptor que decide si la
 * operación tiene dos bandejas o una, y con él quién contesta. El resto de lo
 * que hay acá se ve mal durante unos segundos —una plantilla que todavía no
 * aparece en el menú—; este se *comporta* distinto. Cinco segundos alcanzan
 * para que el marco y la pantalla del mismo render lean una sola vez, que es de
 * donde salía la consulta repetida, y es una ventana lo bastante corta como
 * para que nadie llegue a ver el panel a medio encender después de guardar.
 */
export const CACHE_DEL_VENDEDOR_MS = 5_000;

// ────────────────────────────────────────────────────────────────────────────
// El selector de operación
// ────────────────────────────────────────────────────────────────────────────

/**
 * Los teléfonos del selector: **la tabla entera, no una operación**.
 *
 * Es deliberado y es la misma forma de {@link listOperations}. El selector del
 * panel lista todas las operaciones con su número —que exista el otro país es la
 * mitad de lo que comunica—, así que acotarlo a una operación sería
 * acotarlo a lo que no muestra. Por eso esta no es una `OperationScopedCache`:
 * no hay clave de operación que llevar, y ponerle una sería llavear por algo
 * que la consulta no filtra, que es la mentira que la clave existe para evitar.
 */
export interface RailPhone {
  operationId: OperationId;
  phone: string | null;
}

let phonesCache: { rows: RailPhone[]; at: number } | null = null;

export async function listConnectionPhones(
  ahora: number = Date.now(),
): Promise<RailPhone[]> {
  if (phonesCache && ahora - phonesCache.at < OPERATION_CACHE_MS) {
    return phonesCache.rows;
  }
  const rows = await getDb()
    .select({
      operationId: kapsoConnection.operationId,
      phone: kapsoConnection.displayPhoneNumber,
    })
    .from(kapsoConnection);
  phonesCache = { rows, at: ahora };
  return rows;
}

/** A llamar al conectar, reconectar o desconectar un número de WhatsApp. */
export function invalidateConnectionPhonesCache(): void {
  phonesCache = null;
}

/**
 * El teléfono de una operación, derivado de la lista del selector.
 *
 * Se deriva y no se consulta por la misma razón que `listActiveOperations`
 * deriva de `listOperations`: dos consultas para la misma tabla son dos cachés
 * que se desincronizan, y son una o dos filas — filtrar cuesta nada.
 */
export async function connectionPhoneOf(
  operationId: OperationId,
  ahora: number = Date.now(),
): Promise<string | null> {
  const rows = await listConnectionPhones(ahora);
  return rows.find((r) => r.operationId === operationId)?.phone ?? null;
}
