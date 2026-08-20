/**
 * **La regla con la que se mide el rendimiento del panel.**
 *
 * No es un comando: es el instrumento que usan los dos comandos que sí lo son —
 * `viajes-del-panel.ts`, que mide un render contra la base que se le indique, y
 * `ensayo-bandeja-a-escala.ts`, que mide la bandeja de ventas encendida contra
 * una base de ensayo a tres escalas. Vive aparte porque **medir dos cosas con
 * dos reglas distintas es no medirlas**: si cada comando reprodujera por su
 * cuenta la secuencia del Inbox, la primera vez que alguien toque `queries.ts`
 * las dos empezarían a contar cosas distintas sin que nada falle.
 *
 * Lo que aporta, y que la traza cruda de `@wa/db` no da:
 *
 * - **La secuencia real del marco y de la pantalla**, llamando a las funciones
 *   que corren de verdad (`listConversations`, `listApprovedWaTemplates`,
 *   `countSalesInboxViews`, `getSalesAgentSettings`) y respetando qué va en
 *   paralelo, que es lo que decide cuántas conexiones se abren.
 * - **Las cuentas que se leen**: consultas, idas y vueltas de red, cadena
 *   secuencial, filas leídas, filas escritas.
 * - **La ida y vuelta hasta la base medida desde acá**, sin la cual dos
 *   mediciones tomadas en sitios distintos no se pueden comparar.
 *
 * Las trampas que este archivo ya tiene resueltas, para no volver a pagarlas:
 *
 * 1. `resolvePanelOperation()` y `resolvePanelOperationState()` llaman a
 *    `cookies()` de Next y revientan fuera de un request. Acá la operación se
 *    resuelve leyendo `operations` directo y se pasa por parámetro.
 * 2. Los tiempos entre consultas no son duraciones de consultas: `postgres-js`
 *    abre una conexión por consulta concurrente y cada una paga TCP más TLS.
 * 3. Una consulta con parámetros cuesta **dos** idas y vueltas, no una. Ver
 *    {@link idasYVueltasDe}.
 * 4. El total de consultas no es lo que la latencia multiplica; eso es la
 *    cadena secuencial. Ver {@link cadenaSecuencial}.
 */

import {
  dropiConnection,
  eq,
  getSalesAgentSettings,
  getRawClient,
  kapsoConnection,
  listOperations,
  salesAgentIsConfigured,
  type Operation,
  type SalesAgentSettings,
  type TrazaSql,
  type ViajeSql,
} from "@wa/db";
import { db } from "../apps/web/src/lib/db";
import {
  countSalesInboxViews,
  listApprovedWaTemplates,
  listConversations,
  type BandejaPedida,
} from "../apps/web/src/lib/queries";

// ────────────────────────────────────────────────────────────────────────────
// Dónde estamos midiendo
// ────────────────────────────────────────────────────────────────────────────

/** Hosts que son producción. Contra estos, medir no puede escribir una fila. */
export const PRODUCCION = ["rlwy.net", "railway.app"];

export function hostDe(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return "<DATABASE_URL inválida>";
  }
}

export const esProduccion = (host: string): boolean =>
  PRODUCCION.some((p) => host.includes(p));

// ────────────────────────────────────────────────────────────────────────────
// Números que se leen
// ────────────────────────────────────────────────────────────────────────────

export const ms = (n: number | null): string =>
  n === null
    ? "—"
    : n.toLocaleString("es", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });

export const entero = (n: number | null): string =>
  n === null ? "—" : n.toLocaleString("es");

export const pct = (parte: number, total: number): string =>
  total === 0 ? "—" : `${((parte / total) * 100).toFixed(1)} %`;

/**
 * La consulta en una línea, lo bastante para reconocerla en la lista.
 * El texto completo sale con `SQL=si`; acá interesa cuál es, no qué dice.
 */
export function resumirSql(texto: string): string {
  const plano = texto.replace(/\s+/g, " ").trim();
  if (/pg_catalog\.pg_type/.test(plano)) return "introspección de tipos (driver)";
  const verbo = /^(select|insert|update|delete|with)/i.exec(plano)?.[1] ?? "?";

  // **Las subconsultas se sacan antes de buscar la tabla.** El `select` grande
  // del Inbox trae un `select … from messages` dentro de su lista de columnas,
  // y sin esto la fila decía «select messages» sobre la consulta que lista
  // conversaciones — el nombre equivocado en la línea que más se mira.
  let raso = plano;
  for (let i = 0; i < 12 && /\([^()]*\)/.test(raso); i++) {
    raso = raso.replace(/\([^()]*\)/g, " ⟨⟩ ");
  }

  const tablas = [
    ...raso.matchAll(/\b(?:from|join|into|update)\s+"?([a-z_]+)"?/gi),
  ]
    .map((m) => m[1])
    .filter((t): t is string => t !== undefined && t !== "pg_catalog");
  const principal = tablas[0] ?? "?";
  const resto = new Set(tablas.slice(1)).size;
  const agregados = /\bcount\(|\bmax\(|\bgroup by\b/i.test(plano) ? " ⧉" : "";
  return `${verbo.toLowerCase()} ${principal}${resto > 0 ? ` +${resto} join` : ""}${agregados}`;
}

export const DETALLE = process.env.DETALLE ?? "si";
export const MOSTRAR_SQL = process.env.SQL === "si";

export function tablaDeViajes(traza: TrazaSql): void {
  const vistas = new Set<number>();
  console.log(
    "     #   ms        filas  cnx  consulta",
  );
  for (const v of traza.viajes) {
    const nueva = !vistas.has(v.conexion);
    vistas.add(v.conexion);
    const marca = v.origen === "driver" ? "·" : " ";
    console.log(
      `    ${String(v.n).padStart(2)}${marca} ` +
        `${ms(v.ms).padStart(8)}  ${entero(v.filas).padStart(6)}  ` +
        `${String(v.conexion).padStart(2)}${nueva ? "*" : " "}  ${resumirSql(v.sql)}`,
    );
    if (MOSTRAR_SQL) {
      console.log(`        ${v.sql.replace(/\s+/g, " ").trim().slice(0, 300)}`);
    }
  }
  console.log(
    "    (· = consulta del driver, no de la aplicación · * = conexión recién abierta)",
  );
}

/** Lo que un bloque medido dejó, resumido en una línea de cuentas. */
export interface Cuentas {
  viajes: number;
  delDriver: number;
  ms: number;
  filasLeidas: number;
  filasEscritas: number;
  escrituras: ViajeSql[];
  /** Suma de los tiempos de cada consulta. Mayor que `ms`: van en paralelo. */
  msSumados: number;
  /** Idas y vueltas de red: las con parámetros valen dos. Ver {@link idasYVueltasDe}. */
  idasYVueltas: number;
  /** Consultas encadenadas, sin solaparse. Ver {@link cadenaSecuencial}. */
  rondas: number;
  /** Las idas y vueltas de esa cadena. Es el piso de latencia del bloque. */
  rondasDeRed: number;
}

const ESCRIBEN = new Set(["INSERT", "UPDATE", "DELETE"]);

/**
 * **Cuántas idas y vueltas de red paga una consulta.**
 *
 * Una, si no lleva parámetros. **Dos, si lleva alguno** — y da igual si lleva
 * uno o veinte. Sale de `prepare: false` en `packages/db/src/client.ts`: sin
 * sentencia preparada, `postgres-js` marca `describeFirst` para toda consulta
 * con parámetros (`connection.js`: `q.describeFirst = q.onlyDescribe ||
 * (parameters.length && !q.prepared)`), manda `Describe` con `Flush`, **espera
 * la respuesta**, y recién entonces manda `Bind`/`Execute`. Son dos vueltas
 * enteras a la base por consulta.
 *
 * Medido contra producción el 20-ago-2026: `select 1` da 120,8 ms de mediana y
 * `select $1::int` da 240,8 ms — el doble exacto, y lo mismo con dos parámetros.
 *
 * Por eso el conteo de consultas no es el conteo de idas y vueltas, y por eso
 * este script imprime los dos.
 */
export function idasYVueltasDe(viaje: ViajeSql): number {
  return viaje.parametros > 0 ? 2 : 1;
}

/**
 * **La cadena de consultas que van una detrás de otra.** Es lo que la distancia
 * multiplica, y no es el total de viajes: la mayoría salen en paralelo y sus
 * latencias se solapan.
 *
 * Confundir los dos lleva a una cuenta que no cierra —13 viajes × 119 ms da más
 * que el render entero—, y de ahí a la conclusión falsa de que el tiempo no es
 * la red. Los dos números dicen cosas distintas y las dos importan: **los
 * viajes son la carga** que se le pone a la base, **la cadena es el tiempo**
 * que espera quien mira la pantalla.
 *
 * Se mide sobre la traza y no sobre el código: la cadena más larga de consultas
 * que no se solapan entre sí, que es la selección de actividades de siempre —
 * ordenar por fin y tomar la primera que empiece después de la anterior.
 */
export function cadenaSecuencial(viajes: readonly ViajeSql[]): ViajeSql[] {
  const tramos = [...viajes]
    .filter((v) => v.ms !== null)
    .sort((a, b) => a.enviadoA + (a.ms ?? 0) - (b.enviadoA + (b.ms ?? 0)));
  const cadena: ViajeSql[] = [];
  let libre = -Infinity;
  for (const v of tramos) {
    if (v.enviadoA >= libre) {
      cadena.push(v);
      libre = v.enviadoA + (v.ms ?? 0);
    }
  }
  return cadena;
}

export function contar(traza: TrazaSql): Cuentas {
  const c: Cuentas = {
    viajes: traza.viajes.length,
    delDriver: 0,
    ms: traza.ms,
    filasLeidas: 0,
    filasEscritas: 0,
    escrituras: [],
    msSumados: 0,
    idasYVueltas: 0,
    rondas: 0,
    rondasDeRed: 0,
  };
  const cadena = cadenaSecuencial(traza.viajes);
  c.rondas = cadena.length;
  c.rondasDeRed = cadena.reduce((a, v) => a + idasYVueltasDe(v), 0);
  for (const v of traza.viajes) {
    if (v.origen === "driver") c.delDriver += 1;
    c.msSumados += v.ms ?? 0;
    c.idasYVueltas += idasYVueltasDe(v);
    if (v.comando && ESCRIBEN.has(v.comando)) {
      c.filasEscritas += v.filas ?? 0;
      c.escrituras.push(v);
    } else {
      c.filasLeidas += v.filas ?? 0;
    }
  }
  return c;
}

export function linea(nombre: string, c: Cuentas): void {
  console.log(
    `  ${nombre.padEnd(36)} ${String(c.viajes).padStart(3)} consultas  ` +
      `${String(c.idasYVueltas).padStart(3)} idas y vueltas  ` +
      `cadena ${String(c.rondas).padStart(2)}/${String(c.rondasDeRed).padStart(2)}  ` +
      `${ms(c.ms).padStart(9)} ms  ` +
      `${entero(c.filasLeidas).padStart(7)} filas` +
      (c.filasEscritas > 0
        ? `  ·  ${entero(c.filasEscritas)} ESCRITAS ⚠`
        : ""),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// La secuencia real del panel
// ────────────────────────────────────────────────────────────────────────────

/**
 * El marco (`app/(app)/layout.tsx`), sin las cookies.
 *
 * **La trampa que costó un turno la vez anterior:** `resolvePanelOperationState()`
 * llama a `cookies()` de Next y revienta fuera de un request. Lo que esa función
 * hace contra la base es `listOperations()`, y eso sí se puede llamar; la cookie
 * solo decide cuál de las filas gana, y acá la operación ya viene resuelta.
 *
 * `auth()` y `resolvePanelBars()` no aparecen porque no van a la base: la sesión
 * es JWT (`auth.ts`, `strategy: "jwt"`) y el plegado es una cookie.
 */
export async function marco(op: Operation, vendedor: SalesAgentSettings | null) {
  // El estado del riel: la tabla de operaciones entera. Cacheada 30 s en
  // `@wa/db`, así que a partir de la segunda pasada este viaje no ocurre — y
  // eso también es un dato del render, no un defecto de la medición.
  await listOperations();

  const conexiones = await db
    .select({
      operationId: kapsoConnection.operationId,
      phone: kapsoConnection.displayPhoneNumber,
    })
    .from(kapsoConnection);

  // El vendedor de la operación activa, y solo con vendedor los contadores.
  const seller = await getSalesAgentSettings(op);
  const counts = salesAgentIsConfigured(seller)
    ? await countSalesInboxViews(op, seller)
    : null;

  return { conexiones: conexiones.length, counts, vendedor };
}

/**
 * La pantalla (`app/(app)/inbox/page.tsx`).
 *
 * Las tres de abajo van en el mismo `Promise.all` que la pantalla real: es lo
 * que decide cuántas conexiones se abren a la vez, y por lo tanto cuántos
 * handshakes paga la primera pasada.
 */
export async function pantalla(
  op: Operation,
  bandeja: BandejaPedida | undefined,
  buscar: string | undefined,
) {
  await getSalesAgentSettings(op);

  const [items, [conn], approvedTemplates] = await Promise.all([
    listConversations(op, { search: buscar, bandeja }),
    db
      .select({ assetsBaseUrl: dropiConnection.assetsBaseUrl })
      .from(dropiConnection)
      .where(eq(dropiConnection.operationId, op.id))
      .limit(1),
    listApprovedWaTemplates(op),
  ]);

  return { filas: items.length, conn: conn ?? null, plantillas: approvedTemplates.length };
}

// ────────────────────────────────────────────────────────────────────────────
// La ida y vuelta hasta la base, medida desde acá
// ────────────────────────────────────────────────────────────────────────────

/**
 * Cuánto cuesta un viaje vacío. Es el multiplicador: sin este número, dos
 * mediciones tomadas desde sitios distintos no se pueden comparar.
 *
 * Se toma sobre conexión caliente y con la consulta más barata que existe, así
 * que lo que queda es la red. La mediana y no el promedio: un pico de red
 * arrastra el promedio y no dice nada de las otras nueve.
 */
export async function idaYVuelta(
  veces = 9,
): Promise<{ mediana: number; minimo: number; conParametros: number }> {
  const cliente = getRawClient();
  const tomar = async (consulta: string, args: number[]): Promise<number[]> => {
    const tomas: number[] = [];
    for (let i = 0; i < veces; i++) {
      const t = performance.now();
      await cliente.unsafe(consulta, args);
      tomas.push(performance.now() - t);
    }
    return tomas.sort((a, b) => a - b);
  };
  const simples = await tomar("select 1", []);
  // La misma consulta con un parámetro: sirve para comprobar en el sitio, y no
  // de memoria, que `prepare: false` la cobra al doble. Ver `idasYVueltasDe`.
  const conParams = await tomar("select $1::int", [1]);
  return {
    mediana: simples[Math.floor(simples.length / 2)] ?? 0,
    minimo: simples[0] ?? 0,
    conParametros: conParams[Math.floor(conParams.length / 2)] ?? 0,
  };
}

/**
 * **Cuánto de todo eso es Postgres pensando.**
 *
 * Es la pregunta que el diagnóstico contestó con «menos del 1%» y la que
 * decide si el problema es la base o la distancia — y por lo tanto cuál de los
 * arreglos posibles sirve. Sin este número, «el panel está lento» lleva
 * derecho a optimizar consultas que ya tardan tres milisegundos.
 *
 * Se le pide `EXPLAIN (ANALYZE)` **a la consulta que corrió, con sus
 * parámetros**, que es lo que la traza guarda. Copiar la consulta a mano y
 * ponerle valores inventados mide otra consulta: la que trae 200 filas y la que
 * trae 3 tienen el mismo texto.
 *
 * **Solo `SELECT`.** `EXPLAIN ANALYZE` ejecuta lo que analiza, así que sobre un
 * `UPDATE` escribiría — y esto tiene que poder correrse contra producción.
 */
export async function tiempoEnPostgres(
  traza: TrazaSql,
): Promise<{ porConsulta: Array<{ n: number; ms: number }>; total: number }> {
  const cliente = getRawClient();
  const porConsulta: Array<{ n: number; ms: number }> = [];
  for (const v of traza.viajes) {
    if (v.origen === "driver") continue;
    if (!/^\s*select/i.test(v.sql)) continue;
    const filas = (await cliente.unsafe(
      `explain (analyze, timing, format json) ${v.sql}`,
      v.valores as never[],
    )) as unknown as Array<Record<string, unknown>>;
    const plan = Object.values(filas[0] ?? {})[0] as
      | Array<{ "Execution Time"?: number }>
      | undefined;
    const ms = plan?.[0]?.["Execution Time"] ?? 0;
    porConsulta.push({ n: v.n, ms });
  }
  return {
    porConsulta,
    total: porConsulta.reduce((a, x) => a + x.ms, 0),
  };
}
