import {
  connectionPhoneOf,
  getSalesAgentSettings,
  invalidateSalesAgentSettingsCache,
  salesAgentIsConfigured,
  salesAgentSettings,
  sql,
  type Operation,
  type SalesAgentSettings,
} from "@wa/db";
import { resolvePanelOperation } from "./operation";
import type { SalesAgentSettingsInput } from "@wa/shared";
import { normalizeSalesAgentSettings } from "@wa/shared";
import { db } from "./db";

/**
 * La pantalla del vendedor, del lado del servidor: qué lee y qué escribe.
 *
 * **La lectura no se reimplementa.** `getSalesAgentSettings` vive en `@wa/db` y
 * es el mismo accesor que usa el worker para armar la persona: un accesor por
 * aplicación es la forma de que el panel y el que contesta terminen mirando
 * filas distintas. Lo único propio de acá es la escritura, que hasta ahora no
 * existía en ninguna parte.
 *
 * La escritura vive en el panel y no en el worker por dónde queda el borde: la
 * configuración de Katherine pasa por una ruta del worker porque de ahí cuelga
 * el historial de versiones de su prompt; la del vendedor no tiene historial ni
 * efectos, es una fila, y el panel ya escribe en la base por su cuenta en otros
 * puntos (`setAgentMode`, las plantillas).
 */

/** Todo lo que la pantalla necesita para dibujarse. */
export interface VendedorScreen {
  operation: Operation;
  /** `null` mientras la operación no tenga fila — el estado de producción hoy. */
  settings: SalesAgentSettings | null;
  /**
   * El número por el que sale lo que el vendedor escribe. Es contexto de solo
   * lectura: se configura en Conexión y esta pantalla no lo toca.
   */
  phone: string | null;
}

export async function loadVendedorScreen(): Promise<VendedorScreen> {
  // La misma operación que edita la pantalla de Katherine, resuelta igual:
  // hasta el selector es la única activa, y con dos falla en vez de adivinar.
  const operation = await resolvePanelOperation();
  const [settings, phone] = await Promise.all([
    getSalesAgentSettings(operation),
    // El mismo lector que el riel del marco, y por eso cacheado igual: dos
    // consultas a `kapso_connection` desde el panel eran dos cachés que se
    // desincronizan la primera vez que alguien toque una (PRO-15).
    connectionPhoneOf(operation.id),
  ]);
  return { operation, settings, phone };
}

/**
 * Guarda la configuración del vendedor de la operación del panel, **creando la
 * fila si no existe** — que es el caso de hoy: la tabla está vacía y la primera
 * vez que alguien abra esta pantalla y guarde va a ser un `INSERT`.
 *
 * Es un upsert sobre el índice único de `operation_id` y no un
 * «leer, decidir, escribir» por una razón concreta: entre la lectura y la
 * escritura cabe otro guardado, y el segundo `INSERT` chocaría contra el índice
 * y volvería como un error de base en vez de guardar. El conflicto lo resuelve
 * Postgres.
 *
 * **No toca `display_name` de otra forma que la que le mandaron.** Guardar la
 * pantalla a medio llenar deja el nombre vacío y el vendedor apagado; encenderlo
 * es escribir un nombre, y es la única forma.
 *
 * **Y ese acto es el que estampa la línea de corte.** `activated_at` se escribe
 * al pasar el nombre de vacío a no vacío, en la misma sentencia que lo escribe:
 * son el mismo hecho —«acá se encendió el vendedor»— y partirlos en dos
 * sentencias abriría el hueco de un guardado exitoso con la fecha sin poner. De
 * ahí en adelante **no se vuelve a mover**, ni siquiera si el vendedor se apaga
 * borrando el nombre y se enciende otra vez: re-estamparla arrastraría a la
 * bandeja de Katherine conversaciones que el vendedor ya estaba trabajando.
 */
export async function saveVendedorSettings(
  input: SalesAgentSettingsInput,
): Promise<void> {
  const operation = await resolvePanelOperation();
  const fields = normalizeSalesAgentSettings(input);
  const encendido = salesAgentIsConfigured(fields);
  await db
    .insert(salesAgentSettings)
    .values({
      operationId: operation.id,
      ...fields,
      // La fila nace con línea de corte solo si nace con nombre. `now()` de
      // Postgres y no el reloj del panel: la fecha contra la que se comparan
      // los nacimientos sale del mismo reloj que los escribió.
      activatedAt: encendido ? sql`now()` : null,
    })
    .onConflictDoUpdate({
      target: salesAgentSettings.operationId,
      set: {
        ...fields,
        updatedAt: new Date(),
        // Solo se escribe al encender, y el `coalesce` es el «una sola vez»:
        // con fecha puesta se queda la de entonces. Guardar con el nombre
        // vacío ni siquiera toca la columna, así que apagar al vendedor no le
        // devuelve a Katherine las conversaciones que él ya trabajaba.
        ...(encendido
          ? {
              activatedAt: sql`coalesce(${salesAgentSettings.activatedAt}, now())`,
            }
          : {}),
      },
    });
  // **Invalidar es obligación de quien escribe** (PRO-15). Esta fila es el
  // interruptor de las dos bandejas: sin esta línea, encender al vendedor
  // dejaría el panel dibujando el marco de antes hasta que la entrada venciera,
  // y el admin lo leería como que el guardado no funcionó.
  invalidateSalesAgentSettingsCache(operation.id);
}
