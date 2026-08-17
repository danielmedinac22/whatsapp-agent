import type { Contact } from "@wa/db";
import { logger } from "../lib/logger";
import { findOperationByDropiAdminPhone } from "./config";
import { submitDropi2FACode } from "./auth";
import { enqueueOutbound } from "../jobs/outbound";

const CODE_REGEX = /^\d{4,8}$/;

function normalize(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

/**
 * Si el mensaje viene del admin configurado y es un código numérico de 4-8
 * dígitos, y hay un challenge 2FA pendiente, lo canjea por el JWT real y
 * responde por WhatsApp con el resultado. Devuelve `true` si el mensaje
 * fue interceptado (no debe seguir a confirmation-ack ni al agente).
 *
 * La operación se resuelve por el dato, no por el llamador: un código que
 * llega por WhatsApp no trae más contexto que quién lo mandó, así que se busca
 * la operación cuya logística tiene ese teléfono de administrador.
 */
export async function tryHandleDropi2FAInbound(input: {
  contact: Contact;
  body: string;
}): Promise<boolean> {
  const text = input.body.trim();
  if (!CODE_REGEX.test(text)) return false;

  const senderDigits = normalize(input.contact.phone);
  if (!senderDigits) return false;

  const found = await findOperationByDropiAdminPhone(senderDigits);
  if (!found) return false;
  const { operation, connection } = found;
  if (!connection.pending2faToken) return false;
  const adminDigits = normalize(connection.adminPhone);

  // Es del admin, hay challenge pendiente, parece un código.
  logger.info(
    { contactId: input.contact.id, operation: operation.countryCode },
    "dropi.2fa code received from admin — submitting",
  );

  const result = await submitDropi2FACode(operation, text);
  let reply: string;
  if (result.ok) {
    reply = `✅ Token Dropi renovado · user ${result.auth.userId}`;
  } else {
    reply = `❌ ${result.error}`;
  }
  // Respuesta inmediata a un inbound del admin → ventana de 24h abierta.
  await enqueueOutbound({
    to: adminDigits,
    body: reply,
    source: "dropi_2fa",
    dedupKey: `dropi-2fa-reply-${Date.now()}`,
  }).catch((err) => {
    logger.error({ err: String(err) }, "dropi.2fa reply enqueue failed");
  });
  return true;
}
