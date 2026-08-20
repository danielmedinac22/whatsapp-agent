/**
 * **Cuánto cuesta la bandeja de ventas el día que se encienda, medido antes de
 * encenderla.**
 *
 * Hoy no se puede medir en producción porque el código no corre: no hay
 * vendedor configurado, `bandejaPedida` devuelve indefinido y toda la derivación
 * de bandeja está escrita, probada y sin ejecutarse nunca. El día que se
 * configure a Sebastián, cada carga del Inbox va a leer **todas** las
 * conversaciones de la operación —sin `LIMIT`, con su join de contactos y
 * ordenadas por una expresión que ningún índice sirve—, traer los pedidos de
 * todos esos contactos, derivar fila por fila en memoria y **escribir** sobre
 * `conversations` si alguna asignación quedó vieja. Y como el panel llama
 * `router.refresh()` con cada evento SSE, eso ocurre una vez por mensaje de
 * WhatsApp que entra.
 *
 * Este ensayo lo mide con la misma regla que mide el panel de hoy
 * (`./regla-de-medir`), contra una base desechable **con datos**: con la tabla
 * vacía cualquier consulta es rápida y el número no dice nada.
 *
 * Lo que responde, que son las cuatro preguntas del ticket:
 *
 * 1. Cuántas consultas, cuántas idas y vueltas y cuánto tarda un render con la
 *    bandeja encendida, contra el mismo render con la bandeja apagada.
 * 2. Cuántas filas se leen en ese caso, y cuántas se escriben.
 * 3. Cuánto cuesta aparte el contador de la barra lateral, que se dibuja en las
 *    siete pantallas del panel.
 * 4. **A cuántas conversaciones por operación esto deja de aguantar**, medido a
 *    tres escalas y con el plan de ejecución al lado.
 *
 * ## Cómo se corre
 *
 *     docker run -d --name wa-ensayo-medir -e POSTGRES_PASSWORD=test \
 *       -e POSTGRES_DB=wa -p 55981:5432 postgres:16-alpine
 *
 *     export DATABASE_URL="postgres://postgres:test@127.0.0.1:55981/wa"
 *     pnpm --filter @wa/db migrate
 *     SEMBRAR=si ESCALA=si npx tsx scripts/seed-bandejas-ensayo.ts
 *     WA_SQL_TRACE=1 ENSAYAR=si npx tsx scripts/ensayo-bandeja-a-escala.ts
 *
 *     docker rm -f wa-ensayo-medir
 *
 * El sembrado de la línea 3 no es opcional ni previo: **es parte de la
 * medición**, y este script se niega a correr sin él. De ahí salen el vendedor
 * configurado —que es el interruptor de todo esto— y las 1.725 conversaciones
 * con la proporción de producción, 94 % con pedido.
 *
 * Perillas: `ESCALAS=1,5,10` (múltiplos de la escala de producción, y el script
 * hace crecer la tabla hasta cada uno), `PASADAS=3`, `ASIGNADAS=200` (cuántas
 * asignaciones viejas fabricar para medir la escritura).
 */

import {
  contacts,
  conversations,
  dropiOrders,
  ensureWorkspaceEnv,
  eq,
  getDb,
  getRawClient,
  getSalesAgentSettings,
  medirViajes,
  operations,
  salesAgentIsConfigured,
  shopifyOrders,
  sql,
  sqlTraceEnabled,
  users,
  type Operation,
  type SalesAgentSettings,
} from "@wa/db";
import { db } from "../apps/web/src/lib/db";
import {
  countSalesInboxViews,
  listConversations,
  type BandejaPedida,
} from "../apps/web/src/lib/queries";
import {
  contar,
  entero,
  esProduccion,
  hostDe,
  idaYVuelta,
  marco,
  ms,
  pantalla,
  type Cuentas,
} from "./regla-de-medir";

/** La escala de producción el 20-ago-2026, que es el 1× de este ensayo. */
const ESCALA_PRODUCCION = 1762;

// ────────────────────────────────────────────────────────────────────────────
// Hacer crecer la tabla
// ────────────────────────────────────────────────────────────────────────────

/**
 * Lleva la operación hasta `objetivo` conversaciones **sin borrar lo que ya
 * hay**, que es lo que permite medir 1×, 5× y 10× en una sola corrida sin
 * volver a sembrar desde cero.
 *
 * Copia la forma de `seed-bandejas-ensayo.ts` en lo que importa para el costo:
 * el 94 % con pedido de tienda y su pedido de logística, y todas **más viejas**
 * que lo ya sembrado, para que el corte de 200 siga mostrando lo que se sembró
 * a mano. Lo que no copia es la variedad narrativa —previews, confirmaciones,
 * escaladas—: acá no se mira la pantalla, se cronometra.
 *
 * El `waId` lleva el número de fila global para no chocar contra el índice
 * único de contactos al correrlo varias veces.
 */
async function crecerHasta(op: Operation, objetivo: number): Promise<number> {
  const base = getDb();
  const [{ n: actuales }] = (await base
    .select({ n: sql<number>`count(*)::int` })
    .from(conversations)
    .where(eq(conversations.operationId, op.id))) as [{ n: number }];
  if (actuales >= objetivo) return 0;

  const faltan = objetivo - actuales;
  // Todas nacen antes de lo ya sembrado: 30 días atrás y hacia atrás.
  const desde = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const LOTE = 500;

  for (let hecho = 0; hecho < faltan; hecho += LOTE) {
    const cuantos = Math.min(LOTE, faltan - hecho);
    const filas = Array.from({ length: cuantos }, (_, k) => {
      const i = actuales + hecho + k;
      return {
        waId: `5027${String(100000 + i)}`,
        jid: `5027${String(100000 + i)}@s.whatsapp.net`,
        phone: `+5027${String(100000 + i)}`,
        name: `Relleno ${i}`,
        agentMode: i % 9 !== 0,
      };
    });
    const nuevos = await base
      .insert(contacts)
      .values(filas)
      .returning({ id: contacts.id });

    await base.insert(conversations).values(
      nuevos.map((c, k) => {
        const i = actuales + hecho + k;
        const t = new Date(desde - i * 60_000);
        return {
          contactId: c.id,
          operationId: op.id,
          lastInboundAt: t,
          lastOutboundAt: new Date(t.getTime() + 30_000),
          createdAt: t,
          lastMessagePreview: "¿ya salió mi pedido?",
          unreadCount: 0,
          confirmationStatus: (i % 3 === 0 ? "confirmed" : "pending") as
            | "confirmed"
            | "pending",
        };
      }),
    );

    // 94 % con pedido, igual que producción: lo que queda sin pedido es lo que
    // cae en la bandeja de ventas, y tiene que dar del orden del 6 %.
    const conPedido = nuevos.filter((_, k) => (actuales + hecho + k) % 16 !== 0);
    if (conPedido.length === 0) continue;
    const pedidos = await base
      .insert(shopifyOrders)
      .values(
        conPedido.map((c, k) => {
          const i = actuales + hecho + k;
          return {
            operationId: op.id,
            contactId: c.id,
            orderId: `#R${i}`,
            customerName: "Cliente",
            customerPhone: "+5027",
            totalPrice: "349.00",
            status: "confirmed" as const,
            receivedAt: new Date(desde - i * 60_000),
            rawPayload: {
              line_items: [{ title: "REVITALHAIR – DHT ANTICALVICIE" }],
            },
          };
        }),
      )
      .returning({ id: shopifyOrders.id, contactId: shopifyOrders.contactId });

    await base.insert(dropiOrders).values(
      pedidos.map((r, k) => ({
        operationId: op.id,
        contactId: r.contactId,
        shopifyOrderRowId: r.id,
        dropiOrderId: 5_000_000 + actuales + hecho + k,
        customerName: "Cliente",
        status: (k % 3 === 0 ? "entregado" : "en_transito") as
          | "entregado"
          | "en_transito",
      })),
    );
  }
  return faltan;
}

// ────────────────────────────────────────────────────────────────────────────
// Las escenas que se comparan
// ────────────────────────────────────────────────────────────────────────────

interface Escena {
  nombre: string;
  correr: () => Promise<unknown>;
  /** Qué dejar puesto antes de medir, **fuera** de la traza. */
  antes?: () => Promise<unknown>;
  /** Y cómo devolverlo. */
  despues?: () => Promise<unknown>;
}

/**
 * Enciende o apaga al vendedor **de verdad, en la base**.
 *
 * La escena «hoy» no se puede simular pasando `undefined` por parámetro: el
 * layout no recibe el vendedor, lo **lee** (`getSalesAgentSettings`), y con la
 * fila configurada dibuja los contadores de la barra aunque la pantalla pida la
 * bandeja apagada. Simularlo por parámetro mediría un render que no existe: uno
 * sin bandeja pero con contadores.
 *
 * El listón es `display_name` no vacío —`salesAgentIsConfigured`, el único del
 * monorepo—, así que apagarlo es vaciarlo. `activated_at` no se toca: la fecha
 * ya puesta no se vuelve a escribir nunca, que es lo que dice
 * `needsActivationStamp`.
 */
async function vendedorEn(estado: "encendido" | "apagado", nombre: string) {
  await getDb().execute(
    sql`update sales_agent_settings set display_name = ${estado === "encendido" ? nombre : ""}`,
  );
}

function escenasDe(
  op: Operation,
  vendedor: SalesAgentSettings,
): Escena[] {
  const deVentas: BandejaPedida = {
    inbox: "ventas",
    activatedAt: vendedor.activatedAt,
  };
  const deOperaciones: BandejaPedida = {
    inbox: "operaciones",
    activatedAt: vendedor.activatedAt,
  };
  return [
    {
      // El render de hoy: sin vendedor no hay bandeja, no se deriva nada y la
      // barra lateral no cuenta nada. Es la línea contra la que se compara todo
      // lo demás, y por eso el vendedor se apaga de verdad para medirla.
      nombre: "hoy · bandeja apagada",
      antes: () => vendedorEn("apagado", vendedor.displayName),
      despues: () => vendedorEn("encendido", vendedor.displayName),
      correr: () =>
        Promise.all([marco(op, null), pantalla(op, undefined, undefined)]),
    },
    {
      // La URL de Katherine el día después de encender al vendedor: la misma de
      // hoy, sin parámetro, y ahora deriva.
      nombre: "encendida · operaciones (la URL de Katherine)",
      correr: () =>
        Promise.all([marco(op, vendedor), pantalla(op, deOperaciones, undefined)]),
    },
    {
      nombre: "encendida · ventas (?b=ventas)",
      correr: () =>
        Promise.all([marco(op, vendedor), pantalla(op, deVentas, undefined)]),
    },
    {
      nombre: "  de eso: listConversations() con bandeja",
      correr: () => listConversations(op, { bandeja: deVentas }),
    },
    {
      // Aparte, porque la barra lateral lo dibuja en las SIETE pantallas del
      // panel y no solo en el Inbox: este costo se paga en Pedidos, en
      // Plantillas y en todas las demás.
      nombre: "  de eso: countSalesInboxViews() · barra lateral",
      correr: () => countSalesInboxViews(op, vendedor),
    },
  ];
}

/** Lo medido para una escena a una escala. */
interface Toma {
  escena: string;
  escala: number;
  cuentas: Cuentas;
}

async function medirEscena(
  escena: Escena,
  escala: number,
  pasadas: number,
): Promise<Toma> {
  if (escena.antes) await escena.antes();
  // La primera se tira: paga los handshakes y la introspección de tipos, y eso
  // no es de la escena. Ver el encabezado de `./regla-de-medir`.
  await escena.correr();
  const tomas: Cuentas[] = [];
  for (let p = 0; p < pasadas; p++) {
    const { traza } = await medirViajes(escena.nombre, () => escena.correr());
    tomas.push(contar(traza));
  }
  if (escena.despues) await escena.despues();
  // Mediana de tiempo, y con ella el resto de sus números: promediar consultas
  // daría 13,5 viajes, que no es un número que exista.
  const ordenadas = [...tomas].sort((a, b) => a.ms - b.ms);
  const mediana = ordenadas[Math.floor(ordenadas.length / 2)]!;
  return { escena: escena.nombre, escala, cuentas: mediana };
}

// ────────────────────────────────────────────────────────────────────────────
// La escritura que dispara una lectura
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fabrica asignaciones viejas y mide qué escribe el render que las encuentra.
 *
 * **No es un caso rebuscado: es el caso normal de una venta.** Una conversación
 * sin pedido está en la bandeja de ventas; el vendedor se la asigna; el cliente
 * compra y nace el pedido; desde ese instante la conversación es de
 * operaciones, y la asignación quedó vieja. `conversationIdsOfInbox` lo
 * descubre al derivar y suelta las dos columnas con un `UPDATE`.
 *
 * Se fabrica moviendo `assigned_at` a un instante posterior al encendido del
 * vendedor y **anterior** al pedido: en ese momento la conversación no tenía
 * pedido y había nacido después del corte, así que era de ventas; ahora tiene
 * pedido, así que es de operaciones. Eso es exactamente `inboxChangedSince`.
 */
async function medirLaEscritura(
  op: Operation,
  vendedor: SalesAgentSettings,
  cuantas: number,
): Promise<{ preparadas: number; escritas: number; consultas: number }> {
  const base = getDb();
  const [asesor] = await base.select({ id: users.id }).from(users).limit(1);
  if (!asesor) return { preparadas: 0, escritas: 0, consultas: 0 };

  // El corte se mueve hacia atrás para que las conversaciones sembradas hayan
  // nacido DESPUÉS de encender al vendedor: sin eso son historia de Katherine y
  // nunca fueron de ventas, ni antes ni ahora.
  await base.execute(
    sql`update sales_agent_settings set activated_at = now() - interval '400 days'`,
  );
  const recargado = await getSalesAgentSettings(op);
  const corte = salesAgentIsConfigured(recargado) ? recargado : vendedor;

  // Asignadas en un instante anterior a su propio pedido: ahí eran de ventas.
  const preparadas = await base.execute(sql`
    update conversations c
       set assigned_user_id = ${asesor.id},
           assigned_at = o.received_at - interval '1 hour'
      from shopify_orders o
     where o.contact_id = c.contact_id
       and c.operation_id = ${op.id}
       and c.created_at > now() - interval '400 days'
       and c.id in (
         select c2.id from conversations c2
          join shopify_orders o2 on o2.contact_id = c2.contact_id
         where c2.operation_id = ${op.id}
           and c2.created_at > now() - interval '400 days'
         limit ${cuantas}
       )
  `);

  const { traza } = await medirViajes("render que suelta", () =>
    listConversations(op, {
      bandeja: { inbox: "ventas", activatedAt: corte.activatedAt },
    }),
  );
  const c = contar(traza);
  return {
    preparadas: Number((preparadas as unknown as { count?: number }).count ?? cuantas),
    escritas: c.filasEscritas,
    consultas: c.viajes,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// El plan de la consulta que no tiene índice
// ────────────────────────────────────────────────────────────────────────────

/**
 * El plan de ejecución de **la** consulta del ticket: el `SELECT` sin `LIMIT`
 * de todas las conversaciones de la operación, ordenado por
 * `GREATEST(last_inbound_at, last_outbound_at, created_at)`.
 *
 * No se copia a mano: se saca de la traza de un render con bandeja y se le pide
 * el plan a ese texto exacto. Una consulta copiada a mano se desincroniza en
 * silencio, y lo que se quiere saber es el plan de la que corre.
 */
async function planDeLaBandeja(
  op: Operation,
  vendedor: SalesAgentSettings,
): Promise<{ sql: string; plan: string[]; derrame: Derrame | null } | null> {
  const { traza } = await medirViajes("para sacar el SQL", () =>
    listConversations(op, {
      bandeja: { inbox: "ventas", activatedAt: vendedor.activatedAt },
    }),
  );
  const candidata = traza.viajes.find(
    (v) =>
      /from "conversations"/i.test(v.sql) &&
      /greatest/i.test(v.sql) &&
      !/limit/i.test(v.sql) &&
      v.parametros === 1,
  );
  if (!candidata) return null;
  const filas = (await getRawClient().unsafe(
    `explain (analyze, buffers, timing) ${candidata.sql}`,
    [op.id],
  )) as unknown as Array<Record<string, string>>;
  const plan = filas.map((f) => Object.values(f)[0] ?? "");
  return {
    sql: candidata.sql.replace(/\s+/g, " ").trim(),
    plan,
    derrame: await puntoDeDerrame(plan),
  };
}

/** Dónde deja de ordenar en memoria y empieza a ordenar contra el disco. */
interface Derrame {
  metodo: string;
  usadoKb: number;
  filas: number;
  workMemKb: number;
  /** Conversaciones a las que el orden se cae al disco. */
  filasAlDerrame: number;
}

/**
 * **A partir de cuántas filas el orden de la bandeja deja de caber en memoria.**
 *
 * Es el techo más nítido de los dos, y el único que tiene un borde y no una
 * pendiente: mientras el `Sort` diga `quicksort` con su memoria, ordenar 17.620
 * filas cuesta milisegundos; cuando pase de `work_mem` el plan cambia a
 * `external merge` y el orden se hace **contra el disco**, en un render que
 * corre una vez por mensaje de WhatsApp que entra.
 *
 * El número sale del plan real: cuántos kB usó el `Sort` para cuántas filas,
 * extrapolado hasta el `work_mem` de esta base. Se lee de `SHOW work_mem` y no
 * de un valor supuesto, porque Railway puede tener otro que el de por defecto.
 */
async function puntoDeDerrame(plan: readonly string[]): Promise<Derrame | null> {
  const metodo = plan.find((l) => /Sort Method:/i.test(l));
  const orden = plan.find((l) => /Sort Key:/i.test(l));
  if (!metodo || !orden) return null;
  const kb = Number(/Memory: (\d+)kB/.exec(metodo)?.[1] ?? 0);
  const filas = Number(
    /actual time=[\d.]+\.\.[\d.]+ rows=(\d+)/.exec(
      plan.find((l) => /^Sort |^\s*Sort /.test(l)) ?? "",
    )?.[1] ?? 0,
  );
  if (kb === 0 || filas === 0) return null;
  const [fila] = (await getRawClient().unsafe(
    "select setting::int as kb from pg_settings where name = 'work_mem'",
  )) as unknown as Array<{ kb: number }>;
  const workMemKb = fila?.kb ?? 4096;
  return {
    metodo: /Sort Method: (.+?)(?:  |$)/.exec(metodo)?.[1]?.trim() ?? "?",
    usadoKb: kb,
    filas,
    workMemKb,
    filasAlDerrame: Math.round((workMemKb / kb) * filas),
  };
}

// ────────────────────────────────────────────────────────────────────────────

async function main() {
  if (!sqlTraceEnabled()) {
    console.error(
      "\n  Falta WA_SQL_TRACE=1: sin la traza no hay nada que contar.\n" +
        "  WA_SQL_TRACE=1 ENSAYAR=si npx tsx scripts/ensayo-bandeja-a-escala.ts\n",
    );
    process.exit(1);
  }
  ensureWorkspaceEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL requerido");
  const host = hostDe(url);

  if (esProduccion(host)) {
    console.error(
      `\n  ${host} es producción. Este ensayo siembra conversaciones y mide una\n` +
        "  derivación que escribe sobre `conversations`. No corre ahí, y no hace\n" +
        "  falta que corra: en producción el código que mide no se ejecuta.\n",
    );
    process.exit(1);
  }
  if (process.env.ENSAYAR !== "si") {
    console.error(
      `\n  Va a escribir conversaciones, contactos y pedidos en ${host},\n` +
        "  y a mover `sales_agent_settings.activated_at`.\n" +
        "  Volvé a correrlo con ENSAYAR=si si es la base de ensayo.\n",
    );
    process.exit(1);
  }

  const base = getDb();
  const [op] = (await base.select().from(operations)) as Operation[];
  if (!op) throw new Error("no hay operación: falta correr las migraciones");

  const vendedor = await getSalesAgentSettings(op);
  if (!salesAgentIsConfigured(vendedor)) {
    console.error(
      "\n  Esta base no tiene vendedor configurado, así que la bandeja de ventas\n" +
        "  tampoco corre acá y no habría nada que medir. Sembrá primero:\n\n" +
        "      SEMBRAR=si ESCALA=si npx tsx scripts/seed-bandejas-ensayo.ts\n",
    );
    process.exit(1);
  }

  const escalas = (process.env.ESCALAS ?? "1,5,10")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0);
  const pasadas = Number(process.env.PASADAS ?? 3);
  const asignadas = Number(process.env.ASIGNADAS ?? 200);

  const rtt = await idaYVuelta(5);

  console.log("");
  console.log("  ╭─ La bandeja de ventas encendida, antes de encenderla");
  console.log(`  │  base        ${host} (de ensayo, con datos sembrados)`);
  console.log(
    `  │  ida y vuelta ${ms(rtt.mediana)} ms — casi cero: acá lo que se mide es el TRABAJO,`,
  );
  console.log(
    "  │               no la distancia. La distancia se mide contra producción",
  );
  console.log("  │               con scripts/viajes-del-panel.ts.");
  console.log(`  │  vendedor    ${vendedor.displayName}, encendido`);
  console.log(
    `  │  escalas     ${escalas.map((e) => `${e}× = ${entero(e * ESCALA_PRODUCCION)}`).join("  ·  ")}`,
  );
  console.log("  ╰─");

  const todas: Toma[] = [];

  for (const escala of escalas) {
    const objetivo = Math.round(escala * ESCALA_PRODUCCION);
    const agregadas = await crecerHasta(op, objetivo);
    // Sin estadísticas frescas el planificador elige a ciegas y el plan que se
    // reporta no es el que Postgres elegiría con esta tabla.
    await base.execute(sql`analyze conversations, contacts, shopify_orders, dropi_orders`);

    const [{ n }] = (await base
      .select({ n: sql<number>`count(*)::int` })
      .from(conversations)
      .where(eq(conversations.operationId, op.id))) as [{ n: number }];

    console.log("");
    console.log(
      `  ── ${escala}× · ${entero(n)} conversaciones` +
        (agregadas > 0 ? `  (+${entero(agregadas)} sembradas ahora)` : ""),
    );
    console.log(
      "     escena                                        consultas  i/v   cadena      ms      filas",
    );
    for (const escena of escenasDe(op, vendedor)) {
      const toma = await medirEscena(escena, n, pasadas);
      todas.push(toma);
      const c = toma.cuentas;
      console.log(
        `     ${escena.nombre.padEnd(44)} ${String(c.viajes).padStart(6)}  ` +
          `${String(c.idasYVueltas).padStart(3)}  ${String(c.rondas).padStart(2)}/${String(c.rondasDeRed).padStart(2)}  ` +
          `${ms(c.ms).padStart(8)}  ${entero(c.filasLeidas).padStart(9)}` +
          (c.filasEscritas > 0 ? `  ${entero(c.filasEscritas)} ESCRITAS` : ""),
      );
    }
  }

  // ── ¿Leer escribe? ────────────────────────────────────────────────────────
  console.log("");
  console.log("  ── Leer, ¿escribe?");
  const escritura = await medirLaEscritura(op, vendedor, asignadas);
  console.log(
    `     ${entero(escritura.preparadas)} conversaciones asignadas antes de que naciera su pedido\n` +
      `     → un solo render de la bandeja escribió ${entero(escritura.escritas)} filas de \`conversations\`\n` +
      "     con un UPDATE, sin que nadie tocara un botón.",
  );
  console.log(
    "     Y el panel llama router.refresh() con cada evento SSE: eso es una vez\n" +
      "     por mensaje de WhatsApp que entra, sobre la tabla más caliente.",
  );

  // ── El plan ───────────────────────────────────────────────────────────────
  console.log("");
  console.log("  ── El plan de la consulta sin LIMIT (la del ticket)");
  const plan = await planDeLaBandeja(op, vendedor);
  if (!plan) {
    console.log("     no se encontró la consulta en la traza — revisar el filtro");
  } else {
    for (const l of plan.plan) console.log(`     ${l}`);
    if (plan.derrame) {
      const d = plan.derrame;
      console.log("");
      console.log(
        `     Ordena con ${d.metodo}: ${entero(d.usadoKb)} kB para ${entero(d.filas)} filas,\n` +
          `     y \`work_mem\` de esta base es ${entero(d.workMemKb)} kB. A ese ritmo el orden\n` +
          `     deja de caber en memoria alrededor de las ${entero(d.filasAlDerrame)} conversaciones,\n` +
          "     y ahí el plan pasa a `external merge`: ordenar contra el disco.",
      );
    }
  }

  // ── El techo ──────────────────────────────────────────────────────────────
  // **La comparación es contra la bandeja de operaciones, no contra la de
  // ventas.** La de ventas la abre Sebastián, que es quien pidió el módulo; la
  // de operaciones es la URL de Katherine, la misma de hoy, sin parámetro — y
  // es la que va a costar más el día después de encender, porque el 94 % de las
  // conversaciones tiene pedido. Encender el módulo no puede hacerle más lento
  // el panel a quien no lo pidió: es la primera historia de usuario del spec.
  const deVentas = todas.filter(
    (t) => t.escena === "encendida · operaciones (la URL de Katherine)",
  );
  const soloVentas = todas.filter(
    (t) => t.escena === "encendida · ventas (?b=ventas)",
  );
  const apagada = todas.filter((t) => t.escena === "hoy · bandeja apagada");
  console.log("");
  console.log("  ╭─ Contra qué comparar");
  console.log("  │  escala        apagada (hoy)              encendida · operaciones     de más");
  for (let i = 0; i < deVentas.length; i++) {
    const a = apagada[i];
    const v = deVentas[i];
    if (!a || !v) continue;
    console.log(
      `  │  ${entero(v.escala).padStart(7)}  ` +
        `${ms(a.cuentas.ms).padStart(7)} ms / ${entero(a.cuentas.filasLeidas).padStart(7)} filas   ` +
        `${ms(v.cuentas.ms).padStart(7)} ms / ${entero(v.cuentas.filasLeidas).padStart(7)} filas   ` +
        `×${(v.cuentas.ms / Math.max(a.cuentas.ms, 0.001)).toFixed(1)} tiempo, ` +
        `×${(v.cuentas.filasLeidas / Math.max(a.cuentas.filasLeidas, 1)).toFixed(1)} filas`,
    );
  }
  console.log("  │");
  for (let i = 0; i < soloVentas.length; i++) {
    const v = soloVentas[i];
    if (!v) continue;
    console.log(
      `  │  ${entero(v.escala).padStart(7)}  la de Sebastián (?b=ventas):  ` +
        `${ms(v.cuentas.ms)} ms / ${entero(v.cuentas.filasLeidas)} filas`,
    );
  }
  console.log("  ╰─");

  // La proyección: con dos escalas o más se ajusta una recta sobre el trabajo
  // medido, que es lo único que crece con las filas —la latencia no crece, se
  // paga igual con mil filas que con cien mil—.
  const primera = deVentas[0];
  const ultima = deVentas[deVentas.length - 1];
  if (primera && ultima && ultima.escala > primera.escala) {
    const pendiente =
      (ultima.cuentas.ms - primera.cuentas.ms) / (ultima.escala - primera.escala);
    const corte = primera.cuentas.ms - pendiente * primera.escala;
    const enN = (n: number) => corte + pendiente * n;
    const paraMs = (objetivo: number) => Math.round((objetivo - corte) / pendiente);
    console.log("");
    console.log("  ╭─ El techo");
    console.log(
      `  │  El trabajo de un render de la bandeja crece ${ms(pendiente * 1000)} ms por cada`,
    );
    console.log("  │  mil conversaciones de la operación — medido, no estimado.");
    console.log(
      `  │    a ${entero(10_000)} conversaciones: ${ms(enN(10_000))} ms de trabajo por render`,
    );
    console.log(
      `  │    a ${entero(50_000)} conversaciones: ${ms(enN(50_000))} ms`,
    );
    console.log(
      `  │    a ${entero(100_000)} conversaciones: ${ms(enN(100_000))} ms`,
    );
    console.log("  │");
    console.log(
      `  │  Cruza 500 ms de trabajo en ${entero(paraMs(500))} conversaciones,`,
    );
    console.log(`  │  y 1.000 ms en ${entero(paraMs(1000))}.`);
    console.log("  │");
    if (plan?.derrame) {
      console.log(
        `  │  Y hay un borde antes que cualquiera de esos: a las ~${entero(plan.derrame.filasAlDerrame)}`,
      );
      console.log(
        `  │  conversaciones el orden por GREATEST(...) deja de caber en \`work_mem\``,
      );
      console.log(
        "  │  y pasa a ordenarse contra el disco. Ahí la curva deja de ser esta recta.",
      );
      console.log("  │");
    }
    // El número que convierte «lento» en «caro»: el panel se refresca con cada
    // evento SSE, así que este render no ocurre cuando alguien abre la
    // pantalla, ocurre cuando entra un mensaje.
    console.log(
      `  │  Y el multiplicador que no es de escala sino de tráfico: son`,
    );
    console.log(
      `  │  ${entero(ultima.cuentas.filasLeidas)} filas leídas por render × un render por mensaje de WhatsApp`,
    );
    console.log(
      "  │  que entra × una pestaña abierta. Con dos asesores mirando el panel,",
    );
    console.log(
      `  │  cada mensaje entrante cuesta ${entero(ultima.cuentas.filasLeidas * 2)} filas leídas.`,
    );
    console.log("  ╰─");
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
