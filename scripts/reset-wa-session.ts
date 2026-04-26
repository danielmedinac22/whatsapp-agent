import { getDb, getRawClient, waSession, eq } from "@wa/db";

async function main() {
  const db = getDb();
  await db
    .update(waSession)
    .set({
      authState: null,
      qr: null,
      phone: null,
      status: "disconnected",
      updatedAt: new Date(),
    })
    .where(eq(waSession.id, 1));
  console.log("wa_session reset");
  await getRawClient().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
