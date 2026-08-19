/**
 * Sirve **una sola ruta** del worker —`GET /api/capi/estado`— contra una base
 * de ensayo, para poder mirar la pantalla de `/reporte-meta` con datos.
 *
 * ## Por qué esto y no arrancar el worker
 *
 * La pantalla del reporte no lee la base: le pregunta al worker, que es quien
 * tiene las credenciales y quien decide qué se reporta. Así que para verla
 * llena hace falta un worker… y **arrancar el worker de verdad es exactamente
 * lo que esta ola tiene prohibido**: no hay allowlist ni modo observador, y el
 * proceso completo levanta las colas, el seguimiento y el envío de WhatsApp.
 *
 * Esto monta la ruta del tablero y nada más. No arranca pg-boss, no atiende
 * webhooks, no manda un mensaje ni le habla a Meta: la ruta es de sólo lectura
 * —cuenta filas del libro y vuelve a correr el barrido, que también solo lee— y
 * es lo único que se expone.
 *
 * Se niega a correr contra la base de producción por la misma razón que los
 * sembradores: aunque solo lea, el `WORKER_API_TOKEN` que necesita es el de
 * verdad, y un servidor de ensayo escuchando con la credencial buena es una
 * puerta que nadie decidió abrir.
 *
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55998/wa" \
 *       WORKER_API_TOKEN=ensayo npx tsx scripts/estado-capi-ensayo.ts
 *
 * Y en otra terminal, el panel apuntado acá:
 *
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55998/wa" \
 *       WORKER_URL=http://127.0.0.1:3099 WORKER_API_TOKEN=ensayo \
 *       pnpm --filter @wa/web dev
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { auth } from "../apps/worker/src/middleware/auth";
import { capiReporting } from "../apps/worker/src/capi/reporting-routes";

/** Hosts que son producción. Contra estos no se levanta nada, nunca. */
const PROHIBIDOS = ["rlwy.net", "railway.app"];

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<DATABASE_URL inválida>";
  }
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL requerido");
const host = hostDe(url);

if (PROHIBIDOS.some((p) => host.includes(p))) {
  console.error(
    `\n  ${host} es producción. Este servidor de ensayo no se levanta ahí.\n` +
      `  Para mirar el estado real hay uno desplegado, y se consulta con curl.\n`,
  );
  process.exit(1);
}
if (!process.env.WORKER_API_TOKEN) {
  console.error("\n  Falta WORKER_API_TOKEN: poné cualquier cosa, es de ensayo.\n");
  process.exit(1);
}

const app = new Hono();
app.use("/api/*", auth());
app.route("/api/capi", capiReporting);

const port = Number(process.env.PORT ?? 3099);
serve({ fetch: app.fetch, port }, () => {
  console.log(`\n  Estado del reporte de ensayo en http://127.0.0.1:${port}`);
  console.log(`  base: ${host} · única ruta: GET /api/capi/estado\n`);
});
