/**
 * Las rutas del vendedor en el worker. Hoy hay una sola: el banco de pruebas.
 *
 * **Cuelga de `/api/vendedor` y no de `/api/agent`**, aunque el banco de
 * Katherine viva allá. El prefijo es lo que la tabla de accesos del panel
 * (`apps/web/src/access/resolve.ts`) clasifica de una línea como área de
 * ventas: mezclarlos haría que alcanzar el banco del vendedor exigiera abrir el
 * módulo de confirmación.
 *
 * La configuración del vendedor **no pasa por acá**: el panel la escribe
 * directo en la base, porque de este lado no habría nada más que hacer. Lo
 * único que necesita el worker es lo que necesita al modelo.
 */

import { Hono } from "hono";
import { vendedorBancoInput } from "@wa/shared";
import { correrBancoDelVendedor } from "../agent/banco-vendedor";
import { logger } from "../lib/logger";
import { panelOperation } from "../operations";

export const vendedor = new Hono();

/**
 * Un turno del banco de pruebas.
 *
 * Devuelve `502` cuando el proveedor falla, igual que el banco de Katherine:
 * es un error del borde y no del cuerpo, y la pantalla tiene que poder decir
 * «no se pudo probar» sin que parezca que la configuración está mal.
 */
vendedor.post("/probar", async (c) => {
  const parsed = vendedorBancoInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);

  const operation = await panelOperation(c);

  try {
    return c.json(await correrBancoDelVendedor(operation, parsed.data));
  } catch (err) {
    logger.error({ err }, "banco del vendedor: falló la corrida");
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
});
