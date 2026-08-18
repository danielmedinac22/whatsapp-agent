/**
 * De qué operación habla el panel cuando le pregunta al worker.
 *
 * Antes lo decidía `panelOperation()` en `@wa/db`: un puente que resolvía «la
 * única activa» y **lanzaba con dos**, a propósito, para que nadie editara el
 * país equivocado en silencio. La consecuencia buscada era que ocho pantallas
 * dejaran de funcionar el día que Colombia se pusiera `active`, y con eso el
 * puente quedaba como algo que hay que quitar antes de abrir Colombia. El
 * ticket 07 es el que lo quita.
 *
 * Lo que llega en su lugar es la elección del admin, en el header
 * `x-operation-id` que pone `workerFetch` desde `apps/web`. La regla de
 * resolución es la misma de los dos lados y vive en `@wa/db`
 * (`requirePanelOperation`): con header, esa operación; sin header, la única
 * activa; con un id que no existe, la única activa otra vez, porque una cookie
 * vieja no puede dejar el panel muerto.
 *
 * **Solo lo usan las rutas que el panel llama.** El webhook de Kapso, el de la
 * tienda y los jobs resuelven su operación por el dato que están procesando
 * —el número que recibió el mensaje, la conversación del contacto— y nunca por
 * aquí: un header del panel no tiene nada que decir sobre un mensaje entrante.
 */

import { requirePanelOperation, type Operation } from "@wa/db";

/** El header por el que viaja la elección. Mismo nombre que en `apps/web`. */
export const OPERATION_HEADER = "x-operation-id";

/**
 * Lo mínimo que hace falta de una request para leer un header. Es una forma
 * estructural y no el `Context` de Hono para que se pueda llamar con un objeto
 * de dos líneas, igual que hace `actorEmail` en `routes/agent.ts`.
 */
export interface HeaderCarrier {
  req: { header: (name: string) => string | undefined };
}

/** El id que el panel eligió, o `null` si no eligió ninguno. */
export function panelOperationId(c: HeaderCarrier): string | null {
  const raw = c.req.header(OPERATION_HEADER);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/**
 * La operación sobre la que el panel está trabajando. Lanza igual que lanzaba
 * el puente: con cero activas, y con dos o más cuando el panel no dijo cuál.
 */
export function panelOperation(c: HeaderCarrier): Promise<Operation> {
  return requirePanelOperation(panelOperationId(c));
}
