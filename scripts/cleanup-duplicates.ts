import { getDb, getRawClient, sql } from "@wa/db";

async function main() {
  const db = getDb();
  // Delete agent-sent rows that have NULL wa_id when there's a sibling row
  // (same conversation, body, direction='out') with a non-null wa_id created
  // within ±10 seconds. These are the historical duplicates from the bug.
  const result = await db.execute(sql`
    DELETE FROM messages m1
    WHERE m1.direction = 'out'
      AND m1.from_agent = true
      AND m1.wa_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM messages m2
        WHERE m2.conversation_id = m1.conversation_id
          AND m2.direction = 'out'
          AND m2.body = m1.body
          AND m2.wa_id IS NOT NULL
          AND ABS(EXTRACT(EPOCH FROM (m2.created_at - m1.created_at))) < 10
      )
    RETURNING id;
  `);
  console.log(`deleted ${(result as unknown as { rowCount?: number }).rowCount ?? "?"} duplicates`);
  await getRawClient().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
