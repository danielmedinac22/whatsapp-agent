import { eq } from "@wa/db";
import { contacts, type Contact } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { enqueueOutbound } from "../jobs/outbound";
import { getDropiConnection } from "../dropi/config";

export type EscalationReason =
  | "audio_message"
  | "agent_request"
  | "manual";

const REASON_LABEL: Record<EscalationReason, string> = {
  audio_message: "el cliente envió un audio",
  agent_request: "el agente pidió escalar",
  manual: "escalación manual",
};

const CUSTOMER_NOTICE: Partial<Record<EscalationReason, string>> = {
  audio_message:
    "Recibí tu audio 🎙️ Un asesor te responderá en unos minutos por aquí mismo.",
};

interface EscalateInput {
  contact: Contact;
  reason: EscalationReason;
  /** Optional extra context for the admin notification. */
  detail?: string;
}

/**
 * Único punto de escalación a humano. Idempotente: si el contacto ya está
 * en modo manual, sólo notifica al admin (no vuelve a tocar agentMode ni
 * spamea al cliente con el aviso de cortesía).
 */
export async function escalateToHuman({
  contact,
  reason,
  detail,
}: EscalateInput): Promise<void> {
  const wasAgent = contact.agentMode;

  if (wasAgent) {
    await db
      .update(contacts)
      .set({ agentMode: false })
      .where(eq(contacts.id, contact.id));
  }

  // Customer-facing courtesy notice (only when we just took the agent off,
  // and only if there's a notice for this reason). Idempotent via dedupKey
  // bucketed per hour so no spam on bursts.
  const notice = CUSTOMER_NOTICE[reason];
  if (wasAgent && notice && contact.phone) {
    const hourBucket = Math.floor(Date.now() / 3_600_000);
    await enqueueOutbound({
      jid: `${contact.phone}@s.whatsapp.net`,
      body: notice,
      source: "escalation",
      dedupKey: `escalation-customer-${contact.id}-${reason}-${hourBucket}`,
    }).catch((err) => {
      logger.error(
        { err: String(err), contactId: contact.id },
        "escalation: customer notice enqueue failed",
      );
    });
  }

  // Admin notification (only meaningful on the transition agent→manual).
  if (wasAgent) {
    const conn = await getDropiConnection().catch(() => null);
    const adminPhone = conn?.adminPhone;
    if (adminPhone) {
      const customerLabel = contact.name ?? `+${contact.phone ?? "?"}`;
      const phoneLine = contact.phone ? `\n📱 +${contact.phone}` : "";
      const reasonLine = REASON_LABEL[reason];
      const detailLine = detail ? `\n\n_${detail}_` : "";
      const body =
        `🚨 *Escalación a humano*\n\n` +
        `*${customerLabel}* — ${reasonLine}.${phoneLine}${detailLine}\n\n` +
        `El agente quedó apagado para esta conversación. Responde desde el inbox.`;
      await enqueueOutbound({
        jid: `${adminPhone.replace(/\D/g, "")}@s.whatsapp.net`,
        body,
        source: "escalation",
        dedupKey: `escalation-admin-${contact.id}-${reason}-${Date.now()}`,
      }).catch((err) => {
        logger.error(
          { err: String(err) },
          "escalation: admin ping enqueue failed",
        );
      });
    } else {
      logger.warn(
        { contactId: contact.id, reason },
        "escalation: no admin_phone configured — cannot notify",
      );
    }
  }

  logger.info(
    {
      contactId: contact.id,
      reason,
      transitioned: wasAgent,
    },
    "escalation triggered",
  );
}
