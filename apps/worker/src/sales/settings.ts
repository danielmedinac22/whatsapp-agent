/**
 * La configuración del vendedor de una operación (`sales_agent_settings`).
 *
 * Tabla propia y no columnas nuevas en `agent_settings`: la del agente de
 * confirmación tiene sesenta y cinco referencias en quince archivos —el lote de
 * mayor radio del proyecto— y generalizarla habría obligado a tocarlas para que
 * el vendedor use una fracción de sus campos.
 *
 * La regla de aislamiento es la misma que la de `getAgentSettings`: pedir la
 * configuración de una operación que no tiene fila devuelve `null`, **nunca la
 * de otra operación**.
 */

import { eq } from "@wa/db";
import { salesAgentSettings, type OperationId, type SalesAgentSettings } from "@wa/db";
import { db } from "../db";
import { OperationScopedCache } from "../operations";

const cache = new OperationScopedCache<SalesAgentSettings | null>();

/** Lo mínimo que hace falta para saber si hay vendedor. Forma estructural. */
export interface SalesAgentConfigRef {
  displayName: string;
}

/**
 * Si la operación tiene un vendedor **configurado**, que es lo que activa toda
 * la lógica nueva de dueño de conversación (riesgo R8 de la no-regresión).
 *
 * La fila sola no basta: la `0022` la crea con todos los textos en `''` para
 * que el panel la vaya llenando, así que existir no significa estar
 * configurada. El listón es el nombre visible —lo mínimo que un vendedor
 * necesita para presentarse— y es deliberadamente conservador: mientras la
 * respuesta sea «no», el comportamiento observable de Guatemala es
 * exactamente el de siempre. Si mañana hace falta un listón más alto (que
 * tenga saludo, o modelo), este es el único sitio donde se cambia.
 */
export function salesAgentIsConfigured(
  settings: SalesAgentConfigRef | null,
): boolean {
  return settings !== null && settings.displayName.trim().length > 0;
}

/** La configuración del vendedor de una operación, o `null` si no tiene. */
export async function getSalesAgentSettings(
  operationId: OperationId,
): Promise<SalesAgentSettings | null> {
  const hit = cache.get(operationId);
  if (hit) return hit.value;
  const [row] = await db
    .select()
    .from(salesAgentSettings)
    .where(eq(salesAgentSettings.operationId, operationId))
    .limit(1);
  const value = row ?? null;
  cache.set(operationId, value);
  return value;
}

/** Sin argumento borra la caché entera; con una operación, solo su entrada. */
export function invalidateSalesAgentSettingsCache(
  operationId?: OperationId,
): void {
  cache.invalidate(operationId);
}
