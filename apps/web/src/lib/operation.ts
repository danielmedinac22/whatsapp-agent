/**
 * Sobre qué operación está trabajando el panel.
 *
 * **La elección viaja en una cookie `httpOnly`**, decidido con el usuario el
 * 18-ago-2026 sobre las otras dos opciones que estaban en la mesa:
 *
 * - *Segmento en la URL* (`/gt/inbox`): obligaba a mudar las ocho pantallas a
 *   una ruta dinámica y a tocar todos los `href`. La señal en pantalla ya la da
 *   la barra teñida — la de direcciones no tenía que cargarla. **Ninguna
 *   URL existente cambia**, y ese fue el criterio.
 * - *En la sesión de next-auth*: la elección quedaría dentro del JWT, así que
 *   cambiar de país exigiría reemitir la sesión.
 *
 * **Por qué la cookie no se lee desde `@wa/db`:** ese paquete lo importa
 * también el worker, que no tiene contexto de request de Next.js. La regla de
 * resolución vive allá y es una sola (`requirePanelOperation`); el que sabe de
 * cookies es este archivo, y el worker recibe la misma elección por el header
 * `x-operation-id` (ver `lib/worker.ts`).
 */

import { cookies } from "next/headers";
import {
  listOperations,
  panelOperationState,
  requirePanelOperation,
  type Operation,
  type PanelOperationState,
} from "@wa/db";

/** La operación elegida. `httpOnly`: no la escribe el navegador, solo el servidor. */
export const PANEL_OPERATION_COOKIE = "panel_operation";

/**
 * Si las barras del marco están plegadas. Global y no por pantalla: decisión 9
 * del nivel 1 — plegar es del usuario, y que se despliegue solo al cambiar de
 * pantalla sería el marco moviéndose sin que nadie lo pida.
 */
export const PANEL_BARS_COOKIE = "panel_bars";

export type PanelBars = "open" | "collapsed";

/** Un año: la elección de operación y el plegado sobreviven al cierre del navegador. */
export const PANEL_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * La operación sobre la que trabaja esta request.
 *
 * **Sin cookie devuelve la única activa**, y eso es lo que mantiene a Guatemala
 * funcionando exactamente igual que antes del selector: hoy hay una sola
 * operación (`GT`, `active`), así que todo admin que nunca haya tocado el selector
 * ve lo mismo que veía. Una cookie que nombra una operación que ya no existe
 * cae al mismo puente en vez de dejar el panel muerto.
 */
export async function resolvePanelOperation(): Promise<Operation> {
  const jar = await cookies();
  return requirePanelOperation(jar.get(PANEL_OPERATION_COOKIE)?.value);
}

/**
 * Lo mismo, **sin lanzar**: la decisión y la tabla entera.
 *
 * Lo usa el marco y solo el marco. Con dos operaciones activas y sin elección,
 * `resolvePanelOperation()` lanza —y tiene que lanzar—, pero el layout es el
 * que dibuja el selector con el que se elige: si lanzara ahí, el panel quedaría sin
 * salida el día que Colombia se ponga `active`. El marco se dibuja igual y no
 * renderiza ninguna pantalla hasta que haya operación.
 */
export async function resolvePanelOperationState(): Promise<PanelOperationState> {
  const jar = await cookies();
  return panelOperationState(jar.get(PANEL_OPERATION_COOKIE)?.value);
}

/**
 * Solo el id, sin ir a la base. Es lo que `workerFetch` reenvía al worker: el
 * worker la valida con la misma regla, así que traducir id → fila de este lado
 * sería una consulta por cada llamada para tirar el resultado.
 */
export async function panelOperationIdCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(PANEL_OPERATION_COOKIE)?.value ?? null;
}

/** Las operaciones del selector: todas, porque que exista el otro país es la mitad de lo que comunica. */
export function listPanelOperations(): Promise<Operation[]> {
  return listOperations();
}

/** Si el marco arranca plegado. Cualquier valor que no sea `collapsed` es abierto. */
export async function resolvePanelBars(): Promise<PanelBars> {
  const jar = await cookies();
  return jar.get(PANEL_BARS_COOKIE)?.value === "collapsed"
    ? "collapsed"
    : "open";
}
