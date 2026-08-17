import { asc } from "drizzle-orm";
import { getDb } from "./client";
import type { Operation } from "./schema";
import { agentSettings, type AgentSettings } from "./schema";

/**
 * Accesor único de la configuración de agente.
 *
 * Antes había quince lecturas inline `.from(agentSettings).where(eq(id, 1))`
 * repartidas por nueve archivos del worker y una del panel. Ninguna decía de
 * qué operación quería la configuración, porque solo había una. Con dos países
 * ese silencio es justo el mecanismo por el que la plantilla guatemalteca le
 * llega a un cliente colombiano.
 *
 * El lote 05 las reunió aquí detrás de un tipo suma con un caso `global` — la
 * fila `id = 1` — porque la conexión de logística todavía no declaraba su
 * operación y no había de dónde sacarla. **El contract (ticket 06) borró ese
 * caso.** Hoy el parámetro es la operación, y no hay forma de pedir «la»
 * configuración: `id = 1` era un default que resolvía a Guatemala, y un default
 * a Guatemala es exactamente lo que un cliente colombiano no puede recibir.
 *
 * Vive en `@wa/db` y no en el worker porque el panel lee la misma tabla: un
 * solo accesor, no uno por aplicación.
 */

/** Lo mínimo que la resolución necesita de una fila para decidir. */
export interface ScopedAgentSettingsRow {
  operationId: string;
}

/**
 * La regla de aislamiento, pura y sin base de datos: qué fila le corresponde a
 * una operación.
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
  op: Operation,
): T | null {
  return rows.find((r) => r.operationId === op.id) ?? null;
}

/**
 * La configuración de agente de una operación, o `null` si esa operación no
 * tiene.
 *
 * Trae las filas y resuelve en memoria con `resolveAgentSettings` a propósito
 * —decisión del lote 05 que el contract conserva—: la regla de aislamiento vive
 * en un solo lugar, el que los tests ejercen, y no partida entre un `where` de
 * SQL y un `find` de TypeScript, que es como se desincronizan. La tabla tiene
 * una fila por operación (índice único desde la `0021`), así que son unidades.
 */
export async function getAgentSettings(
  op: Operation,
): Promise<AgentSettings | null> {
  const rows = await getDb()
    .select()
    .from(agentSettings)
    .orderBy(asc(agentSettings.id));
  return resolveAgentSettings(rows, op);
}
