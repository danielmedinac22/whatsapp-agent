import { generateText, type ModelMessage } from "ai";
import {
  agentRuns,
  agentSettings,
  asc,
  desc,
  eq,
  messages,
  type Contact,
  type Conversation,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { getSocket } from "../baileys/session";
import { openrouter } from "./openrouter";

interface AgentInbound {
  contact: Contact;
  conversation: Conversation;
  body: string;
}

type Buffered = {
  contact: Contact;
  conversation: Conversation;
  bodies: string[];
  timer: NodeJS.Timeout;
};

const buffers = new Map<string, Buffered>();

async function loadSettings() {
  const [row] = await db
    .select()
    .from(agentSettings)
    .where(eq(agentSettings.id, 1))
    .limit(1);
  return row;
}

async function loadHistory(
  conversationId: string,
  limit: number,
): Promise<ModelMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows
    .reverse()
    .filter((m) => m.body)
    .map<ModelMessage>((m) =>
      m.direction === "in"
        ? { role: "user", content: m.body }
        : { role: "assistant", content: m.body },
    );
  void asc; // referenced from index for future ordering
}

async function flushBuffer(contactId: string) {
  const entry = buffers.get(contactId);
  if (!entry) return;
  buffers.delete(contactId);

  const settings = await loadSettings();
  if (!settings) {
    logger.warn("no agent_settings configured, skipping reply");
    return;
  }
  const sock = getSocket();
  if (!sock) {
    logger.warn("no socket, agent reply dropped");
    return;
  }

  const history = await loadHistory(
    entry.conversation.id,
    Math.max(5, settings.memoryWindow ?? 30),
  );

  const prompt: ModelMessage[] = history;

  try {
    const provider = openrouter();
    const result = await generateText({
      model: provider(settings.model),
      system: settings.systemPrompt,
      messages: prompt,
    });

    const reply = result.text.trim();
    if (!reply) {
      logger.warn("model returned empty text");
      return;
    }

    await sock.sendPresenceUpdate("composing", entry.contact.jid).catch(
      () => {},
    );
    await new Promise((r) => setTimeout(r, Math.min(reply.length * 30, 2500)));
    await sock.sendPresenceUpdate("paused", entry.contact.jid).catch(
      () => {},
    );

    await sock.sendMessage(entry.contact.jid, { text: reply });

    // mark stored message as fromAgent — message-handler will persist via fromMe echo
    // ensure persistence even if echo is delayed
    await db.insert(messages).values({
      conversationId: entry.conversation.id,
      direction: "out",
      body: reply,
      status: "sent",
      fromAgent: true,
    });

    await db.insert(agentRuns).values({
      conversationId: entry.conversation.id,
      model: settings.model,
      prompt: prompt as unknown as object,
      response: reply,
      promptTokens: result.usage?.inputTokens ?? null,
      completionTokens: result.usage?.outputTokens ?? null,
    });
  } catch (err) {
    logger.error({ err }, "agent generateText failed");
    await db.insert(agentRuns).values({
      conversationId: entry.conversation.id,
      model: settings.model,
      prompt: [] as unknown as object,
      response: "",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function onAgentInbound(input: AgentInbound) {
  const settings = await loadSettings();
  const debounceMs = Math.max(0, settings?.debounceMs ?? 8000);

  const existing = buffers.get(input.contact.id);
  if (existing) {
    clearTimeout(existing.timer);
    existing.bodies.push(input.body);
    existing.timer = setTimeout(
      () => flushBuffer(input.contact.id),
      debounceMs,
    );
    return;
  }

  const entry: Buffered = {
    contact: input.contact,
    conversation: input.conversation,
    bodies: [input.body],
    timer: setTimeout(() => flushBuffer(input.contact.id), debounceMs),
  };
  buffers.set(input.contact.id, entry);
}
