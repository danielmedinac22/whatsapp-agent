import { eq } from "@wa/db";
import { kapsoConnection, type KapsoConnection } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { ensureNumberWebhook, listPhoneNumbers } from "./client";
import { kapsoWebhookSecret, publicBaseUrl } from "./config";

/** Events our number-scoped webhook subscribes to. */
export const WEBHOOK_EVENTS = [
  "whatsapp.message.received",
  "whatsapp.message.sent",
  "whatsapp.message.delivered",
  "whatsapp.message.read",
  "whatsapp.message.failed",
];

let cache: { row: KapsoConnection | null; at: number } | null = null;
const CACHE_MS = 30_000;

/** The singleton Kapso connection row (which number this worker operates). */
export async function getKapsoConnection(): Promise<KapsoConnection | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.row;
  const [row] = await db
    .select()
    .from(kapsoConnection)
    .where(eq(kapsoConnection.id, 1))
    .limit(1);
  cache = { row: row ?? null, at: Date.now() };
  return row ?? null;
}

export function invalidateKapsoConnectionCache(): void {
  cache = null;
}

/** The active phone_number_id, or throw — send paths need it. */
export async function requirePhoneNumberId(): Promise<string> {
  const conn = await getKapsoConnection();
  if (!conn?.phoneNumberId) {
    throw new Error("Kapso connection not configured (no phone_number_id)");
  }
  return conn.phoneNumberId;
}

export function webhookUrl(): string {
  return `${publicBaseUrl()}/kapso/webhook`;
}

/**
 * Bind this worker to a Kapso WhatsApp number: verify it exists in the
 * project, persist the singleton row, and register the number-scoped inbound
 * webhook pointing at this worker's public URL.
 */
export async function connectKapsoNumber(
  phoneNumberId: string,
): Promise<KapsoConnection> {
  const numbers = await listPhoneNumbers();
  const found = numbers.find((n) => n.phone_number_id === phoneNumberId);
  if (!found) {
    throw new Error(
      `phone_number_id ${phoneNumberId} not found in the Kapso project`,
    );
  }

  const now = new Date();
  const values = {
    id: 1,
    phoneNumberId: found.phone_number_id,
    businessAccountId: found.business_account_id,
    displayPhoneNumber: found.display_phone_number,
    displayName: found.display_name ?? found.name,
    kind: found.kind,
    connectedAt: now,
    updatedAt: now,
  };
  const [row] = await db
    .insert(kapsoConnection)
    .values(values)
    .onConflictDoUpdate({ target: kapsoConnection.id, set: values })
    .returning();
  invalidateKapsoConnectionCache();

  await ensureNumberWebhook({
    phoneNumberId,
    url: webhookUrl(),
    secretKey: kapsoWebhookSecret(),
    events: WEBHOOK_EVENTS,
  });
  const [updated] = await db
    .update(kapsoConnection)
    .set({ webhookRegisteredAt: new Date(), updatedAt: new Date() })
    .where(eq(kapsoConnection.id, 1))
    .returning();
  invalidateKapsoConnectionCache();

  logger.info(
    { phoneNumberId, waba: found.business_account_id, kind: found.kind },
    "kapso: number connected + webhook registered",
  );
  return updated ?? row!;
}
