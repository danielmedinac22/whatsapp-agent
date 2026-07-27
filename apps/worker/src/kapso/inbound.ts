import { createHmac, timingSafeEqual } from "node:crypto";
import { kapsoWebhookSecret } from "./config";

/**
 * Verify a Kapso webhook signature: header `X-Webhook-Signature`,
 * HMAC-SHA256 over the raw request body, hex-encoded, keyed by the webhook's
 * `secret_key` (we set it to KAPSO_WEBHOOK_SECRET when registering). Some
 * senders prefix `sha256=`.
 */
export function verifyKapsoSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader) return false;
  const signature = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;
  const expected = createHmac("sha256", kapsoWebhookSecret())
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

interface KapsoStatusError {
  code?: number;
  title?: string;
  message?: string;
}

/** The message/conversation fields of a `whatsapp.message.*` payload. */
interface KapsoMessageFields {
  phone_number_id?: string;
  message?: {
    id?: string;
    timestamp?: string;
    type?: string;
    from?: string;
    text?: { body?: string };
    button?: { text?: string; payload?: string };
    interactive?: {
      type?: string;
      button_reply?: { id?: string; title?: string };
      list_reply?: { id?: string; title?: string };
    };
    image?: { caption?: string };
    video?: { caption?: string };
    document?: { caption?: string; filename?: string };
    kapso?: {
      direction?: string;
      status?: string;
      statuses?: Array<{ status?: string; errors?: KapsoStatusError[] }>;
      errors?: KapsoStatusError[];
    };
  };
  conversation?: {
    id?: string;
    phone_number?: string;
    kapso?: { contact_name?: string | null };
  };
}

/** Top-level payload: fields may be flat or nested under `data` (envelope). */
export interface KapsoInboundPayload extends KapsoMessageFields {
  event?: string;
  data?: KapsoMessageFields;
}

export type InboundKind = "text" | "button" | "interactive" | "media" | "audio";

export interface ParsedInboundMessage {
  waMessageId: string;
  /** Sender wa_id: E.164 digits, no "+". */
  from: string;
  phoneNumberId: string;
  contactName: string | null;
  /** Normalized text: body, caption, or tapped button/list title. Empty for
   *  audio and caption-less media. */
  text: string;
  kind: InboundKind;
  receivedAt: Date;
}

/**
 * Normalize a `whatsapp.message.received` payload. Returns null when the
 * payload isn't an actionable inbound message (status updates, reactions,
 * unknown types, outbound echoes).
 *
 * Template quick-reply taps arrive as `type:"button"` (button.text == label);
 * interactive replies as `type:"interactive"`. Both surface as text so the
 * confirmation flow treats a tap like a typed reply. Audio surfaces with
 * kind "audio" (empty text) so the pipeline can escalate to a human.
 */
export function parseInboundMessage(
  payload: KapsoInboundPayload,
): ParsedInboundMessage | null {
  const root = payload.data ?? payload;
  const m = root.message;
  if (!m) return null;
  if (m.kapso?.direction && m.kapso.direction !== "inbound") return null;

  let text: string | undefined;
  let kind: InboundKind | null = null;
  switch (m.type) {
    case "text":
      text = m.text?.body;
      kind = "text";
      break;
    case "button":
      text = m.button?.text;
      kind = "button";
      break;
    case "interactive":
      text =
        m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
      kind = "interactive";
      break;
    case "image":
    case "video":
    case "document":
      text =
        m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? "";
      kind = "media";
      break;
    case "audio":
      text = "";
      kind = "audio";
      break;
    default:
      return null;
  }

  const from = m.from;
  const waMessageId = m.id;
  const phoneNumberId = root.phone_number_id;
  if (kind === null || text === undefined || !from || !waMessageId || !phoneNumberId) {
    return null;
  }
  // Caption-less media with nothing to act on is still stored (matches the old
  // Baileys behavior of persisting image messages without caption).

  const tsNum = Number(m.timestamp);
  const receivedAt =
    Number.isFinite(tsNum) && tsNum > 0 ? new Date(tsNum * 1000) : new Date();

  return {
    waMessageId,
    from: from.replace(/\D/g, ""),
    phoneNumberId,
    contactName: root.conversation?.kapso?.contact_name ?? null,
    text,
    kind,
    receivedAt,
  };
}

export type DeliveryStatusValue = "sent" | "delivered" | "read" | "failed";

export interface ParsedStatusEvent {
  waMessageId: string;
  status: DeliveryStatusValue;
  errorCode: number | null;
  errorTitle: string | null;
  errorMessage: string | null;
}

const STATUS_EVENT_NAMES: Record<string, DeliveryStatusValue> = {
  "whatsapp.message.sent": "sent",
  "whatsapp.message.delivered": "delivered",
  "whatsapp.message.read": "read",
  "whatsapp.message.failed": "failed",
};

/**
 * Parse a Kapso delivery-status event (`whatsapp.message.{sent,delivered,read,
 * failed}`). Status comes from the event name (authoritative); on failure the
 * Meta error is pulled from `message.kapso.statuses[].errors[]` (or the flat
 * `message.kapso.errors[]`). Returns null for non-status payloads.
 */
export function parseStatusEvent(
  payload: KapsoInboundPayload,
): ParsedStatusEvent | null {
  const status = payload.event ? STATUS_EVENT_NAMES[payload.event] : undefined;
  if (!status) return null;
  const root = payload.data ?? payload;
  const waMessageId = root.message?.id;
  if (!waMessageId) return null;

  const kapso = root.message?.kapso;
  const err =
    kapso?.statuses?.find((s) => s.errors && s.errors.length > 0)?.errors?.[0] ??
    kapso?.errors?.[0] ??
    null;

  return {
    waMessageId,
    status,
    errorCode: err?.code ?? null,
    errorTitle: err?.title ?? null,
    errorMessage: err?.message ?? null,
  };
}
