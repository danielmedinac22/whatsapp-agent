import { kapsoApiBaseUrl, kapsoApiKey } from "./config";
import { templateByName } from "./templates";

/**
 * Kapso HTTP client (no SDK — plain fetch). Contract verified against
 * docs.kapso.ai and the waichat production integration:
 *   - Base: https://api.kapso.ai
 *   - Auth: `X-API-Key` header (NOT Bearer).
 *   - Platform resources (/platform/v1/...) are wrapped in `{ data: ... }`.
 *   - The Meta proxy (/meta/whatsapp/v24.0/...) returns raw Meta Cloud API
 *     shapes (`{ messages: [{ id }] }`, no envelope).
 */

/** Hard ceiling for any single Kapso call so a hung upstream can't pin a
 * pg-boss worker slot open indefinitely. */
const KAPSO_TIMEOUT_MS = 20_000;

const META_BASE = "/meta/whatsapp/v24.0";

export class KapsoApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
    public readonly responseBody: string,
    /** Seconds to wait before retrying, parsed from Retry-After on a 429. */
    public readonly retryAfterSeconds: number | null = null,
  ) {
    // Never include the API key; path/status/body are safe to log internally.
    super(`Kapso ${method} ${path} → ${status}`);
    this.name = "KapsoApiError";
  }

  get rateLimited(): boolean {
    return this.status === 429;
  }

  /** True when the request timed out or failed at the network layer. */
  get timedOut(): boolean {
    return this.status === 0;
  }

  /**
   * `message` + the response body, for logs and `outbound_messages.last_error`.
   * The body is where Kapso/Meta say WHY — anything that persists or logs this
   * error must use `detail`, not `message`.
   */
  get detail(): string {
    const body = this.responseBody.trim();
    return body ? `${this.message} — ${body.slice(0, 300)}` : this.message;
  }
}

/**
 * Kapso rejects a free-text send with 422 when the Meta 24h customer-service
 * window is closed (verified in waichat prod: every 422 was out-of-window;
 * failures inside the window carried a different status — 0/503/520). Callers
 * turn this into the "send an approved template" path.
 */
export function isWindowClosedError(err: unknown): boolean {
  return err instanceof KapsoApiError && err.status === 422;
}

/** Transient (retry via pg-boss) vs permanent (mark dead) Kapso failures. */
export function classifyKapsoError(err: unknown): "transient" | "permanent" {
  if (err instanceof KapsoApiError) {
    if (err.timedOut || err.rateLimited || err.status >= 500) return "transient";
    return "permanent"; // 4xx: bad recipient, closed window, bad template…
  }
  return "transient";
}

async function kapsoFetch<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${kapsoApiBaseUrl()}${path}`, {
      method,
      signal: AbortSignal.timeout(KAPSO_TIMEOUT_MS),
      headers: {
        "X-API-Key": kapsoApiKey(),
        "content-type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Timeout / network error → status 0 so callers can treat it as transient.
    throw new KapsoApiError(method, path, 0, String(err).slice(0, 300));
  }

  if (!res.ok) {
    const retryAfter =
      res.status === 429 ? parseRetryAfter(res.headers.get("retry-after")) : null;
    throw new KapsoApiError(
      method,
      path,
      res.status,
      await res.text().catch(() => ""),
      retryAfter,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into seconds. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, Math.round(secs));
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.round((date - Date.now()) / 1000));
}

// --- Platform API: numbers & webhooks ----------------------------------------

export interface KapsoPhoneNumber {
  phone_number_id: string;
  business_account_id: string | null;
  display_phone_number: string | null;
  display_name: string | null;
  name: string | null;
  kind: string | null; // "sandbox" | "dedicated"
}

/** GET /platform/v1/whatsapp/phone_numbers → connected numbers. */
export async function listPhoneNumbers(): Promise<KapsoPhoneNumber[]> {
  const res = await kapsoFetch<{ data?: KapsoPhoneNumber[] }>(
    "GET",
    "/platform/v1/whatsapp/phone_numbers",
  );
  return res.data ?? [];
}

/**
 * Register a NUMBER-SCOPED inbound webhook idempotently. Project-scoped
 * webhooks do NOT receive message/conversation events — inbound messages
 * require a webhook bound to a `phone_number_id`.
 */
export async function ensureNumberWebhook(input: {
  phoneNumberId: string;
  url: string;
  secretKey: string;
  events: string[];
}): Promise<void> {
  try {
    const list = await kapsoFetch<{
      data?: Array<{ id: string; url: string; phone_number_id: string | null }>;
    }>("GET", "/platform/v1/whatsapp/webhooks");
    if (
      list.data?.some(
        (w) => w.url === input.url && w.phone_number_id === input.phoneNumberId,
      )
    ) {
      return;
    }
  } catch {
    // Listing unsupported/failed — fall through to create. Duplicate delivery
    // is tolerated downstream via webhook_events dedup on event id.
  }
  await kapsoFetch("POST", "/platform/v1/whatsapp/webhooks", {
    whatsapp_webhook: {
      url: input.url,
      phone_number_id: input.phoneNumberId,
      events: input.events,
      secret_key: input.secretKey,
      payload_version: "v2",
    },
  });
}

// --- Meta proxy: send --------------------------------------------------------

interface MetaSendResponse {
  messages?: Array<{ id: string }>;
}

/** Send a free-text message. Returns the Meta message id (wamid). */
export async function sendText(input: {
  phoneNumberId: string;
  to: string;
  body: string;
}): Promise<{ waMessageId: string | null }> {
  const res = await kapsoFetch<MetaSendResponse>(
    "POST",
    `${META_BASE}/${input.phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "text",
      text: { body: input.body },
    },
  );
  return { waMessageId: res.messages?.[0]?.id ?? null };
}

/**
 * Upload media to Meta through the Kapso proxy (multipart, NOT JSON — de ahí
 * que no use kapsoFetch). Devuelve el media id que consume el envío.
 * WhatsApp lo conserva ~30 días, suficiente para cualquier reintento.
 */
export async function uploadMedia(input: {
  phoneNumberId: string;
  bytes: Buffer;
  mime: string;
  filename: string;
}): Promise<{ mediaId: string }> {
  const path = `${META_BASE}/${input.phoneNumberId}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", input.mime);
  form.append(
    "file",
    new Blob([new Uint8Array(input.bytes)], { type: input.mime }),
    input.filename,
  );

  let res: Response;
  try {
    res = await fetch(`${kapsoApiBaseUrl()}${path}`, {
      method: "POST",
      signal: AbortSignal.timeout(KAPSO_TIMEOUT_MS),
      // Sin content-type a mano: fetch tiene que poner el boundary.
      headers: { "X-API-Key": kapsoApiKey() },
      body: form,
    });
  } catch (err) {
    throw new KapsoApiError("POST", path, 0, String(err).slice(0, 300));
  }
  if (!res.ok) {
    throw new KapsoApiError(
      "POST",
      path,
      res.status,
      await res.text().catch(() => ""),
    );
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    throw new KapsoApiError("POST", path, 502, "upload sin media id");
  }
  return { mediaId: json.id };
}

/**
 * Send an audio message. `voice: true` lo pinta como nota de voz en WhatsApp y
 * SOLO funciona con ogg/opus — de ahí que la grabación en el navegador use un
 * encoder opus en vez del webm nativo de Chrome, que Meta rechaza.
 */
export async function sendAudio(input: {
  phoneNumberId: string;
  to: string;
  mediaId: string;
  voice?: boolean;
}): Promise<{ waMessageId: string | null }> {
  const res = await kapsoFetch<MetaSendResponse>(
    "POST",
    `${META_BASE}/${input.phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "audio",
      audio: { id: input.mediaId, voice: input.voice ?? true },
    },
  );
  return { waMessageId: res.messages?.[0]?.id ?? null };
}

/**
 * Descarga los bytes de un media hospedado por Kapso (los audios que ENTRAN
 * llegan como URL de api.kapso.ai, que necesita la API key).
 */
export async function fetchKapsoMedia(
  url: string,
): Promise<{ bytes: Buffer; mime: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(KAPSO_TIMEOUT_MS),
      headers: { "X-API-Key": kapsoApiKey() },
    });
  } catch (err) {
    throw new KapsoApiError("GET", url, 0, String(err).slice(0, 300));
  }
  if (!res.ok) {
    throw new KapsoApiError(
      "GET",
      url,
      res.status,
      await res.text().catch(() => ""),
    );
  }
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    mime: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

/**
 * Build the Meta Cloud API `type:"template"` message body. Pure (no I/O) so the
 * shape — the part most likely to be subtly wrong — is testable. `bodyParams`
 * is the ORDERED values array; the catalog definition supplies each value's
 * `parameter_name` (our templates are created with parameter_format NAMED).
 */
export function buildTemplateMessageBody(input: {
  to: string;
  templateName: string;
  languageCode: string;
  bodyParams: string[];
}): Record<string, unknown> {
  const def = templateByName(input.templateName);
  const components =
    input.bodyParams.length > 0
      ? [
          {
            type: "body",
            parameters: input.bodyParams.map((text, i) => ({
              type: "text",
              ...(def?.params[i]?.name
                ? { parameter_name: def.params[i]!.name }
                : {}),
              text,
            })),
          },
        ]
      : [];
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: input.languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  };
}

/** Send an approved Meta template (business-initiated / outside the 24h window). */
export async function sendTemplate(input: {
  phoneNumberId: string;
  to: string;
  templateName: string;
  languageCode?: string;
  bodyParams?: string[];
}): Promise<{ waMessageId: string | null }> {
  const body = buildTemplateMessageBody({
    to: input.to,
    templateName: input.templateName,
    languageCode: input.languageCode ?? "es",
    bodyParams: input.bodyParams ?? [],
  });
  const res = await kapsoFetch<MetaSendResponse>(
    "POST",
    `${META_BASE}/${input.phoneNumberId}/messages`,
    body,
  );
  return { waMessageId: res.messages?.[0]?.id ?? null };
}

/**
 * Mark an inbound message as read, optionally showing the typing indicator
 * (dismisses on send or after ~25s). Replaces Baileys' read receipts +
 * sendPresenceUpdate("composing").
 */
export async function markRead(input: {
  phoneNumberId: string;
  messageId: string;
  typing?: boolean;
}): Promise<void> {
  await kapsoFetch("POST", `${META_BASE}/${input.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: input.messageId,
    ...(input.typing ? { typing_indicator: { type: "text" } } : {}),
  });
}

// --- Meta proxy: template CRUD (per-WABA) ------------------------------------

export interface MetaTemplateStatus {
  id: string;
  name?: string;
  status: string; // APPROVED | PENDING | REJECTED | PAUSED | ...
  category?: string;
}

/** POST /{waba_id}/message_templates — submit a template for Meta approval. */
export async function createTemplate(
  businessAccountId: string,
  definition: Record<string, unknown>,
): Promise<MetaTemplateStatus> {
  return kapsoFetch<MetaTemplateStatus>(
    "POST",
    `${META_BASE}/${businessAccountId}/message_templates`,
    definition,
  );
}

/** GET /{waba_id}/message_templates?name= — poll approval status by name. */
export async function listTemplatesByName(
  businessAccountId: string,
  name: string,
): Promise<MetaTemplateStatus[]> {
  const res = await kapsoFetch<{ data?: MetaTemplateStatus[] }>(
    "GET",
    `${META_BASE}/${businessAccountId}/message_templates?name=${encodeURIComponent(name)}`,
  );
  return res.data ?? [];
}
