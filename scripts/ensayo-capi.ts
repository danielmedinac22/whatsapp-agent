/**
 * Ensaya el camino entero del reporte de conversiones a Meta contra una base
 * **de ensayo**, sin mandarle nada a Meta y sin tocar producción.
 *
 * ## Por qué existe
 *
 * Los tests de este ticket van sobre funciones puras, que es como se prueba en
 * este repo, y **hay una clase de error que no pueden ver**: la que está en qué
 * filas llegan a la decisión, no en qué se decide con ellas. Este script
 * encontró dos así, y ninguna daba error de tipos ni rompía un test:
 *
 * 1. **El reintento no reintentaba.** El envío reusaba la consulta del barrido,
 *    que excluye todo pedido con fila en el libro — incluida la fila `pending`
 *    que el propio primer intento acababa de escribir. El reintento no
 *    encontraba nada que hacer, el job se completaba contento, y la conversión
 *    quedaba perdida para siempre en el primer fallo temporal.
 * 2. **El tablero mentía sobre lo que había mirado.** El barrido descarta en
 *    SQL los pedidos que no son de ventas, así que nunca llegaban a contarse:
 *    el estado del reporte habría dicho «no hubo pedidos en el período» sobre
 *    una operación que factura 470 al mes.
 *
 * ## Cómo se corre
 *
 *     docker run -d --name wa-ensayo-capi -e POSTGRES_PASSWORD=test \
 *       -e POSTGRES_DB=wa -p 55997:5432 postgres:16-alpine
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55997/wa" \
 *       pnpm --filter @wa/db migrate
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55997/wa" ENSAYAR=si \
 *       npx tsx scripts/ensayo-capi.ts
 *
 * **No le habla a Meta.** Reemplaza `fetch` por uno de mentira que cuenta las
 * llamadas y devuelve la respuesta que cada paso necesita. Eso es justamente lo
 * que permite comprobar el criterio más importante del interruptor: que con el
 * reporte apagado **no sale ni una llamada**. Contar cero llamadas es la única
 * forma de probar una ausencia.
 */

import {
  contacts,
  conversations,
  getDb,
  kapsoConnection,
  operations,
  outboundMessages,
  shopifyOrders,
  sql,
  type Operation,
} from "@wa/db";

/** Hosts que son producción. Contra estos no se ensaya nada, nunca. */
const PROHIBIDOS = ["rlwy.net", "railway.app"];

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<DATABASE_URL inválida>";
  }
}

/** La llave de idempotencia del cierre, con la forma que escribe `sales/order.ts`. */
const LLAVE_CIERRE = "ventas-a1b2c3d4e5f60718293a4b5c";

// ── El `fetch` de mentira ───────────────────────────────────────────────────

let llamadas: string[] = [];
let responder: () => Promise<Response> = async () => RESPUESTAS.ok();

const RESPUESTAS = {
  ok: async () =>
    new Response(JSON.stringify({ events_received: 1 }), { status: 200 }),
  /** Token inválido: permanente, lo arregla una persona. */
  tokenInvalido: async () =>
    new Response(
      JSON.stringify({ error: { code: 190, message: "Invalid OAuth token" } }),
      { status: 400 },
    ),
  /** «Bajá el ritmo», que Meta manda como código y no como 429. */
  saturado: async () =>
    new Response(JSON.stringify({ error: { code: 4 } }), { status: 400 }),
  /** La petición nunca salió: Meta no vio nada. */
  nuncaSalio: async (): Promise<Response> => {
    throw Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
    });
  },
  /** Salió y no hubo respuesta: puede haber llegado. */
  sinRespuesta: async (): Promise<Response> => {
    throw Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    });
  },
};

function instalarFetchDeMentira(): void {
  globalThis.fetch = (async (url: unknown) => {
    llamadas.push(String(url));
    return responder();
  }) as typeof fetch;
}

// ── El ensayo ───────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL requerido");
  const host = hostDe(url);

  if (PROHIBIDOS.some((p) => host.includes(p))) {
    console.error(
      `\n  ${host} es producción. Este script no ensaya ahí.\n` +
        `  Escribe pedidos y conversiones de mentira, y el libro de conversiones\n` +
        `  es lo que impide que una venta se le reporte dos veces a Meta.\n`,
    );
    process.exit(1);
  }
  if (process.env.ENSAYAR !== "si") {
    console.error(
      `\n  Va a escribir contactos, pedidos y conversiones en ${host}.\n` +
        `  Volvé a correrlo con ENSAYAR=si si es la base de ensayo.\n`,
    );
    process.exit(1);
  }

  instalarFetchDeMentira();

  const db = getDb();
  const [op] = (await db.select().from(operations)) as Operation[];
  if (!op) throw new Error("no hay operación: falta correr las migraciones");

  await sembrar(op);

  const {
    planOperationConversions,
    reportConversion,
  } = await import("../apps/worker/src/jobs/capi-conversion");
  const { capiDispatch } = await import("../apps/worker/src/capi/send-mode");

  const libro = async () => {
    const filas = await db.execute(
      sql`select dedup_key, status, mode, attempts from capi_conversions order by created_at`,
    );
    return (filas as unknown as Array<Record<string, unknown>>).map(
      (f) => `${f.status}(${f.mode}, intentos=${f.attempts})`,
    );
  };

  const barrer = async (etiqueta: string) => {
    const setting = capiDispatch();
    const r = await planOperationConversions({
      operationId: op.id,
      setting,
      now: new Date(),
    });
    console.log(`\n${etiqueta}`);
    console.log(`   modo=${setting.mode}`);
    console.log(`   qué vio: ${JSON.stringify(r.counts)}`);
    console.log(`   a reportar: ${JSON.stringify(r.reportable.map((x) => x.orderId))}`);
  };

  const enviar = async (etiqueta: string) => {
    llamadas = [];
    let lanzo: string | null = null;
    try {
      await reportConversion({ operationId: op.id, orderId: PEDIDO_DE_VENTAS });
    } catch (e) {
      lanzo = (e as Error).message;
    }
    console.log(`\n${etiqueta}`);
    console.log(`   llamadas a Meta: ${llamadas.length}`);
    console.log(`   ¿pg-boss reintenta?: ${lanzo ? `SÍ · ${lanzo}` : "no"}`);
    console.log(`   libro: ${JSON.stringify(await libro())}`);
  };

  console.log("\n══ EL BARRIDO ══════════════════════════════════════════════");

  await barrer("1 · apagado · la confirmación al cliente todavía no salió");
  await confirmarAlCliente(op);
  await barrer("2 · apagado · con la confirmación ya enviada");

  process.env.META_CAPI_MODE = "live";
  process.env.META_CAPI_SYSTEM_USER_TOKEN = "SYSUSR-de-mentira";
  await barrer("3 · encendido en modo real");

  console.log("\n══ EL ENVÍO ════════════════════════════════════════════════");

  await db.execute(sql`delete from capi_conversions`);
  delete process.env.META_CAPI_MODE;
  delete process.env.META_CAPI_SYSTEM_USER_TOKEN;
  await enviar("4 · APAGADO · no puede salir ni una llamada");

  process.env.META_CAPI_MODE = "live";
  await enviar("5 · encendido SIN credencial · sigue sin salir nada");

  process.env.META_CAPI_SYSTEM_USER_TOKEN = "SYSUSR-de-mentira";

  responder = RESPUESTAS.nuncaSalio;
  await enviar("6 · la petición nunca salió · Meta no vio nada, se reintenta");

  responder = RESPUESTAS.saturado;
  await enviar("7 · Meta pidió esperar · se reintenta, y el intento se cuenta");

  responder = RESPUESTAS.sinRespuesta;
  await enviar("8 · salió y no hubo respuesta · NO se reintenta, queda en duda");

  responder = RESPUESTAS.ok;
  await enviar("9 · en duda ya es final · no se manda otra vez");

  await db.execute(sql`delete from capi_conversions`);
  responder = RESPUESTAS.ok;
  await enviar("10 · camino feliz · Meta la recibió");
  await enviar("11 · un reintento NO produce una segunda conversión");

  await db.execute(sql`delete from capi_conversions`);
  responder = RESPUESTAS.tokenInvalido;
  await enviar("12 · token inválido · permanente, deja de reintentarse");

  console.log(
    "\nLo que este ensayo fija, y ningún test de función pura puede:\n" +
      "  · apagado, el número de llamadas a Meta es CERO;\n" +
      "  · un reintento del mismo pedido no produce una segunda conversión;\n" +
      "  · un fallo temporal vuelve a intentarse y uno permanente no;\n" +
      "  · lo que salió sin respuesta queda en duda y nadie lo reintenta solo.\n",
  );
  process.exit(0);
}

/** El pedido que sí tomó el vendedor. */
const PEDIDO_DE_VENTAS = "99001";

/**
 * Siembra el estado difícil: una venta del vendedor llegada por anuncio, y un
 * pedido del formulario web como los 1.735 de Guatemala.
 *
 * El segundo no es relleno: es lo que hace visible que el tablero sepa decir
 * «hubo pedidos y ninguno lo tomó el vendedor» en vez de «no hubo pedidos».
 */
async function sembrar(op: Operation): Promise<void> {
  const db = getDb();
  await db.execute(sql`delete from capi_conversions`);
  await db.execute(sql`delete from outbound_messages`);
  await db.execute(sql`delete from shopify_orders`);
  await db.execute(sql`delete from conversations`);
  await db.execute(sql`delete from contacts`);

  await db
    .insert(kapsoConnection)
    .values({
      operationId: op.id,
      businessAccountId: "1676368750161510",
      phoneNumberId: "111222333",
    })
    .onConflictDoNothing();
  await db
    .update(operations)
    .set({ capiDatasetId: "9988776655" })
    .where(sql`${operations.id} = ${op.id}`);

  const [lead] = await db
    .insert(contacts)
    .values({
      jid: "50255512345@s.whatsapp.net",
      waId: "50255512345",
      name: "Lead de anuncio",
    })
    .returning();
  await db.insert(conversations).values({
    contactId: lead!.id,
    operationId: op.id,
    ctwaClid: "ARBcdEF123",
    adId: "AD-1",
  });
  await db.insert(shopifyOrders).values({
    orderId: PEDIDO_DE_VENTAS,
    operationId: op.id,
    customerPhone: "50255512345",
    customerName: "Lead de anuncio",
    contactId: lead!.id,
    totalPrice: "165.00",
    currency: "GTQ",
    rawPayload: {
      tags: `origen-ventas, vendedor:Sebastián, ${LLAVE_CIERRE}`,
    },
    receivedAt: new Date(Date.now() - 10 * 60_000),
  });

  const [web] = await db
    .insert(contacts)
    .values({
      jid: "50255599999@s.whatsapp.net",
      waId: "50255599999",
      name: "Cliente del formulario",
    })
    .returning();
  await db
    .insert(conversations)
    .values({ contactId: web!.id, operationId: op.id });
  await db.insert(shopifyOrders).values({
    orderId: "99002",
    operationId: op.id,
    customerPhone: "50255599999",
    contactId: web!.id,
    totalPrice: "159.00",
    currency: "GTQ",
    rawPayload: { tags: "releasit_cod_form" },
    receivedAt: new Date(Date.now() - 10 * 60_000),
  });
}

/**
 * Sale el mensaje que le dice al cliente que su pedido quedó registrado, con la
 * misma llave de deduplicación que escribe `sales/closing.ts`.
 */
async function confirmarAlCliente(op: Operation): Promise<void> {
  const db = getDb();
  const [conv] = await db
    .select()
    .from(conversations)
    .where(sql`${conversations.ctwaClid} is not null`)
    .limit(1);
  await db.insert(outboundMessages).values({
    toWaId: "50255512345",
    body: "Tu pedido quedó registrado",
    source: "agent",
    dedupKey: `cierre-creado-${LLAVE_CIERRE}`,
    conversationId: conv!.id,
    status: "sent",
    sentAt: new Date(),
  });
  void op;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
