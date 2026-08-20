import { and, asc, eq, isNull } from "drizzle-orm";
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

/** Lo mínimo que hace falta para saber si hay vendedor. Forma estructural. */
export interface SalesAgentConfigRef {
  displayName: string;
}

/**
 * **El único listón de «hay vendedor» del monorepo.**
 *
 * Vive acá, junto a la tabla que describe, porque hasta hoy había tres
 * respuestas a la misma pregunta y una era distinta: el worker preguntaba por
 * `display_name` no vacío en dos sitios, y el panel preguntaba si la fila
 * existía. Las tres se leen igual de razonables por separado; juntas, abrir la
 * pantalla de configuración encendía el módulo, porque el `upsert` crea la fila
 * con todos los textos en `''`. Eso es exactamente lo que pasó en Guatemala.
 *
 * **La fila sola no basta.** Los textos son `NOT NULL default ''`, así que
 * existir no es estar configurada: tomar la existencia como «hay vendedor»
 * convierte un `INSERT` a medio llenar en el momento en que Guatemala deja de
 * ser atendida por Katherine, sin que nadie lo haya pedido.
 *
 * El listón es el nombre visible porque es lo mínimo que un vendedor necesita
 * para presentarse y el único campo que el cliente ve, y es deliberadamente
 * conservador: mientras la respuesta sea «no», el comportamiento observable de
 * Guatemala es exactamente el de siempre —el riesgo R8 de la no-regresión—. Si
 * mañana hace falta un listón más alto (que tenga saludo, o modelo), **este es
 * el único sitio donde se cambia**, y esa frase ahora es verdad.
 *
 * Es un guardia de tipo y no un `boolean` suelto para que preguntar por el
 * vendedor y quedarse con su fila sean el mismo acto: quien pasó el listón ya
 * tiene la fila en la mano, sin un `!` que vuelva a afirmar lo que la condición
 * acaba de comprobar.
 */
export function salesAgentIsConfigured<T extends SalesAgentConfigRef>(
  settings: T | null,
): settings is T {
  return settings !== null && settings.displayName.trim().length > 0;
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
  const row = resolveSalesAgentSettings(rows, op);
  return row === null ? null : stampSalesAgentActivation(row);
}

/** Lo mínimo que hace falta para decidir si a una fila le falta la fecha. */
export interface ActivationStampRef extends SalesAgentConfigRef {
  activatedAt: Date | null;
}

/**
 * Si a esta fila le falta la línea de corte: **la decisión** del respaldo
 * perezoso, sin la escritura.
 *
 * Está aparte y exportada porque es la mitad que se puede probar con fixtures
 * de dos campos —la escritura es el borde, y el borde no se prueba, como en el
 * resto del repo—. Y es la mitad donde está el «una sola vez»: `activatedAt`
 * no nulo devuelve `false`, así que **una fecha ya puesta no se vuelve a
 * escribir nunca**, ni siquiera si el vendedor se apagó y se volvió a encender.
 *
 * Los dos requisitos son necesarios y ninguno alcanza solo: sin nombre no hay
 * vendedor que encender —estampar ahí pondría la fecha de una activación que
 * nunca ocurrió, y mandaría a la bandeja de ventas todo lo nacido después—, y
 * con fecha puesta no hay nada que hacer.
 */
export function needsActivationStamp(row: ActivationStampRef | null): boolean {
  return salesAgentIsConfigured(row) && row.activatedAt === null;
}

/**
 * **El respaldo perezoso de la línea de corte**: si la fila ya tiene vendedor y
 * `activated_at` sigue en `null`, se estampa en esta lectura.
 *
 * El camino normal es el otro —el guardado del panel estampa la fecha al pasar
 * `display_name` de vacío a no vacío—, y este es el que cubre todo lo demás:
 * llenar la columna por SQL, por un seed, o por una restauración. Sin él, esos
 * caminos dejan `activated_at` en `null` para siempre, la bandeja de ventas
 * queda vacía con el vendedor encendido, y **nadie entiende por qué**: no hay
 * error, no hay log, solo un contador en cero que parece correcto.
 *
 * **Escribir desde una lectura es deliberado y tiene precedente en este repo**
 * —`releaseStaleAssignments` suelta asignaciones viejas desde la carga del
 * Inbox, y su comentario dice que aprovecha el viaje—. El costo aquí es menor
 * que allá: la escritura ocurre **una vez en la vida de la operación** y no en
 * cada lectura, porque después de la primera `activated_at` deja de ser `null`.
 * Con el vendedor apagado —producción hoy— no ocurre nunca: la condición pide
 * nombre visible.
 *
 * El `where activated_at is null` no es defensivo por gusto: es lo que hace
 * cumplir el «una sola vez» cuando dos lecturas entran a la vez —el panel y el
 * worker, por ejemplo—, sin transacción ni bloqueo. La segunda no encuentra
 * fila que actualizar y se queda con la fecha de la primera.
 *
 * **No atrapa el error a propósito.** Un `UPDATE` por clave primaria que falla
 * es la base caída, y devolver la fila sin estampar dejaría exactamente el
 * estado que esta función existe para impedir: un vendedor encendido con la
 * bandeja vacía y nada que lo explique.
 */
export async function stampSalesAgentActivation(
  row: SalesAgentSettings,
): Promise<SalesAgentSettings> {
  if (!needsActivationStamp(row)) return row;
  const [stamped] = await getDb()
    .update(salesAgentSettings)
    .set({ activatedAt: new Date() })
    .where(
      and(
        eq(salesAgentSettings.id, row.id),
        isNull(salesAgentSettings.activatedAt),
      ),
    )
    .returning();
  return stamped ?? row;
}
