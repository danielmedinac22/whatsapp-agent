import { eq } from "@wa/db";
import { contacts, type Contact } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { contactWaId } from "../lib/phone";
import { ADMIN_ALERTA_TEMPLATE, sanitizeParam } from "../kapso/templates";
import { enqueueOutbound } from "../jobs/outbound";
import {
  resolveDropiConnection,
  resolveOperationForContact,
} from "../dropi/config";

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
  const customerTo = contactWaId(contact);
  if (wasAgent && notice && customerTo) {
    const hourBucket = Math.floor(Date.now() / 3_600_000);
    // Reacción inmediata a un inbound del cliente → ventana abierta.
    await enqueueOutbound({
      to: customerTo,
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
    // El admin a avisar es el de la operación de la conversación, no «el»
    // admin: escalar un chat colombiano no puede sonar el teléfono del
    // administrador guatemalteco.
    const conn = await resolveOperationForContact(contact.id)
      .then((op) => resolveDropiConnection(op))
      .catch(() => null);
    const adminPhone = conn?.adminPhone;
    if (adminPhone) {
      const customerLabel = contact.name ?? `+${customerTo ?? "?"}`;
      const phoneLine = customerTo ? `\n📱 +${customerTo}` : "";
      const reasonLine = REASON_LABEL[reason];
      const detailLine = detail ? `\n\n_${detail}_` : "";
      const body =
        `🚨 *Escalación a humano*\n\n` +
        `*${customerLabel}* — ${reasonLine}.${phoneLine}${detailLine}\n\n` +
        `El agente quedó apagado para esta conversación. Responde desde el inbox.`;
      const hourBucket = Math.floor(Date.now() / 3_600_000);
      await enqueueOutbound({
        to: adminPhone.replace(/\D/g, ""),
        body,
        source: "escalation",
        dedupKey: `escalation-admin-${contact.id}-${reason}-${hourBucket}`,
        // Fuera de la ventana de 24h con el admin, cae a plantilla aprobada.
        fallbackTemplate: {
          name: ADMIN_ALERTA_TEMPLATE,
          params: [
            sanitizeParam(customerLabel),
            sanitizeParam(`${reasonLine}${detail ? ` — ${detail}` : ""}`),
            sanitizeParam(customerTo ?? "desconocido"),
          ],
        },
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
