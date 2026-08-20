/**
 * **El plan de ejecución de cada consulta del Inbox que toca `conversations`,
 * antes y después de poner un índice.**
 *
 * `scripts/ensayo-bandeja-a-escala.ts` mide el costo del render y le saca el
 * plan a **una** consulta, la del ticket: el `SELECT` sin `LIMIT` de la
 * derivación. Alcanza para declarar el techo y no alcanza para decidir un
 * índice, porque un índice no se juzga por la consulta que arregla sino por
 * **todas las que cambia** — incluidas las que empeora.
 *
 * Este script saca el plan de las cinco. No las copia a mano: las toma de la
 * traza (`WA_SQL_TRACE=1`) de tres renders reales del Inbox y le pide a
 * Postgres el plan de ese texto exacto, con esos mismos parámetros. Una
 * consulta transcrita se desincroniza en silencio, y lo que se quiere saber es
 * el plan de la que corre.
 *
 * Lo que responde, que son las dos casillas del ticket que no son un diff:
 *
 * 1. Cuáles de las consultas del Inbox escanean `conversations` entera, y
 *    cuáles ordenan la tabla completa por `GREATEST(...)`.
 * 2. Si eso desaparece al poner los índices — y si alguna otra empeoró.
 *
 * ## Cómo se corre
 *
 *     docker run -d --name wa-ensayo-indices -e POSTGRES_PASSWORD=test \
 *       -e POSTGRES_DB=wa -p 55983:5432 postgres:16-alpine
 *
 *     export DATABASE_URL="postgres://postgres:test@127.0.0.1:55983/wa"
 *     pnpm --filter @wa/db migrate
 *     SEMBRAR=si ESCALA=si npx tsx scripts/seed-bandejas-ensayo.ts
 *     WA_SQL_TRACE=1 npx tsx scripts/planes-de-la-bandeja.ts
 *
 * Perilla: `DETALLE=si` imprime el plan entero de cada consulta y no solo su
 * renglón. Para verlo a otra escala, el que hace crecer la tabla es
 * `ensayo-bandeja-a-escala.ts`; este mide sobre la que encuentre.
 *
 * **Se niega a correr contra producción, y no por prudencia genérica.** Con
 * bandeja pedida, `listConversations` suelta las asignaciones que cambiaron de
 * bandeja: es un `UPDATE`. Correr esto contra producción no sería leer un plan,
 * sería escribir en la tabla más caliente del sistema — y además `EXPLAIN
 * ANALYZE` ejecuta de verdad lo que explica.
 */

import {
  conversations,
  ensureWorkspaceEnv,
  eq,
  getDb,
  getRawClient,
  getSalesAgentSettings,
  medirViajes,
  operations,
  salesAgentIsConfigured,
  sql,
  sqlTraceEnabled,
  type Operation,
  type SalesAgentSettings,
  type ViajeSql,
} from "@wa/db";
import {
  listConversations,
  countSalesInboxViews,
  type BandejaPedida,
} from "../apps/web/src/lib/queries";
import { entero, esProduccion, hostDe, ms, resumirSql } from "./regla-de-medir";

ensureWorkspaceEnv();
const host = hostDe(process.env.DATABASE_URL ?? "");

// ────────────────────────────────────────────────────────────────────────────

/** Un plan leído, con lo que de él se juzga. */
interface Plan {
  /** Cómo se le dice a la consulta en el ticket. */
  nombre: string;
  sql: string;
  lineas: string[];
  /** Escaneó `conversations` entera. */
  escaneoCompleto: boolean;
  /** Ordenó por la expresión de actividad en vez de leerla ya ordenada. */
  ordenaLaTabla: boolean;
  /** Los índices que el plan nombra. */
  indices: string[];
  /** Bloques de buffer tocados: el trabajo, sin el ruido del reloj. */
  buffers: number;
  ms: number | null;
}

/**
 * `Seq Scan on conversations` **es** el escaneo completo del ticket. Se busca
 * por el nombre de la tabla y no por «Seq Scan» a secas: el de `contacts` es
 * otro problema, de otro ticket, y contarlo acá haría que este nunca cierre.
 */
function leerPlan(nombre: string, sqlTexto: string, lineas: string[]): Plan {
  const texto = lineas.join("\n");
  return {
    nombre,
    sql: sqlTexto,
    lineas,
    escaneoCompleto: /Seq Scan on conversations\b/i.test(texto),
    ordenaLaTabla: /Sort Key: \(GREATEST/i.test(texto),
    indices: [...texto.matchAll(/using ("?[a-z0-9_]+"?)/gi)]
      .map((m) => (m[1] ?? "").replace(/"/g, ""))
      .filter((v, i, a) => a.indexOf(v) === i),
    buffers: Math.max(
      0,
      ...[...texto.matchAll(/shared hit=(\d+)(?: read=(\d+))?/g)].map(
        (m) => Number(m[1] ?? 0) + Number(m[2] ?? 0),
      ),
    ),
    ms: Number(/Execution Time: ([\d.]+) ms/.exec(texto)?.[1] ?? 0) || null,
  };
}

/**
 * El plan de una consulta de la traza, con sus parámetros de verdad.
 *
 * Los `Date` se pasan como texto ISO: en un `unsafe()` el parámetro viaja sin
 * el tipo de la columna y el driver no sabe serializar un `Date` suelto. Es el
 * mismo cuidado que `puedeEstarEnSQL()` tiene que tener en `queries.ts`.
 */
async function planDe(nombre: string, viaje: ViajeSql): Promise<Plan | null> {
  const valores = viaje.valores.map((v) =>
    v instanceof Date ? v.toISOString() : v,
  );
  try {
    const filas = (await getRawClient().unsafe(
      `explain (analyze, buffers, timing) ${viaje.sql}`,
      valores as never[],
    )) as unknown as Array<Record<string, string>>;
    return leerPlan(nombre, viaje.sql, filas.map((f) => Object.values(f)[0] ?? ""));
  } catch (e) {
    console.error(`     no se pudo explicar «${nombre}»: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Las consultas de un render que leen `conversations`.
 *
 * Se quedan fuera las del driver (`origen: "driver"`, que son los `select` de
 * tipos que postgres.js hace por su cuenta) y las escrituras: de un `UPDATE`
 * también hay plan, pero explicarlo con `analyze` lo ejecutaría dos veces.
 */
function consultasDeConversations(viajes: readonly ViajeSql[]): ViajeSql[] {
  const vistas = new Set<string>();
  return viajes.filter((v) => {
    if (v.origen === "driver") return false;
    if (!/\bfrom "conversations"/i.test(v.sql)) return false;
    if (/^\s*(update|insert|delete)/i.test(v.sql)) return false;
    if (vistas.has(v.sql)) return false;
    vistas.add(v.sql);
    return true;
  });
}

/** Los tres renders, y el contador que se dibuja en las siete pantallas. */
function escenas(op: Operation, vendedor: SalesAgentSettings) {
  const ventas: BandejaPedida = { inbox: "ventas", activatedAt: vendedor.activatedAt };
  const operaciones: BandejaPedida = {
    inbox: "operaciones",
    activatedAt: vendedor.activatedAt,
  };
  return [
    { nombre: "apagada", correr: () => listConversations(op, {}) },
    {
      nombre: "operaciones",
      correr: () => listConversations(op, { bandeja: operaciones }),
    },
    { nombre: "ventas", correr: () => listConversations(op, { bandeja: ventas }) },
    { nombre: "barra lateral", correr: () => countSalesInboxViews(op, vendedor) },
  ];
}

// ────────────────────────────────────────────────────────────────────────────

async function main() {
  if (esProduccion(host)) {
    console.error(
      "\n  Este script no corre contra producción. Con bandeja pedida,\n" +
        "  listConversations() suelta asignaciones: es un UPDATE, y EXPLAIN\n" +
        "  ANALYZE ejecuta de verdad lo que explica. Levantá la base de ensayo.\n",
    );
    process.exit(1);
  }
  if (!sqlTraceEnabled()) {
    console.error(
      "\n  Falta WA_SQL_TRACE=1: sin la traza no hay de dónde sacar el SQL.\n" +
        "  WA_SQL_TRACE=1 npx tsx scripts/planes-de-la-bandeja.ts\n",
    );
    process.exit(1);
  }

  const base = getDb();
  const [op] = (await base.select().from(operations)) as Operation[];
  if (!op) throw new Error("no hay operación: falta correr las migraciones");

  const vendedor = await getSalesAgentSettings(op);
  if (!salesAgentIsConfigured(vendedor)) {
    console.error(
      "\n  Sin vendedor configurado la bandeja de ventas no corre y no hay plan\n" +
        "  que leer. Sembrá primero:\n\n" +
        "      SEMBRAR=si ESCALA=si npx tsx scripts/seed-bandejas-ensayo.ts\n",
    );
    process.exit(1);
  }

  // Sin estadísticas frescas el planificador elige a ciegas, y el plan que se
  // reporta no es el que Postgres elegiría con esta tabla.
  await base.execute(sql`analyze conversations, contacts, shopify_orders, dropi_orders`);
  const [{ n }] = (await base
    .select({ n: sql<number>`count(*)::int` })
    .from(conversations)
    .where(eq(conversations.operationId, op.id))) as [{ n: number }];

  const puestos = (await base.execute(
    sql`select indexname, pg_size_pretty(pg_relation_size(indexname::regclass)) as tam
        from pg_indexes where tablename = 'conversations' order by indexname`,
  )) as unknown as Array<{ indexname: string; tam: string }>;

  console.log("");
  console.log("  ╭─ Los planes del Inbox sobre `conversations`");
  console.log(`  │  base           ${host} (de ensayo)`);
  console.log(`  │  conversaciones ${entero(n)} en la operación`);
  console.log(`  │  índices        ${puestos.length}`);
  for (const i of puestos) console.log(`  │                 ${i.indexname}  ${i.tam}`);
  console.log("  ╰─");

  const planes: Plan[] = [];
  for (const escena of escenas(op, vendedor)) {
    const { traza } = await medirViajes(escena.nombre, escena.correr);
    const consultas = consultasDeConversations(traza.viajes);
    for (const [i, viaje] of consultas.entries()) {
      const nombre = `${escena.nombre} · ${i + 1}`;
      const plan = await planDe(nombre, viaje);
      if (plan) planes.push(plan);
    }
  }

  console.log("");
  console.log(
    "     consulta               escanea  ordena   buffers      ms   índice / SQL",
  );
  for (const p of planes) {
    console.log(
      `     ${p.nombre.padEnd(20)}  ${(p.escaneoCompleto ? "SÍ" : "no").padStart(7)}  ` +
        `${(p.ordenaLaTabla ? "SÍ" : "no").padStart(6)}  ${entero(p.buffers).padStart(8)}  ` +
        `${ms(p.ms).padStart(6)}   ${p.indices.join(", ") || resumirSql(p.sql)}`,
    );
  }

  const escanean = planes.filter((p) => p.escaneoCompleto);
  const ordenan = planes.filter((p) => p.ordenaLaTabla);
  console.log("");
  console.log(
    `     ${escanean.length} de ${planes.length} escanean \`conversations\` entera` +
      (escanean.length > 0 ? `: ${escanean.map((p) => p.nombre).join(", ")}` : ""),
  );
  console.log(
    `     ${ordenan.length} de ${planes.length} ordenan por GREATEST(...) en vez de leerlo ordenado` +
      (ordenan.length > 0 ? `: ${ordenan.map((p) => p.nombre).join(", ")}` : ""),
  );
  console.log(
    `     ${entero(planes.reduce((a, p) => a + p.buffers, 0))} bloques tocados en total`,
  );

  if ((process.env.DETALLE ?? "no") === "si") {
    for (const p of planes) {
      console.log("");
      console.log(`  ── ${p.nombre}`);
      console.log(`     ${resumirSql(p.sql)}`);
      for (const l of p.lineas) console.log(`     ${l}`);
    }
  }

  console.log("");
  await getRawClient().end({ timeout: 5 });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
