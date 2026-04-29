import bcrypt from "bcryptjs";
import { getDb, getRawClient, users, eq } from "@wa/db";

async function main() {
  const email = process.env.USER_EMAIL?.trim().toLowerCase();
  const password = process.env.USER_PASSWORD;
  const name = process.env.USER_NAME ?? null;
  const roleRaw = process.env.USER_ROLE ?? "operator";

  if (!email) throw new Error("USER_EMAIL requerido");
  if (!password) throw new Error("USER_PASSWORD requerido");
  if (roleRaw !== "admin" && roleRaw !== "operator") {
    throw new Error(`USER_ROLE inválido: ${roleRaw} (admin | operator)`);
  }
  const role = roleRaw as "admin" | "operator";

  const db = getDb();
  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing[0]) {
    await db
      .update(users)
      .set({ passwordHash, name, role })
      .where(eq(users.id, existing[0].id));
    console.log(`Usuario actualizado: ${email} (${role})`);
  } else {
    await db.insert(users).values({ email, passwordHash, name, role });
    console.log(`Usuario creado: ${email} (${role})`);
  }

  await getRawClient().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
