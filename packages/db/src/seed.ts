import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { getDb, getRawClient } from "./client";
import { requireSoleActiveOperation } from "./operations";
import {
  users,
  agentSettings,
  waSession,
  templates,
} from "./schema";
import { sql } from "drizzle-orm";

const DEFAULT_SYSTEM_PROMPT = `Eres un asistente de servicio al cliente para una tienda Shopify. Tu objetivo es confirmar pedidos, resolver dudas básicas y, cuando no puedas resolver algo, indicar que un humano responderá pronto. Responde en el idioma del cliente, sé breve y cordial, y nunca inventes información sobre el pedido.`;

async function main() {
  const db = getDb();
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword =
    process.env.SEED_ADMIN_PASSWORD ?? randomBytes(9).toString("base64url");
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await db
    .insert(users)
    .values({
      email: adminEmail,
      passwordHash,
      name: "Admin",
      role: "admin",
    })
    .onConflictDoNothing({ target: users.email });

  await db
    .insert(waSession)
    .values({ id: 1, status: "disconnected" })
    .onConflictDoNothing();

  const [followup] = await db
    .insert(templates)
    .values({
      name: "shopify_followup",
      body: "Hola {{nombre}}, vimos que aún no has confirmado tu pedido. ¿Te gustaría continuar?",
      variables: ["nombre"],
    })
    .onConflictDoNothing({ target: templates.name })
    .returning();

  // La configuración de agente cuelga de una operación desde el contract
  // (ticket 06). En una base recién migrada la operación ya existe: la crea la
  // migración `0020`. Si no hay ninguna, esto falla en vez de sembrar una fila
  // sin dueño — que es justo lo que la `0021` ya no admite.
  const op = await requireSoleActiveOperation();
  await db
    .insert(agentSettings)
    .values({
      id: 1,
      operationId: op.id,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      model: "anthropic/claude-sonnet-4.6",
      debounceMs: 8000,
      followupDelayMs: 5 * 60 * 1000,
      followupTemplateId: followup?.id ?? null,
    })
    .onConflictDoNothing();

  console.log("─────────────────────────────────────────");
  console.log("Seed complete.");
  console.log(`  email:    ${adminEmail}`);
  console.log(`  password: ${adminPassword}`);
  console.log("─────────────────────────────────────────");
  await getRawClient().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Avoid lint warning for unused sql import — used in some adapters.
void sql;
