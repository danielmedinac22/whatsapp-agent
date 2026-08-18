import {
  eq,
  getSalesAgentSettings,
  kapsoConnection,
  salesAgentSettings,
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
    connectionPhone(operation),
  ]);
  return { operation, settings, phone };
}

async function connectionPhone(operation: Operation): Promise<string | null> {
  const [row] = await db
    .select({ phone: kapsoConnection.displayPhoneNumber })
    .from(kapsoConnection)
    .where(eq(kapsoConnection.operationId, operation.id))
    .limit(1);
  return row?.phone ?? null;
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
 */
export async function saveVendedorSettings(
  input: SalesAgentSettingsInput,
): Promise<void> {
  const operation = await resolvePanelOperation();
  const fields = normalizeSalesAgentSettings(input);
  await db
    .insert(salesAgentSettings)
    .values({ operationId: operation.id, ...fields })
    .onConflictDoUpdate({
      target: salesAgentSettings.operationId,
      set: { ...fields, updatedAt: new Date() },
    });
}
