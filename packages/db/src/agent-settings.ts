import { asc } from "drizzle-orm";
import { getDb } from "./client";
import { agentSettings, type AgentSettings } from "./schema";

/**
 * Accesor único de la configuración de agente.
 *
 * Antes había quince lecturas inline `.from(agentSettings).where(eq(id, 1))`
 * repartidas por nueve archivos del worker y una del panel, más dos
 * `getSettings()` duplicados dentro de los jobs de Dropi. Ninguna decía de qué
 * operación quería la configuración, porque solo había una. Con dos países ese
 * silencio es justo el mecanismo por el que la plantilla guatemalteca le llega
 * a un cliente colombiano.
 *
 * Aquí toda lectura pasa por `getAgentSettings(scope)` y el `scope` es
 * obligatorio: el compilador —`strict` y `noUncheckedIndexedAccess`— encuentra
 * la lectura que se olvidó de declararlo.
 *
 * Vive en `@wa/db` y no en el worker porque el panel lee la misma tabla: un
 * solo accesor, no uno por aplicación.
 */

/**
 * La fila global, la única que existe mientras solo opera Guatemala. El
 * contract (ticket 06) la elimina junto con el ámbito `global`.
 */
export const GLOBAL_AGENT_SETTINGS_ID = 1;

/** De qué operación se quiere la configuración. */
export type AgentSettingsScope =
  /** La de esta operación y la de ninguna otra. */
  | { readonly kind: "operation"; readonly operationId: string }
  /**
   * Todavía no hay operación en la mano: la fila global `id = 1`. Sigue siendo
   * una declaración explícita —el llamador dice que lee la global, no que se le
   * olvidó— y es lo que el ticket 06 sale a buscar para eliminarla.
   */
  | { readonly kind: "global" };

export const GLOBAL_AGENT_SETTINGS: AgentSettingsScope = { kind: "global" };

/**
 * Ámbito de una operación que todavía puede venir nula, porque `operation_id`
 * es nullable hasta el contract. Con operación resuelve por operación; sin
 * ella cae a la fila global, que hoy es la misma fila de Guatemala.
 */
export function agentSettingsScope(
  operationId: string | null | undefined,
): AgentSettingsScope {
  return operationId ? { kind: "operation", operationId } : GLOBAL_AGENT_SETTINGS;
}

/** Lo mínimo que la resolución necesita de una fila para decidir. */
export interface ScopedAgentSettingsRow {
  id: number;
  operationId: string | null;
}

/**
 * La regla de aislamiento, pura y sin base de datos: qué fila le corresponde a
 * un ámbito.
 *
 * Pedir la configuración de una operación que no tiene fila devuelve `null`,
 * **nunca la de otra operación**. Preferir «alguna configuración» a «ninguna»
 * es exactamente la fuga que el spec existe para impedir: un cliente
 * colombiano atendido con el prompt, el modelo y las plantillas de Guatemala.
 * Sin configuración el agente no responde, y eso se ve; con la configuración
 * equivocada responde mal, y eso no se ve.
 */
export function resolveAgentSettings<T extends ScopedAgentSettingsRow>(
  rows: readonly T[],
  scope: AgentSettingsScope,
): T | null {
  if (scope.kind === "operation") {
    return rows.find((r) => r.operationId === scope.operationId) ?? null;
  }
  return rows.find((r) => r.id === GLOBAL_AGENT_SETTINGS_ID) ?? null;
}

/**
 * La configuración de agente de un ámbito, o `null` si ese ámbito no tiene.
 *
 * Trae las filas y resuelve en memoria con `resolveAgentSettings` a propósito:
 * la regla de aislamiento vive en un solo lugar —el que los tests ejercen— y
 * no partida entre un `where` de SQL y un `find` de TypeScript, que es como se
 * desincronizan. La tabla tiene una fila por operación, así que son unidades,
 * y el orden por `id` hace la resolución determinista.
 */
export async function getAgentSettings(
  scope: AgentSettingsScope,
): Promise<AgentSettings | null> {
  const rows = await getDb()
    .select()
    .from(agentSettings)
    .orderBy(asc(agentSettings.id));
  return resolveAgentSettings(rows, scope);
}
