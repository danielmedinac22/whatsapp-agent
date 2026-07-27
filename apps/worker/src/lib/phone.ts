/** Normalize a phone to E.164 digits without "+" (the Cloud API wa_id). */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d+]/g, "");
  if (!digits) return null;
  return digits.startsWith("+") ? digits.slice(1) : digits;
}

/**
 * Sending address for a contact: wa_id, falling back to phone or a legacy
 * Baileys PN-JID for rows that predate the Kapso migration. Null for
 * LID-only legacy contacts (unaddressable via the Cloud API).
 */
export function contactWaId(contact: {
  waId: string | null;
  phone: string | null;
  pnJid: string | null;
  jid: string;
}): string | null {
  if (contact.waId) return contact.waId;
  if (contact.phone) return normalizePhone(contact.phone);
  const legacy = contact.pnJid ?? contact.jid;
  if (legacy?.endsWith("@s.whatsapp.net")) {
    return normalizePhone(legacy.split("@")[0]);
  }
  return null;
}
