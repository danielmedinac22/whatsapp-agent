import { getSalesAgentSettings, panelOperation } from "@wa/db";
import { salesAgentSettingsInput } from "@wa/shared";
import { auth } from "@/auth";
import { saveVendedorSettings } from "@/lib/vendedor";

/**
 * La configuración del vendedor: leerla y guardarla.
 *
 * A diferencia de `/api/agent/settings`, que es un proxy al worker, esta ruta
 * escribe en la base directamente. El motivo es que del otro lado no hay nada
 * más que hacer: la de Katherine pasa por el worker porque ahí se registra la
 * versión de su prompt, y la del vendedor es una fila y nada más. Lo que sí se
 * conserva es la validación **antes** de tocar la base, con el mismo esquema
 * que usa el formulario.
 *
 * **Cuelga de `/api/vendedor` a propósito**: es el prefijo que la tabla de
 * accesos (`src/access/resolve.ts`) puede clasificar de una sola línea como
 * área de ventas, igual que `/api/agent` cubre todo lo de confirmación. Esa
 * línea es del worktree del selector, no de este.
 */

export async function GET() {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  // La pantalla se dibuja con lo que trae el servidor; esto es para quien
  // quiera leer la configuración sin abrirla.
  return Response.json(await panelOperation().then(getSalesAgentSettings));
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = salesAgentSettingsInput.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }

  await saveVendedorSettings(parsed.data);
  return Response.json({ ok: true });
}
