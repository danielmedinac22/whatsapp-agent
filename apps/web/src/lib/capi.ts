import type { CapiEstado } from "@wa/shared";
import { workerJson } from "@/lib/worker";

/**
 * El estado del reporte de conversiones, armado en el servidor.
 *
 * Vive acá y no en `lib/queries.ts` por la misma razón que `lib/catalogo.ts`:
 * no consulta tablas. El libro de conversiones y el barrido los lee el worker
 * —es quien tiene las credenciales y quien decide qué se reporta—, así que el
 * panel pregunta y dibuja. Que el barrido se recalcule allá, con la misma
 * función que hace el trabajo, es lo que impide que el tablero diga una cosa
 * mientras el worker hace otra.
 *
 * **La forma la declara `@wa/shared`**, no este archivo: son las dos mitades
 * del mismo módulo y el modo de fallar de este tablero es el silencio.
 */

/** Lo que la pantalla dibuja, o por qué no pudo. */
export type CapiEstadoView =
  | { ok: true; estado: CapiEstado }
  /**
   * El worker no contestó. **No es lo mismo que «no hay conversiones sin
   * llegar»**, y por eso es un caso propio en vez de un estado vacío: una
   * consulta que falla no es un dato que no existe.
   */
  | { ok: false; error: string };

/**
 * De qué operación se pide el estado **no lo decide este archivo**: viaja como
 * header desde la cookie del panel (`workerFetch`), y el worker lo resuelve con
 * la misma regla que las demás rutas. Resolverlo acá sería una consulta por
 * llamada para tirar el resultado, y dos formas de decidir el país.
 */
export async function loadCapiEstado(): Promise<CapiEstadoView> {
  try {
    return { ok: true, estado: await workerJson<CapiEstado>("/api/capi/estado") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
