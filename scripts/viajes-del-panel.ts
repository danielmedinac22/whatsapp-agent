/**
 * **Cuántos viajes a la base hace un render del panel, y cuánto tarda cada uno.**
 *
 * Es la regla con la que se mide el rendimiento del panel. Existe porque el
 * 20-ago-2026 se midió una vez —diez viajes, dos segundos, menos del 1% de eso
 * Postgres pensando— con instrumentación temporal que después se revirtió, y
 * porque tres tickets posteriores van a querer comparar contra ese número. Un
 * número que hay que volver a montar para releer no es una regla, es un
 * recuerdo.
 *
 * Reproduce la secuencia real del marco y de la pantalla del Inbox llamando a
 * **las funciones que corren de verdad** (`listConversations`,
 * `listApprovedWaTemplates`, `countSalesInboxViews`, `getSalesAgentSettings`).
 * No reimplementa sus consultas: lo que se mide es el código que corre, no una
 * imitación que se desincroniza en cuanto alguien toque `queries.ts`.
 *
 * ## Cómo se lee lo que imprime
 *
 * **El conteo de viajes no depende de dónde se mida; el tiempo sí.** Los dos
 * segundos del diagnóstico se tomaron desde una máquina en Colombia con 117 ms
 * de ida y vuelta contra el proxy público de Railway; desde Vercel `iad1` el
 * mismo render da otro número, y desde la red privada de Railway da otro. Por
 * eso lo primero que imprime es la ida y vuelta medida **ahora, desde acá**, y
 * por eso el resumen parte el tiempo en dos: lo que es distancia (viajes × ida
 * y vuelta) y lo que es todo lo demás. Comparar dos mediciones tomadas desde
 * sitios distintos por su total es comparar dos latencias, no dos códigos.
 *
 * **La primera pasada no se compara con la segunda.** `postgres-js` abre una
 * conexión nueva por consulta concurrente (hasta `max: 10`) y cada una paga TCP
 * más TLS; encima, con `prepare: false` cada conexión recién abierta gasta un
 * viaje extra en preguntarle a `pg_catalog.pg_type` por los tipos de arreglo.
 * Esa diferencia —unos 900 ms en el diagnóstico— es handshake, no consultas. La
 * pasada 1 dice cuánto cuesta abrir el panel con el proceso frío; las
 * siguientes, cuánto cuesta un render más.
 *
 * ## Uso
 *
 *     # Contra producción (solo lee, y se niega a derivar bandeja):
 *     WA_SQL_TRACE=1 npx tsx scripts/viajes-del-panel.ts
 *
 *     # Contra la base que se le indique:
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55981/wa" \
 *       WA_SQL_TRACE=1 npx tsx scripts/viajes-del-panel.ts
 *
 * Perillas, todas por entorno:
 *
 * | | |
 * | -- | -- |
 * | `PASADAS=3` | cuántos renders. La 1 es fría, las demás calientes. |
 * | `BANDEJA=ventas` \| `operaciones` | qué bandeja pide la URL (`?b=`). Solo hace algo con vendedor configurado. |
 * | `BUSCAR=texto` | render con el buscador puesto. |
 * | `OPERACION=GT` | por código de país, si hay más de una. |
 * | `DETALLE=no` \| `si` \| `todo` | la tabla consulta por consulta. `si` es el default. |
 * | `SQL=si` | además, el texto completo de cada consulta. |
 *
 * **`WA_SQL_TRACE=1` tiene que estar antes de la primera consulta**, porque el
 * cliente de la base se arma una sola vez y la traza se le cuelga al armarlo.
 * Sin esa variable la aplicación no tiene instrumentación de ninguna clase: es
 * el interruptor de `packages/db/src/sql-trace.ts`, y está apagado a propósito.
 */
import {
  conversations,
  ensureWorkspaceEnv,
  eq,
  getSalesAgentSettings,
  getRawClient,
  invalidateOperationsCache,
  listOperations,
  medirViajes,
  salesAgentIsConfigured,
  sql,
  sqlTraceEnabled,
} from "@wa/db";
import { db } from "../apps/web/src/lib/db";
import {
  countSalesInboxViews,
  listApprovedWaTemplates,
  listConversations,
  type BandejaPedida,
} from "../apps/web/src/lib/queries";
import {
  contar,
  DETALLE,
  entero,
  esProduccion,
  hostDe,
  idaYVuelta,
  linea,
  marco,
  ms,
  pantalla,
  pct,
  tablaDeViajes,
  tiempoEnPostgres,
  type Cuentas,
} from "./regla-de-medir";

// ────────────────────────────────────────────────────────────────────────────

async function main() {
  if (!sqlTraceEnabled()) {
    console.error(
      "\n  Falta WA_SQL_TRACE=1. La traza de consultas está apagada en la aplicación\n" +
        "  a propósito, y este script no la puede encender por su cuenta: el cliente\n" +
        "  de la base se arma una sola vez, al primer uso.\n\n" +
        "      WA_SQL_TRACE=1 npx tsx scripts/viajes-del-panel.ts\n",
    );
    process.exit(1);
  }

  // La URL puede venir del entorno o del `.env` del repo, igual que en la
  // aplicación: `getDb()` la carga sola, pero acá hace falta antes para saber
  // contra qué base se está midiendo.
  ensureWorkspaceEnv();
  const efectiva = process.env.DATABASE_URL;
  if (!efectiva) throw new Error("DATABASE_URL requerido");
  const host = hostDe(efectiva);
  const prod = esProduccion(host);

  const pasadas = Number(process.env.PASADAS ?? 3);
  const buscar = process.env.BUSCAR?.trim() || undefined;
  const pedida = process.env.BANDEJA?.trim();
  if (pedida && pedida !== "ventas" && pedida !== "operaciones") {
    throw new Error(`BANDEJA=${pedida}: solo "ventas" u "operaciones"`);
  }

  // La operación, leyendo la tabla directo. `resolvePanelOperation()` no sirve
  // acá: llama a `cookies()` de Next y revienta fuera de un request.
  const todas = await listOperations();
  const codigo = process.env.OPERACION?.trim();
  const activas = todas.filter((o) => o.status === "active");
  const op = codigo
    ? todas.find((o) => o.countryCode === codigo)
    : activas.length === 1
      ? activas[0]
      : undefined;
  if (!op) {
    throw new Error(
      codigo
        ? `no hay operación con código ${codigo} (hay: ${todas.map((o) => o.countryCode).join(", ")})`
        : `hay ${activas.length} operaciones activas: elegí una con OPERACION=<código>`,
    );
  }

  const vendedor = await getSalesAgentSettings(op);
  const hayVendedor = salesAgentIsConfigured(vendedor);
  // El mismo `bandejaPedida` de la pantalla: sin vendedor no hay dos bandejas,
  // y el parámetro de la URL no cambia eso.
  const bandeja: BandejaPedida | undefined = hayVendedor
    ? {
        inbox: pedida === "ventas" ? "ventas" : "operaciones",
        activatedAt: vendedor.activatedAt,
      }
    : undefined;

  // **Contra producción, medir no escribe.** Con bandeja, `conversationIdsOfInbox`
  // suelta asignaciones viejas con un UPDATE sobre `conversations`, y
  // `getSalesAgentSettings` estampa `activated_at` si falta. Las dos son
  // legítimas en la aplicación y ninguna es aceptable dentro de una medición
  // contra la base de verdad.
  if (prod && bandeja !== undefined) {
    console.error(
      `\n  ${host} es producción y esta operación tiene vendedor configurado.\n` +
        "  Derivar la bandeja escribe (`releaseStaleAssignments`), así que acá no se mide.\n" +
        "  La bandeja encendida se mide contra la base de ensayo: ver\n" +
        "  scripts/ensayo-bandeja-a-escala.ts\n",
    );
    process.exit(1);
  }

  // La escala de la operación, contada por SQL: acá se mide, no se carga.
  const [escala] = await db
    .select({ conversaciones: sql<number>`count(*)::int` })
    .from(conversations)
    .where(eq(conversations.operationId, op.id));
  const conversaciones = escala?.conversaciones ?? 0;

  const rtt = await idaYVuelta();

  console.log("");
  console.log("  ╭─ Los viajes del panel · render del Inbox");
  console.log(`  │  base       ${host}${prod ? "   ⚠ PRODUCCIÓN (solo lectura)" : ""}`);
  console.log(
    `  │  ida y vuelta  ${ms(rtt.mediana)} ms sin parámetros  ·  ${ms(rtt.conParametros)} ms con parámetros ` +
      `(medianas de 9)`,
  );
  console.log(`  │  operación  ${op.name} (${op.countryCode}) · ${entero(conversaciones)} conversaciones`);
  console.log(
    `  │  vendedor   ${hayVendedor ? `configurado — ${vendedor?.displayName}` : "sin configurar → la bandeja de ventas no corre"}`,
  );
  console.log(
    `  │  bandeja    ${bandeja ? bandeja.inbox : "ninguna (una sola bandeja)"}` +
      (buscar ? `  ·  buscando "${buscar}"` : ""),
  );
  console.log("  ╰─");
  console.log("");

  const cuentasPorPasada: Cuentas[] = [];

  for (let p = 1; p <= pasadas; p++) {
    const frio = p === 1;
    // **La pasada fría es un proceso frío, no solo conexiones frías.** La lista
    // de operaciones se cachea 30 s en `@wa/db`, así que el render la lee una
    // vez cada medio minuto y no una vez por pantalla; sin vaciarla acá, el
    // viaje que sí paga el primer render de una función recién levantada no
    // aparecería en ninguna pasada.
    if (frio) invalidateOperationsCache();
    const { traza } = await medirViajes(`render ${p}`, async () => {
      // El marco y la pantalla se renderizan a la vez: en el App Router el
      // layout recibe `children` ya construido y los dos componentes async
      // suspenden en paralelo. Medirlos en fila india inventaría un tiempo que
      // nadie paga.
      return Promise.all([
        marco(op, vendedor),
        pantalla(op, bandeja, buscar),
      ]);
    });
    const c = contar(traza);
    cuentasPorPasada.push(c);

    console.log(
      `  Pasada ${p} · conexiones ${frio ? "FRÍAS (abre TCP + TLS)" : "calientes"}`,
    );
    if (DETALLE === "si" || DETALLE === "todo") tablaDeViajes(traza);
    console.log(
      `    ── ${c.viajes} consultas (${c.delDriver} del driver) = ${c.idasYVueltas} idas y vueltas · ` +
        `cadena de ${c.rondas} (${c.rondasDeRed} idas y vueltas) · ` +
        `${ms(c.ms)} ms · ${entero(c.filasLeidas)} filas leídas` +
        (c.filasEscritas > 0 ? ` · ${entero(c.filasEscritas)} ESCRITAS ⚠` : ""),
    );
    console.log("");
  }

  // ── Desglose, ya con las conexiones calientes ────────────────────────────
  console.log("  Desglose (conexiones calientes)");
  const desglose: Array<[string, Cuentas]> = [];

  const soloMarco = await medirViajes("marco", () => marco(op, vendedor));
  desglose.push(["marco · layout del panel", contar(soloMarco.traza)]);

  const soloPantalla = await medirViajes("pantalla", () =>
    pantalla(op, bandeja, buscar),
  );
  desglose.push(["pantalla · page /inbox", contar(soloPantalla.traza)]);

  const soloLista = await medirViajes("listConversations", () =>
    listConversations(op, { search: buscar, bandeja }),
  );
  desglose.push(["listConversations()", contar(soloLista.traza)]);

  const soloPlantillas = await medirViajes("listApprovedWaTemplates", () =>
    listApprovedWaTemplates(op),
  );
  desglose.push(["listApprovedWaTemplates()", contar(soloPlantillas.traza)]);

  if (hayVendedor && vendedor) {
    const soloContador = await medirViajes("countSalesInboxViews", () =>
      countSalesInboxViews(op, vendedor),
    );
    desglose.push([
      "countSalesInboxViews() · barra lateral",
      contar(soloContador.traza),
    ]);
    if (DETALLE === "todo") tablaDeViajes(soloContador.traza);
  }

  for (const [nombre, c] of desglose) linea(nombre, c);
  console.log("");

  // ── Cuánto de esto es la base pensando ───────────────────────────────────
  // Se le pide el plan a las consultas de un render caliente, con sus
  // parámetros reales. Es lo que separa «el panel está lento» de «las consultas
  // están lentas», que son dos problemas con dos arreglos distintos.
  const { traza: paraPlanes } = await medirViajes("para los planes", () =>
    Promise.all([marco(op, vendedor), pantalla(op, bandeja, buscar)]),
  );
  const enBase = await tiempoEnPostgres(paraPlanes);

  // ── Resumen ──────────────────────────────────────────────────────────────
  const fria = cuentasPorPasada[0];
  const calientes = cuentasPorPasada.slice(1);
  const promedioCaliente =
    calientes.length > 0
      ? calientes.reduce((a, c) => a + c.ms, 0) / calientes.length
      : null;
  // La mediana y no la primera caliente: una pasada puede pescar una conexión
  // recién abierta y su viaje de introspección, y ese +1 no es del render.
  const medianaDe = (f: (c: Cuentas) => number): number => {
    const xs = calientes.map(f).sort((a, b) => a - b);
    return xs[Math.floor(xs.length / 2)] ?? (fria ? f(fria) : 0);
  };
  const viajesCaliente = medianaDe((c) => c.viajes);
  const idasCaliente = medianaDe((c) => c.idasYVueltas);
  const rondasCaliente = medianaDe((c) => c.rondas);
  const redCaliente = medianaDe((c) => c.rondasDeRed);

  console.log("  ╭─ Resumen");
  console.log(
    `  │  consultas por render  ${viajesCaliente}  ← la carga sobre la base. NO cambia con la distancia.`,
  );
  console.log(
    `  │  idas y vueltas        ${idasCaliente}  ← las ${idasCaliente - viajesCaliente} de más son \`prepare: false\`: toda consulta`,
  );
  console.log(
    "  │                            con parámetros paga un Describe antes del Execute.",
  );
  console.log(
    `  │  cadena secuencial     ${rondasCaliente} consultas = ${redCaliente} idas y vueltas  ← esto es lo que la latencia multiplica.`,
  );
  if (fria) {
    console.log(
      `  │  proceso frío          ${ms(fria.ms)} ms · ${fria.viajes} consultas ` +
        `(${fria.delDriver} de introspección: una por conexión nueva)`,
    );
  }
  if (promedioCaliente !== null) {
    console.log(
      `  │  proceso caliente      ${ms(promedioCaliente)} ms  (promedio de ${calientes.length})`,
    );
    // El piso: aunque Postgres respondiera al instante, la pantalla no puede
    // salir antes de que las rondas encadenadas hayan ido y vuelto.
    const piso = redCaliente * rtt.mediana;
    console.log(
      `  │     piso por distancia ${ms(piso)} ms  = ${redCaliente} idas y vueltas × ${ms(rtt.mediana)} ms ` +
        `(${pct(piso, promedioCaliente)} del render)`,
    );
    console.log(
      `  │     lo demás           ${ms(promedioCaliente - piso)} ms  ` +
        "(traer las filas por el cable, derivar en memoria, y…)",
    );
    console.log(
      `  │     …ejecutando SQL    ${ms(enBase.total)} ms  ` +
        `= ${pct(enBase.total, promedioCaliente)} del render  ` +
        `(EXPLAIN ANALYZE de las ${enBase.porConsulta.length} consultas)`,
    );
    if (fria) {
      console.log(
        `  │     primera vez        +${ms(fria.ms - promedioCaliente)} ms  TCP, TLS e introspección de tipos`,
      );
    }
  }
  const escrituras = cuentasPorPasada.reduce((a, c) => a + c.filasEscritas, 0);
  console.log(
    `  │  filas leídas          ${entero(calientes[0]?.filasLeidas ?? fria?.filasLeidas ?? 0)} por render`,
  );
  console.log(
    `  │  filas escritas        ${escrituras === 0 ? "0 — leer no escribe" : `${entero(escrituras)} en ${pasadas} renders ⚠`}`,
  );
  console.log("  ╰─");
  console.log("");
  console.log(
    "  Medido desde esta máquina. Otro sitio da otro tiempo y los mismos viajes:\n" +
      `  el multiplicador de esta medición es ${ms(rtt.mediana)} ms de ida y vuelta.`,
  );
  console.log("");

  await getRawClient().end({ timeout: 5 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
