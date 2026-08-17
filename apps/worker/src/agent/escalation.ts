import { eq } from "@wa/db";
import {
  contacts,
  resolveOperationForContact,
  type Contact,
} from "@wa/db";
import { db } from "../db";
import type { SalesEscalationTrigger } from "../sales/escalation-triggers";
import { logger } from "../lib/logger";
import { contactWaId } from "../lib/phone";
import { ADMIN_ALERTA_TEMPLATE, sanitizeParam } from "../kapso/templates";
import { enqueueOutbound } from "../jobs/outbound";
import { getDropiConnection } from "../dropi/config";

/**
 * Por qué una conversación pasa a manos humanas.
 *
 * Los tres primeros son de siempre. Los cuatro `sales_*` los suma la
 * conversación de venta, y **son motivos nuevos de este módulo, no un módulo
 * nuevo**: la transición de `agent_mode`, el aviso al cliente, la alerta al
 * admin de la operación correcta y la idempotencia por hora ya estaban
 * resueltas aquí, y duplicarlas para el vendedor habría dado dos caminos que se
 * desincronizan —el clásico: uno gana un arreglo y el otro no—. Quién decide
 * escalar una venta es `sales/escalation-triggers.ts`, que es puro y no toca
 * nada; qué se hace al escalar sigue siendo esto.
 */
export type EscalationReason =
  | "audio_message"
  | "agent_request"
  | "manual"
  | "sales_human_requested"
  | "sales_out_of_rules"
  | "sales_repeated_objection"
  | "sales_product_unidentified";

const REASON_LABEL: Record<EscalationReason, string> = {
  audio_message: "el cliente envió un audio",
  agent_request: "el agente pidió escalar",
  manual: "escalación manual",
  sales_human_requested: "el cliente pidió hablar con una persona",
  sales_out_of_rules: "el cliente pidió algo fuera de las reglas del negocio",
  sales_repeated_objection: "el cliente repitió la misma objeción sin avanzar",
  sales_product_unidentified:
    "dos intentos sin lograr identificar de qué producto habla",
};

/**
 * El aviso de cortesía al cliente, cuando corresponde.
 *
 * Los cuatro de ventas lo tienen y no es adorno: en una venta, el silencio
 * mientras un humano toma el chat es el momento exacto en que el lead se va con
 * la competencia. El de la petición de humano es además la historia 6 del spec
 * —«quien pide hablar con una persona no tiene que insistir»—: se le dice que
 * sí, de una, y no se intenta retenerlo.
 */
const CUSTOMER_NOTICE: Partial<Record<EscalationReason, string>> = {
  audio_message:
    "Recibí tu audio 🎙️ Un asesor te responderá en unos minutos por aquí mismo.",
  sales_human_requested:
    "¡Claro! 🙌 Un asesor te escribe por aquí en unos minutos.",
  sales_out_of_rules:
    "Déjame pasarte con un asesor para revisar eso contigo 🙌 Te escribe por aquí en unos minutos.",
  sales_repeated_objection:
    "Quiero que te resuelvan bien esa duda 🙌 Un asesor te escribe por aquí en unos minutos.",
  sales_product_unidentified:
    "Para no darte información equivocada, te paso con un asesor 🙌 Te escribe por aquí en unos minutos.",
};

/**
 * Qué motivo le corresponde a cada disparador de venta.
 *
 * Existe para que los dos vocabularios no se confundan: el de allá nombra **por
 * qué la conversación se atascó** y es lo que los tests de reglas ejercen; el de
 * aquí nombra **qué se le cuenta al asesor**. La traducción es esta tabla y no
 * un `switch` repartido por el runner.
 */
export const SALES_ESCALATION_REASON: Record<
  SalesEscalationTrigger,
  EscalationReason
> = {
  human_requested: "sales_human_requested",
  out_of_rules_request: "sales_out_of_rules",
  repeated_objection: "sales_repeated_objection",
  product_unidentified: "sales_product_unidentified",
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
      .then((op) => getDropiConnection(op))
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
