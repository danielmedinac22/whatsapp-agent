import { getDb, getRawClient, users } from "@wa/db";

async function main() {
  const db = getDb();
  const rows = await db
    .select({ email: users.email, role: users.role, name: users.name })
    .from(users);
  console.table(rows);
  await getRawClient().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
