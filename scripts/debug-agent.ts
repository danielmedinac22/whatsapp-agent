import {
  getDb,
  getRawClient,
  contacts,
  conversations,
  messages,
  agentRuns,
  desc,
  eq,
} from "@wa/db";

async function main() {
  const db = getDb();

  console.log("\n=== contacts (last 10 by lastMessageAt) ===");
  const cs = await db
    .select()
    .from(contacts)
    .orderBy(desc(contacts.lastMessageAt))
    .limit(10);
  for (const c of cs) {
    console.log(
      `${c.jid}  agent_mode=${c.agentMode}  last=${c.lastMessageAt?.toISOString() ?? "—"}  name=${c.name ?? c.pushName ?? "—"}`,
    );
  }

  console.log("\n=== messages (last 15) ===");
  const ms = await db
    .select()
    .from(messages)
    .orderBy(desc(messages.createdAt))
    .limit(15);
  for (const m of ms) {
    console.log(
      `[${m.createdAt.toISOString()}] ${m.direction}  fromAgent=${m.fromAgent}  body=${JSON.stringify(m.body.slice(0, 80))}`,
    );
  }

  console.log("\n=== agent_runs (last 10) ===");
  const ar = await db
    .select()
    .from(agentRuns)
    .orderBy(desc(agentRuns.createdAt))
    .limit(10);
  if (ar.length === 0) console.log("(empty)");
  for (const a of ar) {
    console.log(
      `[${a.createdAt.toISOString()}] model=${a.model}  err=${a.error ?? "none"}  reply=${JSON.stringify(a.response.slice(0, 80))}`,
    );
  }

  console.log("\n=== conversations (last 5) ===");
  const cv = await db
    .select()
    .from(conversations)
    .orderBy(
      desc(conversations.lastInboundAt),
    )
    .limit(5);
  for (const c of cv) {
    console.log(
      `id=${c.id}  contact=${c.contactId}  unread=${c.unreadCount}  last_in=${c.lastInboundAt?.toISOString() ?? "—"}  preview=${c.lastMessagePreview ?? "—"}`,
    );
  }

  await getRawClient().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
