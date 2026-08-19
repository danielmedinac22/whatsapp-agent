/**
 * Deja el libro de conversiones de una base **de ensayo** con el estado difícil
 * del reporte a Meta, para poder mirar la pantalla de `/reporte-meta` llena.
 *
 * ## Por qué existe
 *
 * Es el hallazgo registrado del proyecto aplicado a un tablero: **el estado
 * vacío aprueba por la razón equivocada**. Hoy `capi_conversions` tiene cero
 * filas en producción y la pantalla se ve impecable — un veredicto, unos ceros,
 * ninguna lista. Lo que hay que mirar es lo otro: si con conversiones trabadas
 * de las dos clases se entiende **que esperan a una persona y no que el sistema
 * está roto**, y si queda claro que las que pidieron turno no se reintentan a
 * propósito.
 *
 * Siembra las dos clases porque **no son lo mismo y el ticket lo subraya**:
 *
 *   · `pending` vieja — una venta que Meta **nunca supo**. El proceso se murió
 *     entre pedir el turno y llamar. No se reintenta sola: no se sabe si la
 *     petición salió.
 *   · `unconfirmed` — una venta que **quizá sí** llegó. La petición salió y no
 *     hubo respuesta, y lo único que puede decirlo es el administrador de
 *     eventos de Meta.
 *
 * Y siembra además una `pending` **reciente**, que NO tiene que aparecer en la
 * lista: es un envío en curso, no un caso trabado. Sin ella, la pantalla
 * aprobaría sin haber probado el corte de la hora.
 *
 * **No le habla a Meta ni a nadie**: escribe filas y nada más.
 *
 *     docker run -d --name wa-ensayo-capi -e POSTGRES_PASSWORD=test \
 *       -e POSTGRES_DB=wa -p 55998:5432 postgres:16-alpine
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55998/wa" \
 *       pnpm --filter @wa/db migrate
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55998/wa" SEMBRAR=si \
 *       npx tsx scripts/seed-capi-estado-ensayo.ts
 */
import { getDb, operations, sql, type Operation } from "@wa/db";

/** Hosts que son producción. Contra estos no se siembra nada, nunca. */
const PROHIBIDOS = ["rlwy.net", "railway.app"];

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<DATABASE_URL inválida>";
  }
}

/** El dataset de la cuenta de WhatsApp. **No es el píxel.** */
const DATASET = "1122334455667788";

const HORA = 3_600_000;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL requerido");
  const host = hostDe(url);

  if (PROHIBIDOS.some((p) => host.includes(p))) {
    console.error(
      `\n  ${host} es producción. Este script no siembra ahí.\n` +
        `  El libro de conversiones es lo único que impide que una venta se le\n` +
        `  reporte dos veces a Meta: filas inventadas ahí consumirían el turno\n` +
        `  de ventas reales, que entonces nunca llegarían al dataset.\n`,
    );
    process.exit(1);
  }
  if (process.env.SEMBRAR !== "si") {
    console.error(
      `\n  Va a escribir conversiones de mentira en ${host}.\n` +
        `  Volvé a correrlo con SEMBRAR=si si es la base de ensayo.\n`,
    );
    process.exit(1);
  }

  const db = getDb();
  const [op] = (await db.select().from(operations)) as Operation[];
  if (!op) throw new Error("no hay operación: falta correr las migraciones");

  // El destino configurado, para que la pantalla muestre el caso «hay dataset»
  // además del de hoy. Es de la cuenta de WhatsApp, no del píxel.
  await db.execute(
    sql`update operations set capi_dataset_id = ${DATASET} where id = ${op.id}`,
  );

  await db.execute(sql`delete from capi_conversions`);

  const ahora = Date.now();
  const fila = async (f: {
    pedido: string;
    status: string;
    valor: string;
    haceHoras: number;
    intentos: number;
    error?: string;
    modo?: string;
  }) => {
    const creado = new Date(ahora - f.haceHoras * HORA);
    await db.execute(sql`
      insert into capi_conversions
        (operation_id, dedup_key, order_id, dataset_id, mode, status, value,
         currency, event_time, attempts, last_error, created_at, updated_at, sent_at)
      values
        (${op.id}, ${`purchase:${op.id}:${f.pedido}`}, ${f.pedido}, ${DATASET},
         ${f.modo ?? "live"}, ${f.status}, ${f.valor}, ${op.currency},
         ${creado.toISOString()}, ${f.intentos}, ${f.error ?? null},
         ${creado.toISOString()}, ${creado.toISOString()},
         ${f.status === "sent" ? creado.toISOString() : null})
    `);
  };

  // Dos que llegaron: sin ellas, «fallando» se leería como «nada funciona».
  await fila({ pedido: "99101", status: "sent", valor: "399.00", haceHoras: 30, intentos: 1 });
  await fila({ pedido: "99102", status: "sent", valor: "690.00", haceHoras: 12, intentos: 2 });

  // Una que Meta rechazó de forma permanente.
  await fila({
    pedido: "99103",
    status: "failed",
    valor: "449.50",
    haceHoras: 20,
    intentos: 6,
    error: "Meta rechazó el evento: Invalid parameter (code 100)",
  });

  // Dos en duda: la petición salió y nunca llegó respuesta. Son las que se
  // buscan en el administrador de eventos con dataset, momento y valor.
  await fila({
    pedido: "99104",
    status: "unconfirmed",
    valor: "520.00",
    haceHoras: 8,
    intentos: 1,
    error: "la petición salió y no hubo respuesta (timeout)",
  });
  await fila({
    pedido: "99105",
    status: "unconfirmed",
    valor: "1250.00",
    haceHoras: 3,
    intentos: 1,
    error: "la petición salió y se cortó la conexión esperando",
  });

  // Dos que pidieron turno y quedaron ahí: el worker se reinició en el medio.
  await fila({ pedido: "99106", status: "pending", valor: "399.00", haceHoras: 26, intentos: 1 });
  await fila({ pedido: "99107", status: "pending", valor: "690.00", haceHoras: 5, intentos: 3 });

  // **Y una reciente que NO tiene que aparecer en la lista**: es un envío en
  // curso, no un caso trabado. El corte es una hora.
  await fila({ pedido: "99108", status: "pending", valor: "349.00", haceHoras: 0, intentos: 1 });

  console.log(`\n  Libro de conversiones de ensayo cargado en ${host} (${op.countryCode}).`);
  console.log(`  dataset ${DATASET} configurado en la operación`);
  console.log("  2 llegaron · 1 rechazada · 2 en duda · 3 pidiendo turno");
  console.log(
    "  De las 3 que piden turno, SOLO 2 son viejas: la tercera es de hace un minuto",
  );
  console.log("  y no tiene que salir en la lista de casos que esperan a una persona.\n");
  console.log("  Para verlo en el panel, ver scripts/estado-capi-ensayo.ts.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
