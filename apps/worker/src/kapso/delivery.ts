import { eq } from "@wa/db";
import { messages, outboundMessages } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import type { ParsedStatusEvent } from "./inbound";

/**
 * Delivery status handling for outbound messages, fed by Kapso status webhooks
 * (replaces Baileys' numeric `messages.update` ACKs).
 */

export type DeliveryFailReason =
  | "needs_payment" // WABA has no payment method / prepaid balance on Meta
  | "undeliverable" // recipient can't receive (not on WhatsApp, etc.)
  | "reengagement_window" // free-text outside the 24h window (needs a template)
  | "template_issue" // template paused / param mismatch
  | "rate_limited" // Meta throttled for ecosystem health
  | "unknown";

const RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };

/**
 * Monotonic guard: status webhooks can arrive out of order, so only ever
 * advance (sent < delivered < read). `failed` is terminal and only applies
 * before delivery (a delivered/read message can't later "fail").
 */
export function isStatusAdvance(
  current: string | null,
  next: ParsedStatusEvent["status"],
): boolean {
  if (next === "failed") {
    return current == null || current === "pending" || current === "sent";
  }
  if (current === "failed") return false;
  return (RANK[next] ?? 0) > (RANK[current ?? "pending"] ?? 0);
}

/** Map a Meta error code to an actionable reason + human text. */
export function metaErrorReason(code: number | null): {
  reason: DeliveryFailReason;
  text: string;
} {
  switch (code) {
    case 131042:
      return {
        reason: "needs_payment",
        text: "Falta método de pago o saldo en la WABA (Meta Billing).",
      };
    case 131047:
      return {
        reason: "reengagement_window",
        text: "Fuera de la ventana de 24h — requiere plantilla.",
      };
    case 131026:
    case 131000:
      return {
        reason: "undeliverable",
        text: "El destinatario no puede recibir el mensaje (¿no usa WhatsApp?).",
      };
    case 131049:
    case 130472:
      return {
        reason: "rate_limited",
        text: "Meta limitó la entrega por salud del ecosistema.",
      };
    case 132000:
    case 132001:
    case 132005:
    case 132007:
    case 132012:
    case 132015:
    case 132016:
    case 132068:
    case 132069:
      return {
        reason: "template_issue",
        text: "Problema con la plantilla (parámetros o estado).",
      };
    default:
      return {
        reason: "unknown",
        text: code ? `Error de Meta ${code}.` : "Error de entrega desconocido.",
      };
  }
}

/** Compact, stored error string for a failed delivery. */
export function formatDeliveryError(s: ParsedStatusEvent): string {
  const { reason, text } = metaErrorReason(s.errorCode);
  const detail = s.errorMessage ?? s.errorTitle ?? text;
  const code = s.errorCode ? ` (${s.errorCode})` : "";
  return `${reason}: ${detail}${code}`.slice(0, 500);
}

/**
 * Apply a delivery-status event to the matching `messages` and
 * `outbound_messages` rows (matched by wamid). Monotonic + idempotent; no-op
 * for messages we didn't record (e.g. sent from the Kapso inbox directly).
 */
export async function applyDeliveryStatus(s: ParsedStatusEvent): Promise<void> {
  const [msg] = await db
    .select({ id: messages.id, status: messages.status })
    .from(messages)
    .where(eq(messages.waId, s.waMessageId))
    .limit(1);

  if (msg && isStatusAdvance(msg.status, s.status)) {
    await db
      .update(messages)
      .set({ status: s.status })
      .where(eq(messages.id, msg.id));
  }

  const [outbound] = await db
    .select({ id: outboundMessages.id, status: outboundMessages.status })
    .from(outboundMessages)
    .where(eq(outboundMessages.waId, s.waMessageId))
    .limit(1);
  if (!outbound) return;

  if (s.status === "failed") {
    // Post-accept failure from Meta (e.g. undeliverable): mark it so the
    // outbox reflects reality even though the API call succeeded.
    if (outbound.status === "sent" || outbound.status === "sending") {
      await db
        .update(outboundMessages)
        .set({
          status: "failed",
          failedAt: new Date(),
          lastError: formatDeliveryError(s),
          lastErrorKind: "permanent",
          updatedAt: new Date(),
        })
        .where(eq(outboundMessages.id, outbound.id));
      logger.warn(
        { outboundId: outbound.id, waId: s.waMessageId, code: s.errorCode },
        "outbound: delivery failed post-send",
      );
    }
    return;
  }

  // delivered/read → acked (terminal success for the outbox).
  if (
    (s.status === "delivered" || s.status === "read") &&
    outbound.status === "sent"
  ) {
    await db
      .update(outboundMessages)
      .set({ status: "acked", ackedAt: new Date(), updatedAt: new Date() })
      .where(eq(outboundMessages.id, outbound.id));
  }
}
