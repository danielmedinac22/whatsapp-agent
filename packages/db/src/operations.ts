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

let allCache: { rows: Operation[]; at: number } | null = null;

/**
 * A llamar cuando se da de alta, se activa o se desactiva una operación. Es lo
 * que arma o desarma el puente de {@link requireSoleActiveOperation}.
 */
export function invalidateOperationsCache(): void {
  allCache = null;
}

/**
 * Todas las operaciones, activas e inactivas, por código de país.
 *
 * La caché guarda **la tabla entera y no solo las activas** desde el ticket 07:
 * el riel del panel muestra también las dormidas —que exista el otro país es la
 * mitad de lo que el riel comunica— y con dos cachés la lista del riel y la del
 * puente se desincronizaban en la ventana de 30 s. Las activas se derivan de
 * aquí, que son una o dos filas: filtrar cuesta nada.
 */
export async function listOperations(): Promise<Operation[]> {
  if (allCache && Date.now() - allCache.at < OPERATIONS_CACHE_MS) {
    return allCache.rows;
  }
  const rows = await getDb()
    .select()
    .from(operations)
    .orderBy(asc(operations.countryCode));
  allCache = { rows, at: Date.now() };
  return rows;
}

/** Las operaciones que atienden hoy. `inactive` existe pero no opera. */
export async function listActiveOperations(): Promise<Operation[]> {
  const rows = await listOperations();
  return rows.filter((o) => o.status === "active");
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
 * Puente para quien todavía no puede recibir la operación por parámetro: las
 * filas de datos cuya `operation_id` sigue siendo nullable. El panel ya no
 * pasa por aquí — desde el ticket 07 usa {@link requirePanelOperation}, que es
 * este mismo puente con la elección del admin por delante.
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

// ────────────────────────────────────────────────────────────────────────────
// De qué operación habla el panel · ticket 07
// ────────────────────────────────────────────────────────────────────────────

/**
 * Por qué el panel terminó hablando de la operación que habla.
 *
 * No es decorativo: distingue «el admin eligió Guatemala» de «nadie eligió y
 * había una sola», que en pantalla se ven igual y en un incidente no son lo
 * mismo. {@link PANEL_OPERATION_REASONS} es la lista para quien la enumere.
 */
export type PanelOperationReason =
  /** Quien llama nombró una operación y existe. */
  | "elegida"
  /** Nadie eligió: cae al puente de la operación única. */
  | "unica_activa"
  /** Nombró una que no existe —cookie vieja, operación dada de baja— y cae al puente. */
  | "eleccion_desconocida";

export const PANEL_OPERATION_REASONS = [
  "elegida",
  "unica_activa",
  "eleccion_desconocida",
] as const satisfies readonly PanelOperationReason[];

/** Lo que {@link decidePanelOperation} resuelve. `operation` null = no se pudo. */
export interface PanelOperationDecision {
  operation: Operation | null;
  reason: PanelOperationReason;
}

/**
 * **La regla del selector, y es pura**: no toca la base ni el reloj. Recibe lo
 * que el panel dijo querer y la tabla de operaciones, y devuelve sobre cuál se
 * trabaja. Se prueba con fixtures de dos filas, no contra producción.
 *
 * Tres decisiones que están aquí y no en quien la llama:
 *
 * 1. **Una elección desconocida no rompe el panel, cae al puente.** Una cookie
 *    que nombra una operación dada de baja dejaría al admin sin panel, y el
 *    puente no puede equivocarse de país: con dos activas devuelve `null` y
 *    quien llama falla. Silencioso solo cuando hay una sola, donde acertar es
 *    lo único posible.
 * 2. **Se puede elegir una operación `inactive`.** El riel las muestra —que
 *    exista el otro país es la mitad de lo que comunica— y configurar Colombia
 *    antes de activarla es justamente el trabajo que destraba el ticket 08.
 *    Lo que no puede pasar es *caer* en una inactiva sin elegirla: el puente
 *    solo mira las activas.
 * 3. **Con cero o dos o más activas y sin elección, devuelve `null`.** Es
 *    `getSingleActiveOperation()` escrito aquí: elegir en silencio es el error
 *    que toda esta migración existe para hacer imposible.
 */
export function decidePanelOperation(input: {
  /** El id que mandó el panel: la cookie en la web, el header en el worker. */
  requested: OperationId | null | undefined;
  /** La tabla entera, activas e inactivas. */
  operations: readonly Operation[];
}): PanelOperationDecision {
  const active = input.operations.filter((o) => o.status === "active");
  const sole = active.length === 1 ? (active[0] ?? null) : null;

  const requested = input.requested?.trim();
  if (!requested) return { operation: sole, reason: "unica_activa" };

  const chosen = input.operations.find((o) => o.id === requested);
  if (chosen) return { operation: chosen, reason: "elegida" };
  return { operation: sole, reason: "eleccion_desconocida" };
}

/** La decisión, con la tabla que la produjo — que es la que dibuja el riel. */
export interface PanelOperationState extends PanelOperationDecision {
  operations: Operation[];
}

/**
 * La decisión **sin lanzar**, para quien tiene que seguir dibujando aunque no
 * haya operación.
 *
 * Existe por un problema que apareció al probar el panel con las dos
 * operaciones activas, y que el mecanismo escrito en el ticket no cubría: con
 * dos activas y sin elección, `requirePanelOperation` lanza — y lo que lanza es
 * el layout, que es **el que dibuja el riel con el que se elige**. El panel
 * quedaba muerto el día de la apertura de Colombia, sin ninguna forma de salir:
 * para elegir hacía falta un riel que no se podía dibujar hasta haber elegido.
 *
 * El marco usa esto y las pantallas siguen usando {@link requirePanelOperation}:
 * así el riel siempre se dibuja y **ninguna pantalla llega a renderizarse con
 * una operación adivinada**. Elegir por el admin seguiría siendo el error que
 * esta migración existe para hacer imposible; lo que cambia es que ahora hay
 * dónde elegir.
 */
export async function panelOperationState(
  requested: OperationId | null | undefined,
): Promise<PanelOperationState> {
  const operations = await listOperations();
  return { ...decidePanelOperation({ requested, operations }), operations };
}

/**
 * De qué operación habla el panel, con la base delante.
 *
 * Es el reemplazo de `panelOperation()`, el puente que el ticket 07 retira: ya
 * no resuelve «la única activa» a ciegas sino la que el admin eligió, y el
 * fallback es lo que mantiene a Guatemala funcionando sin que nadie elija nada.
 *
 * Vive en `@wa/db` y no en cada app porque las dos la necesitan y la regla
 * tiene que ser una: la web le pasa la cookie, el worker el header
 * `x-operation-id`. Quien sabe de cookies es `apps/web` — este paquete lo
 * importa también el worker, que no tiene contexto de request de Next.
 */
export async function requirePanelOperation(
  requested: OperationId | null | undefined,
): Promise<Operation> {
  const { operation, reason } = await panelOperationState(requested);
  if (operation) return operation;

  // Sin operación: el mismo error que daba el puente, que es el que hay que
  // leer en el log. Con dos activas y sin elección dice cuáles son.
  const active = (await listActiveOperations()).map((o) => o.countryCode);
  if (active.length === 0) {
    throw new Error("no hay ninguna operación activa configurada");
  }
  throw new Error(
    `hay ${active.length} operaciones activas (${active.join(", ")}): ` +
      (reason === "eleccion_desconocida"
        ? `el panel pidió la operación ${requested}, que no existe`
        : "el panel tiene que decir sobre cuál trabaja"),
  );
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
