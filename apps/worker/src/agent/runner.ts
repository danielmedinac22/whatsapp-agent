import { createHash } from "node:crypto";
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
import { contactWaId } from "../lib/phone";
import { enqueueOutbound } from "../jobs/outbound";
import { openrouter } from "./openrouter";
import { buildDropiContextBlock } from "./dropi-context";
import { buildShopifyContextBlock } from "./shopify-context";

function shortHash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 12);
}

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

/**
 * Prompt que realmente recibe el modelo: el prompt configurable del dashboard
 * más los bloques de contexto que se inyectan solos (Shopify, Dropi).
 * Lo usan tanto el runner de producción como el banco de pruebas de /agent,
 * para que lo que se prueba sea idéntico a lo que se envía.
 */
export async function buildEffectiveSystemPrompt(
  basePrompt: string,
  contactId: string | null,
): Promise<string> {
  let systemPrompt = basePrompt;
  if (!contactId) return systemPrompt;

  try {
    const ctx = await buildShopifyContextBlock(contactId);
    if (ctx) systemPrompt = `${systemPrompt}\n\n${ctx}`;
  } catch (err) {
    logger.warn({ err }, "shopify context build failed; continuing without it");
  }

  try {
    const ctx = await buildDropiContextBlock(contactId);
    if (ctx) systemPrompt = `${systemPrompt}\n\n${ctx}`;
  } catch (err) {
    logger.warn({ err }, "dropi context build failed; continuing without it");
  }

  return systemPrompt;
}

export async function loadHistory(
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

  const history = await loadHistory(
    entry.conversation.id,
    Math.max(5, settings.memoryWindow ?? 30),
  );

  const prompt: ModelMessage[] = history;

  const systemPrompt = await buildEffectiveSystemPrompt(
    settings.systemPrompt,
    entry.contact.id,
  );

  try {
    const provider = openrouter();
    const result = await generateText({
      model: provider(settings.model),
      system: systemPrompt,
      messages: prompt,
    });

    const reply = result.text.trim();
    if (!reply) {
      logger.warn("model returned empty text");
      return;
    }

    const to = contactWaId(entry.contact);
    if (!to) {
      logger.warn(
        { contactId: entry.contact.id },
        "agent: contact has no wa_id, cannot send",
      );
      return;
    }
    await enqueueOutbound({
      to,
      body: reply,
      source: "agent",
      sourceRef: entry.conversation.id,
      dedupKey: `agent:${entry.conversation.id}:${shortHash(reply)}`,
      conversationId: entry.conversation.id,
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
