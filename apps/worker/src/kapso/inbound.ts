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

/**
 * El objeto `referral` de Meta: de qué anuncio Click-to-WhatsApp vino el
 * mensaje. Los nombres son los de Meta, no los nuestros.
 *
 * Los valores van como `unknown` a propósito: esto es lo que el proveedor
 * mande, no lo que prometió mandar. El tipado fuerte vive en
 * {@link ParsedAdReferral}, después de normalizar. Y como **la ruta exacta del
 * campo dentro del payload de Kapso no está documentada**, declararlo aquí no
 * basta: quien lo encuentra de verdad es {@link findAdReferral}.
 */
interface KapsoReferralFields {
  /** El identificador del **anuncio**. */
  source_id?: unknown;
  source_url?: unknown;
  /** `ad` | `post` en Meta; Kapso añade `organic`. */
  source_type?: unknown;
  headline?: unknown;
  body?: unknown;
  /** El identificador de **clic**, el que CAPI recibe. Meta lo omite en anuncios de Estados. */
  ctwa_clid?: unknown;
  media_type?: unknown;
}

/** The message/conversation fields of a `whatsapp.message.*` payload. */
interface KapsoMessageFields {
  phone_number_id?: string;
  /** Ver {@link findAdReferral}: la ruta real es un dato desconocido. */
  referral?: KapsoReferralFields;
  message?: {
    id?: string;
    timestamp?: string;
    type?: string;
    from?: string;
    /** Donde Meta lo pone: hermano de `from`, `id`, `timestamp` y `type`. */
    referral?: KapsoReferralFields;
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
      /** URL hospedada por Kapso (necesita API key) para el media entrante. */
      media_url?: string | null;
      media_data?: {
        url?: string | null;
        filename?: string | null;
        content_type?: string | null;
        byte_size?: number | null;
      } | null;
      /** Transcripción del audio, cuando Kapso la genera. */
      transcript?: { text?: string | null } | null;
      /** El otro sitio plausible: el sub-objeto donde Kapso mete lo suyo. */
      referral?: KapsoReferralFields;
    };
  };
  conversation?: {
    id?: string;
    phone_number?: string;
    referral?: KapsoReferralFields;
    kapso?: { contact_name?: string | null; referral?: KapsoReferralFields };
  };
}

/** Top-level payload: fields may be flat or nested under `data` (envelope). */
export interface KapsoInboundPayload extends KapsoMessageFields {
  event?: string;
  data?: KapsoMessageFields;
}

// ────────────────────────────────────────────────────────────────────────────
// Referencia de anuncio (CTWA)
// ────────────────────────────────────────────────────────────────────────────

/**
 * De qué anuncio vino el mensaje, ya normalizado.
 *
 * **Llega solo en el primer mensaje.** Meta no lo adjunta a las respuestas de
 * botón ni de lista, que es justo lo que usa el flujo de confirmación, y **no
 * existe ningún endpoint para recuperarlo después del hecho**: lo que no se
 * capture aquí se pierde para siempre. Por eso el parser expone el objeto
 * crudo además de los campos: si mañana se descubre que la ruta era otra, el
 * dato sigue guardado y se puede volver a parsear.
 *
 * Los dos identificadores son distintos y viajan juntos: {@link adId} reconoce
 * el **producto** (es la clave del mapeo `product_ads`), {@link ctwaClid} es lo
 * que después permite reportarle la venta a Meta.
 */
export interface ParsedAdReferral {
  /** `source_id`: el identificador del **anuncio** en Meta. */
  adId: string | null;
  /** `headline`: titular del anuncio. Entrada del nivel semántico de la cascada. */
  headline: string | null;
  /** `body`: cuerpo del anuncio. */
  body: string | null;
  /** `source_url`: la URL del anuncio (`https://fb.me/…`). */
  sourceUrl: string | null;
  /** `source_type`: `ad` | `post` (Meta) | `organic` (valor propio de Kapso). */
  sourceType: string | null;
  /**
   * `ctwa_clid`: el identificador de **clic**, el parámetro que CAPI recibe.
   * Meta lo omite en los anuncios de Estados, así que puede faltar aunque el
   * anuncio sí venga.
   */
  ctwaClid: string | null;
  /**
   * En qué ruta del payload apareció (`message.referral`,
   * `message.kapso.referral`, …). **Es el dato que hoy no existe**: la
   * documentación de Kapso afirma que manda `referral` pero no dice dónde, y
   * su serializador ya recortó otros campos. El primer clic real lo fija, y
   * queda en el log sin tener que ir a buscarlo a los Logs del proveedor.
   */
  path: string;
  /** El objeto `referral` entero, tal cual llegó. La red contra los recortes. */
  raw: Record<string, unknown>;
}

/**
 * Las rutas donde puede venir el `referral`, en orden de probabilidad.
 *
 * Meta lo pone dentro del mensaje (`messages[].referral`), hermano de `from` e
 * `id`; el serializador de Kapso arma un objeto curado campo por campo y mete
 * lo suyo bajo `message.kapso`; y su dashboard asocia los referrals a la
 * *conversación*, así que ahí también podría aparecer.
 */
const REFERRAL_PATHS: readonly (readonly string[])[] = [
  ["message", "referral"],
  ["message", "kapso", "referral"],
  ["referral"],
  ["conversation", "referral"],
  ["conversation", "kapso", "referral"],
];

/**
 * Los campos que identifican a un objeto como una referencia de anuncio.
 *
 * Son deliberadamente los cuatro nombres **propios** del `referral`, y no
 * `headline` ni `body`: `body` es también el campo del texto de un mensaje
 * normal (`message.text.body`), y buscar por él haría que todo mensaje de
 * texto pareciera venir de un anuncio.
 */
const REFERRAL_MARKERS = [
  "source_id",
  "ctwa_clid",
  "source_type",
  "source_url",
] as const;

/** Hasta dónde baja la búsqueda a ciegas. Un payload de Kapso tiene 3 niveles. */
const REFERRAL_SEARCH_MAX_DEPTH = 6;
/** Cuántos nodos mira antes de rendirse. Corre en cada mensaje entrante. */
const REFERRAL_SEARCH_MAX_NODES = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** El valor en una ruta, o `undefined` si el camino se corta. */
function valueAt(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function hasReferralMarkers(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && REFERRAL_MARKERS.some((k) => value[k] != null);
}

/**
 * La búsqueda a ciegas, para cuando el `referral` no está en ninguna de las
 * rutas conocidas.
 *
 * Existe porque la ruta es un dato desconocido y el error es irreversible: un
 * `referral` que llegue en un sitio que no previmos se pierde para siempre, y
 * no hay forma de recuperarlo ni de enterarse. Prefiere una clave que se llame
 * `referral`; si no hay, cualquier objeto con los campos propios de Meta. La
 * ruta encontrada queda en {@link ParsedAdReferral.path}.
 *
 * Acotada en profundidad y en nodos: recorre el payload de **todos** los
 * mensajes entrantes, incluidos los que no vienen de ningún anuncio.
 */
function searchAdReferral(
  root: unknown,
): { value: Record<string, unknown>; path: string } | null {
  let byMarkers: { value: Record<string, unknown>; path: string } | null = null;
  let nodes = 0;

  const walk = (
    node: unknown,
    path: string,
    depth: number,
  ): { value: Record<string, unknown>; path: string } | null => {
    if (depth > REFERRAL_SEARCH_MAX_DEPTH) return null;
    if (nodes++ > REFERRAL_SEARCH_MAX_NODES) return null;
    if (Array.isArray(node)) {
      for (const [i, item] of node.entries()) {
        const hit = walk(item, `${path}[${i}]`, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    if (!isRecord(node)) return null;
    for (const [key, value] of Object.entries(node)) {
      const here = path ? `${path}.${key}` : key;
      if (key === "referral" && isRecord(value)) return { value, path: here };
      if (!byMarkers && hasReferralMarkers(value)) {
        byMarkers = { value, path: here };
      }
      const hit = walk(value, here, depth + 1);
      if (hit) return hit;
    }
    return null;
  };

  return walk(root, "", 0) ?? byMarkers;
}

/**
 * Texto de un campo del `referral`. Vacío cuenta como ausente — «un payload sin
 * referencia no inventa campos» vale también campo por campo.
 *
 * Acepta números porque `source_id` es un identificador de Meta que viaja como
 * cadena pero que cualquier serializador intermedio puede emitir sin comillas,
 * y perder el id del anuncio por eso sería absurdo.
 */
function referralText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * La referencia de anuncio del payload, si la trae.
 *
 * Devuelve `null` cuando no hay ninguna **y también** cuando el objeto que hay
 * no identifica nada (por ejemplo, solo `source_type`): una referencia sin
 * anuncio, sin clic, sin URL y sin copy no es un clic de anuncio, y guardarla
 * marcaría la conversación como lead sin que nadie haya hecho clic en nada.
 */
export function findAdReferral(
  payload: KapsoInboundPayload,
): ParsedAdReferral | null {
  const root = payload.data ?? payload;
  for (const path of REFERRAL_PATHS) {
    const value = valueAt(root, path);
    if (isRecord(value)) {
      const parsed = toAdReferral(value, path.join("."));
      if (parsed) return parsed;
    }
  }
  const found = searchAdReferral(root);
  return found ? toAdReferral(found.value, found.path) : null;
}

function toAdReferral(
  raw: Record<string, unknown>,
  path: string,
): ParsedAdReferral | null {
  const referral: ParsedAdReferral = {
    adId: referralText(raw["source_id"]),
    headline: referralText(raw["headline"]),
    body: referralText(raw["body"]),
    sourceUrl: referralText(raw["source_url"]),
    sourceType: referralText(raw["source_type"]),
    ctwaClid: referralText(raw["ctwa_clid"]),
    path,
    raw,
  };
  const identifiesSomething =
    referral.adId ??
    referral.ctwaClid ??
    referral.sourceUrl ??
    referral.headline ??
    referral.body;
  return identifiesSomething === null ? null : referral;
}

export type InboundKind = "text" | "button" | "interactive" | "media" | "audio";

export interface ParsedInboundMessage {
  waMessageId: string;
  /** Sender wa_id: E.164 digits, no "+". */
  from: string;
  phoneNumberId: string;
  contactName: string | null;
  /** Normalized text: body, caption, or tapped button/list title. Para audio,
   *  la transcripción cuando Kapso la trae; si no, vacío. */
  text: string;
  kind: InboundKind;
  /** URL de Kapso con los bytes del media (audio/imagen), si hay. */
  mediaUrl: string | null;
  mediaMime: string | null;
  /** Transcripción cruda del audio (null si Kapso no la generó). */
  transcript: string | null;
  /**
   * De qué anuncio vino, si vino de uno. `null` en la enorme mayoría de los
   * mensajes: solo el **primero** de una conversación originada en un anuncio
   * lo trae. Quien lo persiste es el pipeline de entrada, en la conversación.
   */
  adReferral: ParsedAdReferral | null;
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
 *
 * La referencia del anuncio ({@link findAdReferral}) se busca en **todos** los
 * tipos y no solo en los de texto: quien decide si un payload la trae es el
 * payload, no el tipo de mensaje. Un payload sin referencia se parsea
 * exactamente igual que antes, con `adReferral: null`.
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
      // La transcripción entra como texto: con ella el agente puede responder
      // en vez de escalar toda nota de voz a un humano a ciegas.
      text = m.kapso?.transcript?.text?.trim() ?? "";
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

  const kapso = m.kapso;
  return {
    waMessageId,
    from: from.replace(/\D/g, ""),
    phoneNumberId,
    contactName: root.conversation?.kapso?.contact_name ?? null,
    text,
    kind,
    mediaUrl: kapso?.media_data?.url ?? kapso?.media_url ?? null,
    mediaMime: kapso?.media_data?.content_type ?? null,
    transcript: kapso?.transcript?.text?.trim() || null,
    adReferral: findAdReferral(payload),
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
 * failed}`). The event name is authoritative and, in payload v2, arrives in the
 * `X-Webhook-Event` HEADER (the body has no `event` field) — callers pass it
 * in. On failure the Meta error is pulled from `message.kapso.statuses[].
 * errors[]` (or the flat `message.kapso.errors[]`). Returns null otherwise.
 */
export function parseStatusEvent(
  eventName: string | null,
  payload: KapsoInboundPayload,
): ParsedStatusEvent | null {
  const name = eventName ?? payload.event;
  const status = name ? STATUS_EVENT_NAMES[name] : undefined;
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
