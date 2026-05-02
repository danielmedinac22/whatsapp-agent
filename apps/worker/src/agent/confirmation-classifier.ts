import { generateText } from "ai";
import { conversations, desc, eq, messages } from "@wa/db";
import { db } from "../db";
import { events } from "../lib/events";
import { logger } from "../lib/logger";
import { openrouter } from "./openrouter";

const CLASSIFIER_MODEL = "anthropic/claude-haiku-4.5";
const HISTORY_WINDOW = 8;
const DEBOUNCE_MS = 6000;

type Status = "confirmed" | "not_confirmed" | "pending";

interface Buffered {
  conversationId: string;
  contactId: string;
  timer: NodeJS.Timeout;
}

const buffers = new Map<string, Buffered>();

const SYSTEM_PROMPT = `Eres un clasificador. Lee el final de una conversación entre un negocio y un cliente sobre un pedido. Responde UNA SOLA palabra:
- confirmed: el cliente confirma explícitamente que sí quiere el pedido o ya lo recibió.
- not_confirmed: el cliente dice que no quiere, lo cancela, lo rechaza, o niega haber comprado.
- pending: cualquier otra cosa (preguntas, dudas, off-topic, sin información suficiente).

No expliques, sólo la palabra.`;

function parseStatus(text: string): Status {
  const t = text.trim().toLowerCase();
  if (t.startsWith("confirmed")) return "confirmed";
  if (t.startsWith("not_confirmed") || t.startsWith("not-confirmed"))
    return "not_confirmed";
  return "pending";
}

async function loadRecent(conversationId: string): Promise<string> {
  const rows = await db
    .select({
      direction: messages.direction,
      body: messages.body,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(HISTORY_WINDOW);
  return rows
    .reverse()
    .filter((m) => m.body)
    .map((m) => `${m.direction === "in" ? "Cliente" : "Negocio"}: ${m.body}`)
    .join("\n");
}

async function runClassifier(conversationId: string, contactId: string) {
  buffers.delete(conversationId);

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv) return;

  if (conv.confirmationSource === "manual") return;

  const transcript = await loadRecent(conversationId);
  if (!transcript) return;

  let status: Status = "pending";
  try {
    const provider = openrouter();
    const result = await generateText({
      model: provider(CLASSIFIER_MODEL),
      system: SYSTEM_PROMPT,
      prompt: transcript,
      maxOutputTokens: 8,
    });
    status = parseStatus(result.text);
  } catch (err) {
    logger.warn({ err, conversationId }, "confirmation classifier failed");
    return;
  }

  if (conv.confirmationStatus === status) return;

  await db
    .update(conversations)
    .set({
      confirmationStatus: status,
      confirmationSource: "auto",
      confirmationUpdatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));

  events.emitEvent({ type: "conversation.updated", conversationId });
  void contactId;
}

export function scheduleConfirmationClassify(input: {
  conversationId: string;
  contactId: string;
}) {
  const existing = buffers.get(input.conversationId);
  if (existing) clearTimeout(existing.timer);
  const entry: Buffered = {
    conversationId: input.conversationId,
    contactId: input.contactId,
    timer: setTimeout(
      () =>
        runClassifier(input.conversationId, input.contactId).catch((err) =>
          logger.error({ err }, "classifier run failed"),
        ),
      DEBOUNCE_MS,
    ),
  };
  buffers.set(input.conversationId, entry);
}
