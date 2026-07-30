import { eq } from "@wa/db";
import {
  contacts,
  conversations,
  messageMedia,
  messages,
  type Conversation,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { events } from "../lib/events";
import { onAgentInbound } from "../agent/runner";
import { scheduleConfirmationClassify } from "../agent/confirmation-classifier";
import { escalateToHuman } from "../agent/escalation";
import { handleInboundConfirmation } from "../jobs/confirmation-ack";
import { tryHandleDropi2FAInbound } from "../dropi/2fa-inbound";
import { markNovedadCustomerReply } from "../dropi/novedad-reply";
import { fetchKapsoMedia, markRead } from "../kapso/client";
import type { ParsedInboundMessage } from "../kapso/inbound";
import { upsertContactByWaId } from "./contacts";

/**
 * Copia el audio entrante a `message_media`. Best-effort: si Kapso no da URL o
 * la descarga falla, el mensaje se guarda igual (sin reproductor) — perder el
 * audio no puede costar el mensaje.
 */
async function storeInboundAudio(
  parsed: ParsedInboundMessage,
): Promise<{ id: string; mime: string } | null> {
  if (!parsed.mediaUrl) return null;
  try {
    const { bytes, mime } = await fetchKapsoMedia(parsed.mediaUrl);
    if (bytes.byteLength === 0) return null;
    const resolved = parsed.mediaMime ?? mime;
    const [row] = await db
      .insert(messageMedia)
      .values({
        mime: resolved,
        bytes,
        byteSize: bytes.byteLength,
        source: "inbound",
      })
      .returning({ id: messageMedia.id });
    return row ? { id: row.id, mime: resolved } : null;
  } catch (err) {
    logger.warn(
      { err: String(err), waId: parsed.waMessageId },
      "inbound: no se pudo guardar el audio del cliente",
    );
    return null;
  }
}

async function ensureConversation(contactId: string): Promise<Conversation> {
  const existing = await db
    .select()
    .from(conversations)
    .where(eq(conversations.contactId, contactId))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(conversations)
    .values({ contactId })
    .returning();
  return created!;
}

/**
 * Inbound pipeline: persist + fan out one normalized Kapso message.
 * Replaces the Baileys `messages.upsert` handler; everything downstream of
 * persistence (2FA interceptor, audio escalation, confirmation flow, agent)
 * is unchanged from the Baileys era.
 */
export async function handleInbound(parsed: ParsedInboundMessage): Promise<void> {
  const hasAudio = parsed.kind === "audio";

  const contact = await upsertContactByWaId(parsed.from, {
    pushName: parsed.contactName,
  });
  const conv = await ensureConversation(contact.id);

  // Los audios se copian a nuestro almacenamiento: la URL de Kapso exige API
  // key, así que el navegador del asesor no puede reproducirla directamente.
  const media = hasAudio ? await storeInboundAudio(parsed) : null;

  const [stored] = await db
    .insert(messages)
    .values({
      conversationId: conv.id,
      direction: "in",
      waId: parsed.waMessageId,
      body: parsed.text,
      status: "delivered",
      mediaUrl: media ? `/api/media/${media.id}` : null,
      mediaMime: media?.mime ?? null,
    })
    .onConflictDoNothing({ target: messages.waId })
    .returning();

  // Duplicate delivery (webhook retry) — already processed.
  if (!stored) return;

  const now = new Date();
  await db
    .update(conversations)
    .set({
      lastMessagePreview: parsed.text.slice(0, 200),
      lastInboundAt: now,
      unreadCount: (conv.unreadCount ?? 0) + 1,
    })
    .where(eq(conversations.id, conv.id));
  await db
    .update(contacts)
    .set({ lastMessageAt: now })
    .where(eq(contacts.id, contact.id));

  events.emitEvent({
    type: "message.created",
    conversationId: conv.id,
    messageId: stored.id,
  });

  // Blue ticks + typing indicator (typing only when the agent will answer).
  markRead({
    phoneNumberId: parsed.phoneNumberId,
    messageId: parsed.waMessageId,
    // Con transcripción el agente sí va a contestar el audio, así que el
    // "escribiendo…" corresponde.
    typing: contact.agentMode && (!hasAudio || Boolean(parsed.transcript)),
  }).catch(() => {
    /* best-effort */
  });

  // Interceptor 2FA Dropi: si es del admin y trae código, canjea sin pasar
  // por confirmation-ack ni el agente.
  const handled2fa = await tryHandleDropi2FAInbound({
    contact,
    body: parsed.text,
  }).catch((err) => {
    logger.error({ err }, "dropi 2fa interceptor failed");
    return false;
  });
  if (handled2fa) return;

  // Audio inbound: con transcripción de Kapso sigue el pipeline normal (el
  // agente puede responder sobre el texto). Sin transcripción no hay nada que
  // leer, así que se escala a humano como siempre.
  if (hasAudio && !parsed.transcript) {
    await escalateToHuman({ contact, reason: "audio_message" }).catch((err) =>
      logger.error({ err }, "audio escalation failed"),
    );
    return;
  }

  if (!parsed.text) return; // caption-less media: stored, nothing to act on

  // Si el contacto tiene una novedad activa esperando respuesta, marcarla.
  void markNovedadCustomerReply(contact.id);

  scheduleConfirmationClassify({
    conversationId: conv.id,
    contactId: contact.id,
  });

  const acked = await handleInboundConfirmation({
    contact,
    conversation: conv,
  }).catch((err) => {
    logger.error({ err }, "confirmation-ack failed");
    return false;
  });

  if (!acked && contact.agentMode) {
    onAgentInbound({
      contact,
      conversation: conv,
      body: parsed.text,
    }).catch((err) => logger.error({ err }, "agent runner failed"));
  }
}
