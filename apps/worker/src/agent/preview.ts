import { generateText, type ModelMessage } from "ai";
import {
  conversations,
  eq,
  getAgentSettings,
  requireOperationOrSole,
} from "@wa/db";
import { db } from "../db";
import { openrouter } from "./openrouter";
import { buildEffectiveSystemPrompt } from "./effective-prompt";
import { loadHistory } from "./runner";

export interface PreviewInput {
  prompt: string;
  model: string;
  message: string;
  /** Conversación real de la que tomar historial y contexto (opcional). */
  conversationId?: string | null;
}

export interface PreviewResult {
  reply: string;
  /** El prompt completo que recibió el modelo, bloques automáticos incluidos. */
  effectiveSystemPrompt: string;
  history: { role: "user" | "assistant"; content: string }[];
  usedConversation: boolean;
}

/**
 * Corre el agente con un prompt borrador y devuelve la respuesta, sin tocar
 * WhatsApp ni la base: no encola outbound, no escribe en agent_runs y no
 * modifica agent_settings. Es el "probar antes de guardar" del dashboard.
 */
export async function previewAgentReply(
  input: PreviewInput,
): Promise<PreviewResult> {
  let contactId: string | null = null;
  let history: ModelMessage[] = [];

  if (input.conversationId) {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1);
    if (conv) {
      contactId = conv.contactId;
      // La ventana de memoria sale de la configuración de la operación dueña
      // de esa conversación: probar el prompt sobre un chat guatemalteco debe
      // usar los parámetros de Guatemala. Sin conversación no hay operación de
      // la que hablar, y tampoco hay historial que recortar.
      const settings = await getAgentSettings(
        await requireOperationOrSole(conv.operationId),
      );
      history = await loadHistory(
        conv.id,
        Math.max(5, settings?.memoryWindow ?? 30),
      );
    }
  }

  // El banco de pruebas es el del agente de confirmación: prueba borradores de
  // `agent_settings.system_prompt`, que es un campo de texto que el admin
  // escribe. El del vendedor no se compone de un prompt sino de campos —nombre,
  // tono, mensajes base—, así que probarlo es otra pantalla y otro spec (el del
  // Panel), no un borrador que pegar aquí.
  const effectiveSystemPrompt = await buildEffectiveSystemPrompt({
    agent: "confirmation",
    basePrompt: input.prompt,
    contactId,
  });

  const messages: ModelMessage[] = [
    ...history,
    { role: "user", content: input.message },
  ];

  const provider = openrouter();
  const result = await generateText({
    model: provider(input.model),
    system: effectiveSystemPrompt,
    messages,
  });

  return {
    reply: result.text.trim(),
    effectiveSystemPrompt,
    history: history.flatMap((m) =>
      typeof m.content === "string" && (m.role === "user" || m.role === "assistant")
        ? [{ role: m.role, content: m.content }]
        : [],
    ),
    usedConversation: contactId !== null,
  };
}
