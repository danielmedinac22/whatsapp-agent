import { getRawClient } from "@wa/db";

const PG_BOSS_QUEUES = [
  "shopify-followup",
  "shopify-remarketing",
  "outbound-send",
];

function describeDbUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return "<invalid DATABASE_URL>";
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL requerido");

  const target = describeDbUrl(dbUrl);

  console.log("─────────────────────────────────────────");
  console.log("  RESET DE DATOS — operación destructiva");
  console.log(`  target: ${target}`);
  console.log("─────────────────────────────────────────");

  if (process.env.CONFIRM_RESET !== "YES_WIPE_PROD") {
    console.error(
      "\nAbortado: para confirmar exporta CONFIRM_RESET=YES_WIPE_PROD\n",
    );
    process.exit(1);
  }

  const sql = getRawClient();

  await sql.begin(async (tx) => {
    // 1. Vaciar tablas transaccionales (cascada limpia conversations, messages, agent_runs)
    await tx.unsafe(
      `TRUNCATE TABLE shopify_orders, outbound_messages, contacts RESTART IDENTITY CASCADE`,
    );

    // 2. Reset sesión Baileys
    await tx.unsafe(
      `UPDATE wa_session
         SET auth_state = NULL,
             qr = NULL,
             phone = NULL,
             last_connected_at = NULL,
             status = 'disconnected',
             updated_at = now()
       WHERE id = 1`,
    );

    // 3. Purgar pg-boss (si la tabla existe)
    const [{ exists }] = await tx.unsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('pgboss.job') IS NOT NULL AS exists`,
    );
    if (exists) {
      const placeholders = PG_BOSS_QUEUES.map((_, i) => `$${i + 1}`).join(",");
      await tx.unsafe(
        `DELETE FROM pgboss.job WHERE name IN (${placeholders})`,
        PG_BOSS_QUEUES,
      );
      const [{ exists: archiveExists }] = await tx.unsafe<{ exists: boolean }[]>(
        `SELECT to_regclass('pgboss.archive') IS NOT NULL AS exists`,
      );
      if (archiveExists) {
        await tx.unsafe(
          `DELETE FROM pgboss.archive WHERE name IN (${placeholders})`,
          PG_BOSS_QUEUES,
        );
      }
    }
  });

  // 4. Reporte de conteos finales
  const wiped = [
    "shopify_orders",
    "contacts",
    "conversations",
    "messages",
    "outbound_messages",
    "agent_runs",
  ];
  const kept = ["users", "templates", "agent_settings", "wa_session"];

  console.log("\nTablas vaciadas:");
  for (const t of wiped) {
    const [{ count }] = await sql.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM ${t}`,
    );
    console.log(`  ${t.padEnd(22)} ${count}`);
  }

  console.log("\nTablas conservadas:");
  for (const t of kept) {
    const [{ count }] = await sql.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM ${t}`,
    );
    console.log(`  ${t.padEnd(22)} ${count}`);
  }

  console.log("\nReset completo. Recuerda reiniciar el worker para emitir QR nuevo.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
