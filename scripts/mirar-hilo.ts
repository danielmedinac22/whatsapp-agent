/**
 * Los últimos mensajes de una conversación, tal como quedaron guardados.
 * Solo lee. Se le pasa el wa_id por argumento.
 */
import { getDb } from "@wa/db";
import { sql } from "drizzle-orm";

if (process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

async function main() {
  const waId = process.argv[2];
  if (!waId) throw new Error("uso: mirar-hilo.ts <wa_id>");
  const db = getDb();

  const crudo = (await db.execute(sql`
    select (m.created_at at time zone 'America/Guatemala') as cuando,
           m.direction, m.from_agent, m.sent_by_user_id is not null as de_persona,
           m.status, left(m.body, 150) as texto
    from messages m
    join conversations c on c.id = m.conversation_id
    join contacts ct on ct.id = c.contact_id
    where ct.wa_id = ${waId}
    order by m.created_at desc
    limit 14
  `)) as unknown as unknown[] | { rows: unknown[] };
  const rows = Array.isArray(crudo) ? crudo : crudo.rows;
  console.log(JSON.stringify(rows.reverse(), null, 1));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
