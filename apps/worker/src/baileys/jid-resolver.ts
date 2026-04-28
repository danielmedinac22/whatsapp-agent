import {
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  type WASocket,
} from "baileys";
import { logger } from "../lib/logger";

export type ResolvedIdentity = {
  lid: string | null;
  pnJid: string | null;
  phone: string | null;
  preferredJid: string;
};

export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d+]/g, "");
  if (!digits) return null;
  return digits.startsWith("+") ? digits.slice(1) : digits;
}

export function jidFromPhone(phone: string): string {
  return `${phone}@s.whatsapp.net`;
}

function extractPhoneFromPnJid(pnJid: string | null): string | null {
  if (!pnJid) return null;
  return pnJid.split("@")[0]?.split(":")[0] ?? null;
}

function buildIdentity(
  lid: string | null,
  pnJid: string | null,
): ResolvedIdentity {
  const preferredJid = lid ?? pnJid;
  if (!preferredJid) {
    throw new Error("ResolvedIdentity requires at least one of lid or pnJid");
  }
  return {
    lid,
    pnJid,
    phone: extractPhoneFromPnJid(pnJid),
    preferredJid,
  };
}

/**
 * Given any inbound JID (LID or PN), resolve the counterpart via Baileys' lidMapping.
 * The mapping store may not yet know the pair — in that case the missing side is null
 * and will be backfilled on a later inbound when WhatsApp Server sends the mapping.
 */
export async function resolveIdentity(
  sock: WASocket,
  rawJid: string,
): Promise<ResolvedIdentity> {
  const jid = jidNormalizedUser(rawJid);
  const lidStore = sock.signalRepository?.lidMapping;

  if (isLidUser(jid)) {
    let pnJid: string | null = null;
    try {
      pnJid = (await lidStore?.getPNForLID(jid)) ?? null;
    } catch (err) {
      logger.warn({ err, jid }, "lidMapping.getPNForLID failed");
    }
    return buildIdentity(jid, pnJid);
  }

  if (isPnUser(jid)) {
    let lid: string | null = null;
    try {
      lid = (await lidStore?.getLIDForPN(jid)) ?? null;
    } catch (err) {
      logger.warn({ err, jid }, "lidMapping.getLIDForPN failed");
    }
    return buildIdentity(lid, jid);
  }

  // Unknown JID shape — treat as PN-ish so we still return something usable.
  return buildIdentity(null, jid);
}

/**
 * Given a raw phone number (e.g. from a Shopify webhook), confirm it's on WhatsApp,
 * obtain the PN-JID, and try to resolve the LID counterpart from the mapping store.
 */
export async function resolveFromPhone(
  sock: WASocket,
  phone: string,
): Promise<ResolvedIdentity | null> {
  let pnJid: string | null = null;
  try {
    const results = await sock.onWhatsApp(`+${phone}`);
    const hit = results?.[0];
    if (hit?.exists && hit.jid) {
      pnJid = jidNormalizedUser(hit.jid);
    }
  } catch (err) {
    logger.warn({ err, phone }, "onWhatsApp lookup failed");
  }

  if (!pnJid) {
    // Fall back to constructed PN-JID. Caller decides whether to send anyway.
    pnJid = jidFromPhone(phone);
  }

  let lid: string | null = null;
  try {
    lid = (await sock.signalRepository?.lidMapping?.getLIDForPN(pnJid)) ?? null;
  } catch (err) {
    logger.warn({ err, pnJid }, "lidMapping.getLIDForPN failed");
  }

  return buildIdentity(lid, pnJid);
}
