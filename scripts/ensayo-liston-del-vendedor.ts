/**
 * Ensayo del listón del vendedor y la línea de corte, contra una base
 * **desechable**. Corre el camino entero, no las funciones puras: la suite ya
 * prueba `resolveInbox` con fixtures, y lo que esta clase de ticket rompe está
 * en otro lado —qué queda escrito en la fila, y si se re-escribe—.
 *
 * Lo que ejercita, en orden:
 *
 *  1. Producción de hoy: una fila con `display_name` vacío. Leerla **no** puede
 *     estampar nada, y la bandeja de ventas tiene que dar cero.
 *  2. Encender al vendedor **por SQL** —sin pasar por el panel—, que es el caso
 *     que el respaldo perezoso existe para cubrir: la primera lectura estampa
 *     `activated_at`, y la segunda **no lo mueve**.
 *  3. Que lo histórico se quede con Katherine y solo lo nacido después caiga en
 *     ventas.
 *  4. El guardado del panel: que estampe al encender, que no re-estampe al
 *     volver a guardar, y que **borrar el nombre no borre la fecha**.
 *
 * Se levanta así, y se borra al terminar:
 *
 *     docker run -d --name wa-liston -e POSTGRES_PASSWORD=test \
 *       -e POSTGRES_DB=wa -p 55994:5432 postgres:16-alpine
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55994/wa" \
 *       pnpm --filter @wa/db migrate
 *     DATABASE_URL="postgres://postgres:test@127.0.0.1:55994/wa" ENSAYAR=si \
 *       npx tsx scripts/ensayo-liston-del-vendedor.ts
 *     docker rm -f wa-liston
 */

import {
  contacts,
  conversations,
  eq,
  getDb,
  getSalesAgentSettings,
  operations,
  resolveInbox,
  salesAgentIsConfigured,
  salesAgentSettings,
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

let fallos = 0;

function afirmar(que: string, ok: boolean, detalle?: string): void {
  if (ok) {
    console.log(`  ✓ ${que}`);
  } else {
    fallos += 1;
    console.log(`  ✗ ${que}${detalle ? ` — ${detalle}` : ""}`);
  }
}

const hace = (dias: number): Date =>
  new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL requerido");
  const host = hostDe(url);
  if (PROHIBIDOS.some((p) => host.includes(p))) {
    console.error(
      `\n  ${host} es producción. Este ensayo escribe filas y no corre ahí.\n`,
    );
    process.exit(1);
  }
  if (process.env.ENSAYAR !== "si") {
    console.error(
      `\n  Va a escribir contactos, conversaciones y configuración en ${host}.\n` +
        `  Volvé a correrlo con ENSAYAR=si si es la base de ensayo.\n`,
    );
    process.exit(1);
  }

  const db = getDb();
  const [op] = (await db.select().from(operations)) as Operation[];
  if (!op) throw new Error("no hay operación: falta correr las migraciones");

  // ── Estado de producción hoy: la fila existe y está vacía ────────────────
  await db.delete(salesAgentSettings).where(eq(salesAgentSettings.operationId, op.id));
  await db.insert(salesAgentSettings).values({ operationId: op.id });

  // Cinco conversaciones sin ningún pedido, como las 110 de Guatemala.
  const viejas: { id: string; bornAt: Date }[] = [];
  for (let i = 0; i < 5; i += 1) {
    const nacida = hace(40 - i);
    const [contacto] = await db
      .insert(contacts)
      .values({
        jid: `5020000000${i}@s.whatsapp.net`,
        waId: `5020000000${i}`,
        agentMode: false,
        createdAt: nacida,
      })
      .returning();
    const [conv] = await db
      .insert(conversations)
      .values({
        contactId: contacto!.id,
        operationId: op.id,
        createdAt: nacida,
      })
      .returning();
    viejas.push({ id: conv!.id, bornAt: conv!.createdAt });
  }

  console.log("\n1 · Producción hoy: la fila existe, el nombre está vacío");
  const apagado = await getSalesAgentSettings(op);
  afirmar("la fila existe", apagado !== null);
  afirmar("y aun así NO hay vendedor", !salesAgentIsConfigured(apagado));
  afirmar(
    "leerla no estampó la línea de corte",
    apagado?.activatedAt === null,
    `activated_at = ${String(apagado?.activatedAt)}`,
  );
  const bandejasApagado = viejas.map(
    (c) =>
      resolveInbox(
        { lastAdClickAt: null, orders: [] },
        { activatedAt: apagado?.activatedAt ?? null, bornAt: c.bornAt },
      ).inbox,
  );
  afirmar(
    "la bandeja de ventas da 0 sobre las 5 conversaciones sin pedido",
    bandejasApagado.every((b) => b === "operaciones"),
    bandejasApagado.join(", "),
  );

  console.log("\n2 · El respaldo perezoso: encender por SQL, sin pasar por el panel");
  await db
    .update(salesAgentSettings)
    .set({ displayName: "Sebastián" })
    .where(eq(salesAgentSettings.operationId, op.id));
  const antesDeLeer = await db
    .select({ activatedAt: salesAgentSettings.activatedAt })
    .from(salesAgentSettings)
    .where(eq(salesAgentSettings.operationId, op.id));
  afirmar(
    "escribir el nombre por SQL deja activated_at en null",
    antesDeLeer[0]?.activatedAt === null,
  );

  const primera = await getSalesAgentSettings(op);
  afirmar("la primera lectura estampa la línea de corte", primera?.activatedAt !== null);
  const estampada = primera!.activatedAt!;

  // Una segunda lectura, y una tercera, para que «una sola vez» no sea una
  // frase del comentario: si el `where activated_at is null` no estuviera, cada
  // carga del panel movería la fecha hacia adelante y la bandeja de ventas se
  // vaciaría sola.
  const segunda = await getSalesAgentSettings(op);
  const tercera = await getSalesAgentSettings(op);
  afirmar(
    "la segunda lectura NO la re-escribe",
    segunda?.activatedAt?.getTime() === estampada.getTime(),
    `${String(segunda?.activatedAt)} vs ${String(estampada)}`,
  );
  afirmar(
    "la tercera tampoco",
    tercera?.activatedAt?.getTime() === estampada.getTime(),
  );

  console.log("\n3 · Lo histórico se queda con Katherine");
  const bandejasEncendido = viejas.map(
    (c) =>
      resolveInbox(
        { lastAdClickAt: null, orders: [] },
        { activatedAt: estampada, bornAt: c.bornAt },
      ).inbox,
  );
  afirmar(
    "las 5 conversaciones viejas siguen en operaciones tras encender al vendedor",
    bandejasEncendido.every((b) => b === "operaciones"),
    bandejasEncendido.join(", "),
  );
  const nacidaDespues = resolveInbox(
    { lastAdClickAt: null, orders: [] },
    { activatedAt: estampada, bornAt: new Date(estampada.getTime() + 1000) },
  );
  afirmar(
    "una conversación nacida después sí es del vendedor",
    nacidaDespues.inbox === "ventas" && nacidaDespues.rule === "born_after_activation",
    JSON.stringify(nacidaDespues),
  );

  console.log("\n4 · El guardado del panel (el mismo upsert de saveVendedorSettings)");
  // Se arranca de cero para ver el `INSERT`, que es el caso de producción: la
  // primera vez que alguien abra `/vendedor` y guarde con nombre.
  await db.delete(salesAgentSettings).where(eq(salesAgentSettings.operationId, op.id));

  const guardar = async (displayName: string) => {
    const fields = { displayName: displayName.trim() };
    const encendido = salesAgentIsConfigured(fields);
    await db
      .insert(salesAgentSettings)
      .values({
        operationId: op.id,
        ...fields,
        activatedAt: encendido ? sql`now()` : null,
      })
      .onConflictDoUpdate({
        target: salesAgentSettings.operationId,
        set: {
          ...fields,
          updatedAt: new Date(),
          ...(encendido
            ? {
                activatedAt: sql`coalesce(${salesAgentSettings.activatedAt}, now())`,
              }
            : {}),
        },
      });
    const [row] = await db
      .select()
      .from(salesAgentSettings)
      .where(eq(salesAgentSettings.operationId, op.id));
    return row!;
  };

  const borrador = await guardar("");
  afirmar(
    "guardar la pantalla a medio llenar no enciende nada",
    borrador.activatedAt === null && !salesAgentIsConfigured(borrador),
  );

  const encendida = await guardar("Sebastián");
  afirmar("escribir un nombre estampa la fecha", encendida.activatedAt !== null);
  const primeraFecha = encendida.activatedAt!;

  await new Promise((r) => setTimeout(r, 50));
  const reguardada = await guardar("Sebastián Ruiz");
  afirmar(
    "volver a guardar con otro nombre NO mueve la fecha",
    reguardada.activatedAt?.getTime() === primeraFecha.getTime(),
    `${String(reguardada.activatedAt)} vs ${String(primeraFecha)}`,
  );

  const apagadaOtraVez = await guardar("");
  afirmar(
    "borrar el nombre apaga al vendedor pero NO borra la línea de corte",
    !salesAgentIsConfigured(apagadaOtraVez) &&
      apagadaOtraVez.activatedAt?.getTime() === primeraFecha.getTime(),
    `activated_at = ${String(apagadaOtraVez.activatedAt)}`,
  );

  await new Promise((r) => setTimeout(r, 50));
  const reencendida = await guardar("Sebastián");
  afirmar(
    "y volver a encenderlo tampoco: la fecha sigue siendo la del primer encendido",
    reencendida.activatedAt?.getTime() === primeraFecha.getTime(),
    `${String(reencendida.activatedAt)} vs ${String(primeraFecha)}`,
  );

  console.log(
    fallos === 0
      ? "\n  Todo el ensayo pasó.\n"
      : `\n  ${fallos} afirmación(es) fallaron.\n`,
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
