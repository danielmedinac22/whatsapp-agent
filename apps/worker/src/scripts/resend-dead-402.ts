import PgBoss from "pg-boss";
import { and, asc, eq, getDb, ilike, outboundMessages } from "@wa/db";

/**
 * Reencola los envíos que murieron por el 402 de Kapso ("Free plan message
 * limit reached") el 2026-08-04. El outbound worker los marcó `dead`
 * (permanente) y NO se reintentan solos; este script los devuelve a `pending`
 * y crea el job de pg-boss para que el worker de Railway los dispare.
 *
 * Exclusiones:
 *  - dropi_2fa: el código ya venció; el refresh de auth pide uno nuevo solo.
 *  - Duplicados exactos (mismo destino + mismo texto): se reenvía solo el
 *    primero — el asesor dio dos veces "enviar" mientras Kapso rechazaba.
 *
 * Uso (desde apps/worker):
 *   pnpm exec tsx src/scripts/resend-dead-402.ts          # dry-run
 *   pnpm exec tsx src/scripts/resend-dead-402.ts --send   # reencolar de verdad
 */

const OUTBOUND_QUEUE = "outbound-send";
/** Segundos entre un envío y el siguiente, para no salir en ráfaga. */
const STAGGER_S = 5;

async function main() {
  const send = process.argv.includes("--send");
  const db = getDb();

  const rows = await db
    .select()
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.status, "dead"),
        ilike(outboundMessages.lastError, "%Free plan message limit%"),
      ),
    )
    .orderBy(asc(outboundMessages.createdAt));

  const seen = new Set<string>();
  const toResend: typeof rows = [];
  const skipped: Array<{ row: (typeof rows)[number]; reason: string }> = [];

  for (const row of rows) {
    if (row.source === "dropi_2fa") {
      skipped.push({ row, reason: "código 2FA vencido" });
      continue;
    }
    const key = `${row.toWaId}|${row.body}`;
    if (seen.has(key)) {
      skipped.push({ row, reason: "duplicado exacto" });
      continue;
    }
    seen.add(key);
    toResend.push(row);
  }

  console.log(`Muertos por 402: ${rows.length}`);
  console.log(`A reenviar: ${toResend.length} — Omitidos: ${skipped.length}\n`);
  for (const row of toResend) {
    console.log(
      `  ✓ ${row.toWaId}  [${row.source}]  ${row.templateName ?? "texto libre"}  ${row.body.slice(0, 60).replace(/\n/g, " ")}`,
    );
  }
  for (const { row, reason } of skipped) {
    console.log(`  ✗ ${row.toWaId}  [${row.source}]  omitido: ${reason}`);
  }

  if (!send) {
    console.log("\nDry-run: nada se reencoló. Corre con --send para dispararlos.");
    process.exit(0);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const boss = new PgBoss({ connectionString: url, schema: "pgboss" });
  boss.on("error", (err) => console.error("pg-boss error", err));
  await boss.start();

  let fired = 0;
  for (const [i, row] of toResend.entries()) {
    // Volver a `pending` ANTES de encolar: el guard de idempotencia del worker
    // ignora filas `dead`. El filtro por status evita repetir si el script se
    // corre dos veces.
    const updated = await db
      .update(outboundMessages)
      .set({ status: "pending", scheduledFor: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(outboundMessages.id, row.id),
          eq(outboundMessages.status, "dead"),
        ),
      )
      .returning({ id: outboundMessages.id });
    if (updated.length === 0) {
      console.log(`  – ${row.toWaId} ya no está dead, no se reencola`);
      continue;
    }
    await boss.send(
      OUTBOUND_QUEUE,
      { outboundId: row.id },
      {
        singletonKey: row.dedupKey,
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
        startAfter: i * STAGGER_S,
      },
    );
    fired += 1;
    console.log(`  → ${row.toWaId} reencolado (sale en ~${i * STAGGER_S}s)`);
  }

  console.log(`\nReencolados: ${fired}. El worker de Railway los envía solo.`);
  await boss.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
