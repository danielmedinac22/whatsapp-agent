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

import { eq, stampSalesAgentActivation } from "@wa/db";
import { salesAgentSettings, type OperationId, type SalesAgentSettings } from "@wa/db";
import { db } from "../db";
import { OperationScopedCache } from "../operations";

const cache = new OperationScopedCache<SalesAgentSettings | null>();

/**
 * El listón de «hay vendedor» **no vive acá**: vive en `@wa/db`, junto a la
 * tabla que describe, y esto es solo el puente para que los sitios del worker
 * que ya lo importaban de este archivo lo sigan importando de este archivo.
 *
 * Se mudó porque había tres respuestas a la misma pregunta —dos en el worker,
 * una en el panel— y la del panel era distinta: preguntaba si la fila existía.
 * Con el `upsert` de `/vendedor` creando la fila con todos los textos en `''`,
 * abrir la pantalla de configuración encendía el módulo.
 */
export {
  salesAgentIsConfigured,
  type SalesAgentConfigRef,
} from "@wa/db";

/**
 * La configuración del vendedor de una operación, o `null` si no tiene.
 *
 * De paso estampa la línea de corte si la fila ya tiene vendedor y
 * `activated_at` sigue en `null` —el respaldo perezoso, ver
 * `stampSalesAgentActivation`—. Va **antes** de la caché a propósito: cachear la
 * fila sin estampar dejaría al proceso entero mirando un `null` que ya no está
 * en la base, y la bandeja de ventas vacía hasta el próximo reinicio.
 */
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
  const value = row ? await stampSalesAgentActivation(row) : null;
  cache.set(operationId, value);
  return value;
}

/** Sin argumento borra la caché entera; con una operación, solo su entrada. */
export function invalidateSalesAgentSettingsCache(
  operationId?: OperationId,
): void {
  cache.invalidate(operationId);
}
