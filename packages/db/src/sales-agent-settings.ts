import { asc } from "drizzle-orm";
import { getDb } from "./client";
import type { Operation } from "./schema";
import { salesAgentSettings, type SalesAgentSettings } from "./schema";

/**
 * Accesor único de la configuración del vendedor.
 *
 * Es una **tabla hermana** de `agent_settings`, no una generalización de ella,
 * y eso no se re-litiga: las 65 referencias de `agent_settings` son en su
 * mayoría campos de Katherine —plantillas de logística, demoras de seguimiento,
 * acuse de confirmación—. No es «configuración de agente»: es la de Katherine
 * con nombre genérico. Volverla multi-agente obligaría a un expand–contract
 * sobre esos 65 call sites para que el vendedor use una fracción de las
 * columnas. Con la tabla hermana, el radio de impacto sobre lo existente es
 * cero — literalmente: este archivo no toca ninguno de ellos.
 *
 * Vive en `@wa/db` y no en el worker por la misma razón que su hermano: el
 * panel lee la misma tabla, y un accesor por aplicación es la forma de que se
 * desincronicen.
 */

/** Lo mínimo que la resolución necesita de una fila para decidir. */
export interface ScopedSalesAgentSettingsRow {
  operationId: string;
}

/**
 * La regla de aislamiento, pura y sin base de datos: qué fila le corresponde a
 * una operación.
 *
 * Es la misma de `resolveAgentSettings` y por el mismo motivo. Una operación
 * sin fila devuelve `null`, **nunca la de otra operación**: sin configuración
 * de ventas el vendedor no existe para esa operación y contesta Katherine
 * —comportamiento de hoy, que se nota si cambia—; con la configuración de la
 * vecina, un lead colombiano recibiría el nombre, el tono y el límite de
 * descuento pensados para Guatemala, y eso no se nota hasta que alguien lee la
 * conversación.
 *
 * Y hay un segundo motivo, propio de esta tabla: **`null` es el interruptor de
 * la no-regresión**. Mientras `sales_agent_settings` esté vacía —como está en
 * producción— toda conversación resuelve a Katherine exactamente como antes.
 * Que la resolución nunca invente una fila es lo que hace verdadera esa frase.
 */
export function resolveSalesAgentSettings<T extends ScopedSalesAgentSettingsRow>(
  rows: readonly T[],
  op: Operation,
): T | null {
  return rows.find((r) => r.operationId === op.id) ?? null;
}

/**
 * La configuración del vendedor de una operación, o `null` si esa operación no
 * tiene vendedor configurado.
 *
 * Trae las filas y resuelve en memoria con {@link resolveSalesAgentSettings},
 * igual que el hermano: la regla de aislamiento vive en un solo lugar —el que
 * los tests ejercen— y no partida entre un `where` de SQL y un `find` de
 * TypeScript, que es como se desincronizan. La tabla tiene una fila por
 * operación (índice único desde la `0022`), así que son unidades.
 */
export async function getSalesAgentSettings(
  op: Operation,
): Promise<SalesAgentSettings | null> {
  const rows = await getDb()
    .select()
    .from(salesAgentSettings)
    .orderBy(asc(salesAgentSettings.createdAt));
  return resolveSalesAgentSettings(rows, op);
}
