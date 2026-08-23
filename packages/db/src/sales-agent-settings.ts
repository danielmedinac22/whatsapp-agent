import { and, asc, eq, isNull } from "drizzle-orm";
import { OperationScopedCache } from "./cache";
import { CACHE_DEL_VENDEDOR_MS } from "./caches-del-panel";
import { getDb } from "./client";
import type { OperationId } from "./operations";
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
  /** El interruptor declarado (`0033`). */
  enabled: boolean;
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
 * **Desde la `0033` el listón son dos condiciones, y ninguna sobra.**
 *
 * `enabled` es el interruptor y es lo que cambió: antes el encendido se
 * *deducía* de que hubiera nombre, y un estado deducido de la ausencia de un
 * dato no se puede mostrar en una pantalla ni apagar sin destruir el dato. Ahora
 * encender es un acto que alguien declara.
 *
 * El nombre visible sigue pesando porque el interruptor solo no alcanza: la
 * tabla se puede escribir por SQL, por un seed o por una restauración, y un
 * vendedor encendido sin nombre se le presentaría al cliente como nadie. La
 * dirección segura del error es que no atienda — el mismo criterio con el que
 * este listón se escribió la primera vez. El panel no deja producir esa
 * combinación; esta función la cubre igual, por si el panel no es quien
 * escribe.
 *
 * Es deliberadamente conservador: mientras la respuesta sea «no», el
 * comportamiento observable de Guatemala es exactamente el de siempre —el
 * riesgo R8 de la no-regresión—. Si mañana hace falta un listón más alto (que
 * tenga saludo, o modelo), **este es el único sitio donde se cambia**, y esa
 * frase sigue siendo verdad: los ocho sitios que preguntan no se enteraron de
 * que el listón cambió.
 *
 * Es un guardia de tipo y no un `boolean` suelto para que preguntar por el
 * vendedor y quedarse con su fila sean el mismo acto: quien pasó el listón ya
 * tiene la fila en la mano, sin un `!` que vuelva a afirmar lo que la condición
 * acaba de comprobar.
 */
export function salesAgentIsConfigured<T extends SalesAgentConfigRef>(
  settings: T | null,
): settings is T {
  return (
    settings !== null &&
    settings.enabled &&
    settings.displayName.trim().length > 0
  );
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
  return vendedorCache.recordar(op.id, async () => {
    const rows = await getDb()
      .select()
      .from(salesAgentSettings)
      .orderBy(asc(salesAgentSettings.createdAt));
    const row = resolveSalesAgentSettings(rows, op);
    return row === null ? null : stampSalesAgentActivation(row);
  });
}

/**
 * La caché de PRO-15, y la única de las cuatro que guarda un **interruptor**.
 *
 * Un render del Inbox leía esta fila dos veces —el marco pregunta si hay
 * vendedor para dibujar la barra, la pantalla pregunta lo mismo para decidir si
 * hay dos bandejas— y las dos consultas traían la misma fila con la misma
 * distancia de por medio. Sigue siendo un solo listón (`salesAgentIsConfigured`)
 * leído desde un solo accesor: lo que cambia es que el segundo lector encuentra
 * lo que trajo el primero.
 *
 * **Cachea la fila ya estampada**, después de {@link stampSalesAgentActivation}
 * y no antes. Guardar la fila sin estampar dejaría al proceso mirando un
 * `activated_at` en `null` que ya no está en la base, y la bandeja de ventas
 * vacía sin que nada falle — que es exactamente lo que el respaldo perezoso
 * existe para impedir. Es la misma decisión que tomó la caché hermana del
 * worker, escrita acá para que no haya que descubrirla dos veces.
 *
 * El TTL es el corto y no el de treinta segundos: ver {@link CACHE_DEL_VENDEDOR_MS}.
 */
const vendedorCache = new OperationScopedCache<SalesAgentSettings | null>(
  CACHE_DEL_VENDEDOR_MS,
);

/**
 * A llamar al guardar la configuración del vendedor. **Encender o apagar al
 * vendedor cambia lo que el panel muestra en el mismo acto**, y sin esto el
 * admin guardaría un nombre y vería la pantalla de antes.
 *
 * Sin argumento borra la caché entera; con una operación, solo la suya.
 */
export function invalidateSalesAgentSettingsCache(op?: OperationId): void {
  vendedorCache.invalidate(op);
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
 * **Escribir desde una lectura es deliberado, y ahora es la única que queda.**
 * Tenía precedente —`releaseStaleAssignments` soltaba asignaciones viejas
 * desde la carga del Inbox, aprovechando el viaje—, y PRO-20 se llevó ese
 * precedente al worker justamente por lo que lo distingue de éste: aquella
 * escritura la disparaba **cada render**, o sea una vez por mensaje de
 * WhatsApp que entra. Ésta ocurre **una vez en la vida de la operación**,
 * porque después de la primera `activated_at` deja de ser `null`. Con el
 * vendedor apagado —producción hoy— no ocurre nunca: la condición pide nombre
 * visible.
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
