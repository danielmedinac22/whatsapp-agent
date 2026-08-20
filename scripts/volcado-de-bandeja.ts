/**
 * **Todo lo que la bandeja devuelve, en JSON, para poder diffear el antes y el
 * después.**
 *
 * Es el instrumento de PRO-18, y no mide velocidad: mide **identidad**. El
 * riesgo de acotar la derivación antes de derivar no es no mejorar, es mejorar
 * y traer otro conjunto de filas sin que nadie lo note — y eso ninguna
 * medición de milisegundos lo ve. La técnica es la de PRO-16: volcar lo que la
 * función devuelve, entero, en varios escenarios, antes y después, y diffear.
 * Idéntico o no es idéntico; no hay opinión.
 *
 * ## Qué vuelca
 *
 * De cada fila, **todo** lo que `listConversations` construye: la fila de
 * `conversations` y la de `contacts` completas, el fallo del último saliente,
 * el asignado, `sinResponder`, el resumen de logística, el de tienda, el ruteo
 * —bandeja y escaladas— con su preview y sus no leídos adentro. Nada de
 * proyectar «lo importante»: lo que se rompe al cortar antes es justamente lo
 * que uno no pensó en mirar.
 *
 * Y de `countSalesInboxViews`, los tres números de la barra lateral.
 *
 * ## Los escenarios, y por qué son estos
 *
 * Uno por cada motivo por el que una fila entra a la bandeja, más los tres
 * motivos por los que una fila entra a la **lista**:
 *
 * | escenario | qué vigila |
 * | -- | -- |
 * | `apagada` | la no-regresión: sin vendedor la lista es la de siempre |
 * | `ventas-reciente` / `operaciones-reciente` | el día del encendido: `activated_at` es *ahora*, así que a ventas solo llega la regla 1 (el recomprador) |
 * | `ventas-vieja` / `operaciones-vieja` | un año después: las reglas 4 y 5 vivas, y con ellas las **rezagadas** — la conversación vieja que aparece por estar sin responder y que cae fuera de cualquier corte por actividad |
 * | `ventas-buscando` | con buscador la unión de rezagadas no se aplica |
 * | `operaciones-anclada` | la conversación pedida por id, que entra aunque sea de la otra bandeja |
 * | `contador-reciente` / `contador-vieja` | la barra lateral, que comparte forma con la bandeja |
 *
 * ## La trampa que este script tiene resuelta
 *
 * **En la rama vieja, volcar la bandeja escribe** —`releaseStaleAssignments`,
 * que es lo que PRO-20 saca del camino de lectura—, así que la primera corrida
 * cambia la base y la segunda mediría otro mundo. Por eso el script **fotografía las dos columnas
 * de la asignación antes de empezar y las restaura antes de cada escenario**:
 * los dos volcados ven exactamente la misma base.
 *
 * Y `activated_at` se mueve entre escenarios a propósito, porque es la línea de
 * corte: se pone al valor del escenario, se invalida la caché del vendedor —que
 * si no devuelve la fila de antes— y se devuelve al terminar.
 *
 * ## Uso
 *
 *     export DATABASE_URL="postgres://postgres:test@127.0.0.1:55985/wa"
 *     ARCHIVO=/tmp/volcado-antes.json npx tsx scripts/volcado-de-bandeja.ts
 *     # …se cambia el código…
 *     ARCHIVO=/tmp/volcado-despues.json npx tsx scripts/volcado-de-bandeja.ts
 *     diff /tmp/volcado-antes.json /tmp/volcado-despues.json
 *
 * Escribe **dos** archivos: el del `ARCHIVO` pedido, que es lo que devuelven
 * las funciones y lo único que hay que diffear, y uno `.instrumento.json` al
 * lado con lo que el script anotó al medir —cuántas asignaciones quedaron
 * puestas tras cada render, cuántas restauró, cuántas soltó el camino nuevo—.
 * Van separados a propósito: `diff` no distingue una fila que cambió de una
 * nota al margen, y mezclarlas obliga a explicar cuáles de las líneas del diff
 * no cuentan.
 *
 * `LIBERAR=si` corre además la liberación de asignaciones por el camino nuevo
 * (PRO-20) antes de cada escenario. Sirve para comparar los dos mundos en
 * régimen: con la liberación en la lectura, el render suelta y muestra la fila
 * libre en el mismo acto; con la liberación en el evento, ya estaba suelta
 * cuando el render llegó. Sin la perilla, el volcado de la rama nueva muestra
 * la asignación todavía puesta, que es la diferencia que PRO-20 declara.
 *
 * Se niega a correr contra producción: mueve `activated_at` y restaura
 * asignaciones.
 */

import { writeFileSync } from "node:fs";
import {
  conversations,
  ensureWorkspaceEnv,
  eq,
  getDb,
  getRawClient,
  getSalesAgentSettings,
  invalidateSalesAgentSettingsCache,
  operations,
  salesAgentIsConfigured,
  sql,
  type Operation,
} from "@wa/db";
import {
  countSalesInboxViews,
  listConversations,
  type BandejaPedida,
  type ConversationListItem,
} from "../apps/web/src/lib/queries";
import { liberarAsignacionesVencidas } from "../apps/worker/src/inbox/asignacion";
import { esProduccion, hostDe } from "./regla-de-medir";

/**
 * Si además hay que correr la liberación de asignaciones **por el camino
 * nuevo** antes de cada escenario. Es lo que permite comparar los dos mundos en
 * régimen: con la liberación en la lectura, el render suelta y muestra la fila
 * libre en el mismo acto; con la liberación fuera, ya estaba suelta cuando el
 * render llegó. Sin la perilla se ve la diferencia que PRO-20 declara — la fila
 * todavía asignada hasta que el gancho o el barrido pasen.
 */
const LIBERAR = process.env.LIBERAR === "si";

/** Hace cuánto se encendió el vendedor, en cada escenario. */
const RECIENTE_MS = 60 * 1000;
const VIEJA_MS = 400 * 24 * 60 * 60 * 1000;

/**
 * La foto de las dos columnas de la asignación, para poder devolver la base a
 * como estaba antes de cada escenario.
 */
interface FotoDeAsignaciones {
  id: string;
  assignedUserId: string | null;
  assignedAt: Date | null;
}

async function fotografiarAsignaciones(
  op: Operation,
): Promise<FotoDeAsignaciones[]> {
  return getDb()
    .select({
      id: conversations.id,
      assignedUserId: conversations.assignedUserId,
      assignedAt: conversations.assignedAt,
    })
    .from(conversations)
    .where(eq(conversations.operationId, op.id));
}

/**
 * Devuelve las asignaciones a la foto. Solo toca las filas que difieren, para
 * que restaurar no sea, él mismo, una escritura sobre las 1.725.
 */
async function restaurarAsignaciones(
  op: Operation,
  foto: readonly FotoDeAsignaciones[],
): Promise<number> {
  const base = getDb();
  const actuales = new Map(
    (await fotografiarAsignaciones(op)).map((f) => [f.id, f]),
  );
  let tocadas = 0;
  for (const fila of foto) {
    const hoy = actuales.get(fila.id);
    if (
      hoy &&
      hoy.assignedUserId === fila.assignedUserId &&
      hoy.assignedAt?.getTime() === fila.assignedAt?.getTime()
    ) {
      continue;
    }
    await base
      .update(conversations)
      .set({ assignedUserId: fila.assignedUserId, assignedAt: fila.assignedAt })
      .where(eq(conversations.id, fila.id));
    tocadas += 1;
  }
  return tocadas;
}

/** Pone la línea de corte del vendedor y vacía la caché que la guarda. */
async function ponerActivacion(hace: number): Promise<Date> {
  const at = new Date(Date.now() - hace);
  await getDb().execute(
    sql`update sales_agent_settings set activated_at = ${at.toISOString()}::timestamptz`,
  );
  invalidateSalesAgentSettingsCache();
  return at;
}

/** Apaga o enciende al vendedor **en la base**, que es el único interruptor. */
async function vendedorEn(estado: "encendido" | "apagado", nombre: string) {
  await getDb().execute(
    sql`update sales_agent_settings set display_name = ${estado === "encendido" ? nombre : ""}`,
  );
  invalidateSalesAgentSettingsCache();
}

/**
 * La fila tal como se vuelca: **todo**, con las fechas en ISO para que el JSON
 * sea comparable carácter a carácter.
 */
function volcarFila(item: ConversationListItem): unknown {
  return JSON.parse(
    JSON.stringify(item, (_clave, valor) =>
      valor instanceof Date ? valor.toISOString() : valor,
    ),
  );
}

interface Escenario {
  nombre: string;
  /** Hace cuánto se encendió el vendedor, o `null` para apagarlo. */
  activacion: number | null;
  correr: (op: Operation, bandeja: BandejaPedida | undefined) => Promise<unknown>;
  /** Qué bandeja pide. `undefined` = la pantalla de siempre. */
  inbox?: "ventas" | "operaciones";
}

const ESCENARIOS: Escenario[] = [
  {
    // La no-regresión llevada al volcado: sin vendedor no hay derivación y la
    // lista tiene que ser byte por byte la de hoy. Es el escenario que ninguna
    // optimización de la bandeja puede permitirse mover.
    nombre: "apagada",
    activacion: null,
    correr: (op) => listConversations(op, {}),
  },
  {
    nombre: "ventas-reciente",
    activacion: RECIENTE_MS,
    inbox: "ventas",
    correr: (op, bandeja) => listConversations(op, { bandeja }),
  },
  {
    nombre: "operaciones-reciente",
    activacion: RECIENTE_MS,
    inbox: "operaciones",
    correr: (op, bandeja) => listConversations(op, { bandeja }),
  },
  {
    nombre: "ventas-vieja",
    activacion: VIEJA_MS,
    inbox: "ventas",
    correr: (op, bandeja) => listConversations(op, { bandeja }),
  },
  {
    nombre: "operaciones-vieja",
    activacion: VIEJA_MS,
    inbox: "operaciones",
    correr: (op, bandeja) => listConversations(op, { bandeja }),
  },
  {
    nombre: "ventas-buscando",
    activacion: VIEJA_MS,
    inbox: "ventas",
    correr: (op, bandeja) =>
      listConversations(op, { bandeja, search: "Ixcot" }),
  },
  {
    nombre: "operaciones-anclada",
    activacion: VIEJA_MS,
    inbox: "operaciones",
    correr: async (op, bandeja) => {
      // La anclada se elige de la **otra** bandeja: el salto desde Pedidos
      // apunta a una conversación concreta y quien la pidió por id tiene
      // derecho a verla venga de donde venga. Es la fila que más fácil se cae
      // al acotar antes de derivar.
      const deVentas = await listConversations(op, {
        bandeja: { inbox: "ventas", activatedAt: bandeja?.activatedAt ?? null },
      });
      const pinnedId = deVentas.at(-1)?.conversation.id;
      return { pinnedId, filas: await listConversations(op, { bandeja, pinnedId }) };
    },
  },
];

async function main() {
  ensureWorkspaceEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL requerido");
  const host = hostDe(url);
  if (esProduccion(host)) {
    console.error(
      `\n  ${host} es producción. Este volcado mueve \`activated_at\` y restaura\n` +
        "  asignaciones: no corre ahí.\n",
    );
    process.exit(1);
  }

  const salida = process.env.ARCHIVO;
  if (!salida) throw new Error("ARCHIVO requerido: dónde escribir el JSON");

  const base = getDb();
  const [op] = (await base.select().from(operations)) as Operation[];
  if (!op) throw new Error("no hay operación: falta correr las migraciones");

  const vendedorOriginal = await getSalesAgentSettings(op);
  if (!salesAgentIsConfigured(vendedorOriginal)) {
    console.error(
      "\n  Esta base no tiene vendedor configurado: no hay bandeja que volcar.\n" +
        "      SEMBRAR=si ESCALA=si npx tsx scripts/seed-bandejas-ensayo.ts\n",
    );
    process.exit(1);
  }
  const nombreDelVendedor = vendedorOriginal.displayName;
  const activacionOriginal = vendedorOriginal.activatedAt;

  const foto = await fotografiarAsignaciones(op);
  const asignadas = foto.filter((f) => f.assignedUserId !== null).length;

  // **Lo que el volcado compara va aparte de lo que el instrumento anota.**
  // `diff` no distingue una fila que cambió de una nota al margen del script, y
  // si las dos cosas viven en el mismo objeto hay que explicarle al lector
  // cuáles de las líneas del diff no cuentan — que es la forma de que alguna
  // que sí cuenta pase por nota. Acá el payload es `volcado` y las notas son
  // `instrumento`: un `diff` de los `volcado` es la respuesta, sin glosa.
  const volcado: Record<string, unknown> = {};
  const instrumento: Record<string, unknown> = {
    escala: (
      await base
        .select({ n: sql<number>`count(*)::int` })
        .from(conversations)
        .where(eq(conversations.operationId, op.id))
    )[0]?.n,
    asignacionesEnLaFoto: asignadas,
  };

  for (const escenario of ESCENARIOS) {
    const restauradas = await restaurarAsignaciones(op, foto);
    let bandeja: BandejaPedida | undefined;
    if (escenario.activacion === null) {
      await vendedorEn("apagado", nombreDelVendedor);
    } else {
      await vendedorEn("encendido", nombreDelVendedor);
      const activatedAt = await ponerActivacion(escenario.activacion);
      bandeja = escenario.inbox
        ? { inbox: escenario.inbox, activatedAt }
        : undefined;
    }

    // El camino nuevo de PRO-20, corrido donde producción lo corre: en el
    // worker, antes de que nadie mire la pantalla. En la rama vieja esto no
    // existe y lo hacía la propia lectura.
    const sueltas = LIBERAR ? (await liberarAsignacionesVencidas(op)).sueltas : 0;

    const resultado = await escenario.correr(op, bandeja);
    const filas = Array.isArray(resultado)
      ? (resultado as ConversationListItem[])
      : ((resultado as { filas: ConversationListItem[] }).filas ?? []);
    const extra = Array.isArray(resultado)
      ? {}
      : { pinnedId: (resultado as { pinnedId?: string }).pinnedId };

    volcado[escenario.nombre] = {
      ...extra,
      filas: filas.length,
      lista: filas.map(volcarFila),
    };
    instrumento[escenario.nombre] = {
      // Las columnas de la asignación tal como quedaron **después** de volcar:
      // es donde se ve si leer escribió.
      asignacionesTrasElRender: (await fotografiarAsignaciones(op)).filter(
        (f) => f.assignedUserId !== null,
      ).length,
      ...(LIBERAR ? { sueltasPorElCaminoNuevo: sueltas } : {}),
      restauradasAntes: restauradas,
    };
  }

  // ── El contador de la barra lateral ───────────────────────────────────────
  for (const [nombre, hace] of [
    ["contador-reciente", RECIENTE_MS],
    ["contador-vieja", VIEJA_MS],
  ] as const) {
    await restaurarAsignaciones(op, foto);
    await vendedorEn("encendido", nombreDelVendedor);
    await ponerActivacion(hace);
    if (LIBERAR) await liberarAsignacionesVencidas(op);
    const vendedor = await getSalesAgentSettings(op);
    if (!salesAgentIsConfigured(vendedor)) throw new Error("vendedor apagado");
    volcado[nombre] = await countSalesInboxViews(op, vendedor);
  }

  // ── Devolver la base a como estaba ────────────────────────────────────────
  await restaurarAsignaciones(op, foto);
  await vendedorEn("encendido", nombreDelVendedor);
  if (activacionOriginal !== null) {
    await base.execute(
      sql`update sales_agent_settings set activated_at = ${activacionOriginal.toISOString()}::timestamptz`,
    );
  } else {
    await base.execute(sql`update sales_agent_settings set activated_at = null`);
  }
  invalidateSalesAgentSettingsCache();

  writeFileSync(salida, `${JSON.stringify(volcado, null, 2)}\n`);
  writeFileSync(
    salida.replace(/(\.json)?$/, ".instrumento.json"),
    `${JSON.stringify(instrumento, null, 2)}\n`,
  );
  console.log("");
  console.log(`  Volcado en ${salida}`);
  for (const escenario of ESCENARIOS) {
    const v = volcado[escenario.nombre] as { filas: number };
    const i = instrumento[escenario.nombre] as {
      asignacionesTrasElRender: number;
    };
    console.log(
      `    ${escenario.nombre.padEnd(24)} ${String(v.filas).padStart(5)} filas` +
        `   asignadas después: ${i.asignacionesTrasElRender} (de ${asignadas})`,
    );
  }
  for (const nombre of ["contador-reciente", "contador-vieja"]) {
    const c = volcado[nombre] as {
      sinResponder: number;
      enAutomatico: number;
      todas: number;
    };
    console.log(
      `    ${nombre.padEnd(24)} todas ${c.todas} · sin responder ${c.sinResponder} · en automático ${c.enAutomatico}`,
    );
  }
  console.log("");

  await getRawClient().end({ timeout: 5 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
