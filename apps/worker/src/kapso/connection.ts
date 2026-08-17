import { eq } from "@wa/db";
import { kapsoConnection, type KapsoConnection, type Operation } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import {
  type InboundOperationDecision,
  OperationScopedCache,
  decideInboundOperation,
  getSingleActiveOperation,
} from "../operations";
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

const cache = new OperationScopedCache<KapsoConnection | null>();
/** El catálogo entero, para resolver el entrante por su `phone_number_id`. */
let allConnectionsCache: { rows: KapsoConnection[]; at: number } | null = null;
const CACHE_MS = 30_000;

/**
 * La conexión de WhatsApp de una operación.
 *
 * **Estricta**: una operación sin conexión propia devuelve `null`, no la
 * conexión de otra.
 *
 * El contract (ticket 06) le quitó el caso `operationId: null`, que leía la
 * fila singleton `id = 1` —o sea, siempre Guatemala— y con él la versión con red
 * `resolveKapsoConnection`. Esa red cubría un solo estado: «la operación única
 * existe pero su conexión quedó sin etiquetar». La `0021` volvió
 * `kapso_connection.operation_id` obligatoria, así que ese estado ya no puede
 * existir en la base y la red no tenía nada que atrapar.
 */
export async function getKapsoConnection(
  op: Operation,
): Promise<KapsoConnection | null> {
  const hit = cache.get(op.id);
  if (hit) return hit.value;
  const [row] = await db
    .select()
    .from(kapsoConnection)
    .where(eq(kapsoConnection.operationId, op.id))
    .limit(1);
  const value = row ?? null;
  cache.set(op.id, value);
  return value;
}

/** Sin argumento borra la caché entera; con una operación, solo su entrada. */
export function invalidateKapsoConnectionCache(op?: Operation): void {
  cache.invalidate(op?.id);
  allConnectionsCache = null;
}

/** The active phone_number_id, or throw — send paths need it. */
export async function requirePhoneNumberId(op: Operation): Promise<string> {
  const conn = await getKapsoConnection(op);
  if (!conn?.phoneNumberId) {
    throw new Error(
      `Kapso connection not configured for ${op.countryCode} (no phone_number_id)`,
    );
  }
  return conn.phoneNumberId;
}

/** Todas las conexiones registradas — el catálogo de ruteo del entrante. */
async function listKapsoConnections(): Promise<KapsoConnection[]> {
  if (allConnectionsCache && Date.now() - allConnectionsCache.at < CACHE_MS) {
    return allConnectionsCache.rows;
  }
  const rows = await db.select().from(kapsoConnection);
  allConnectionsCache = { rows, at: Date.now() };
  return rows;
}

/**
 * La operación de un mensaje entrante, por el número que lo recibió.
 *
 * Es el único punto del sistema donde el `phone_number_id` del webhook decide
 * algo: hasta esta migración solo se usaba para el acuse de lectura. La
 * decisión que devuelve **nunca dice "descartar"** — ver
 * {@link decideInboundOperation}.
 */
export async function resolveInboundOperation(
  phoneNumberId: string,
): Promise<InboundOperationDecision> {
  const [connections, single] = await Promise.all([
    listKapsoConnections(),
    getSingleActiveOperation(),
  ]);
  return decideInboundOperation({
    phoneNumberId,
    connections,
    singleOperationId: single?.id ?? null,
  });
}

export function webhookUrl(): string {
  return `${publicBaseUrl()}/kapso/webhook`;
}

/**
 * Bind this worker to a Kapso WhatsApp number: verify it exists in the
 * project, persist the row of that operation, and register the number-scoped
 * inbound webhook pointing at this worker's public URL.
 *
 * La operación es un parámetro obligatorio desde el contract: antes se
 * etiquetaba con la operación única y, si había más de una, se omitía el campo
 * y la fila conservaba la que ya tuviera. Con `operation_id` obligatoria eso ya
 * no se puede escribir — y no debe: conectar un número es decir de qué
 * operación es.
 */
export async function connectKapsoNumber(
  op: Operation,
  phoneNumberId: string,
): Promise<KapsoConnection> {
  const numbers = await listPhoneNumbers();
  const found = numbers.find((n) => n.phone_number_id === phoneNumberId);
  if (!found) {
    throw new Error(
      `phone_number_id ${phoneNumberId} not found in the Kapso project`,
    );
  }

  const existing = await getKapsoConnection(op);
  const now = new Date();
  const values = {
    operationId: op.id,
    phoneNumberId: found.phone_number_id,
    businessAccountId: found.business_account_id,
    displayPhoneNumber: found.display_phone_number,
    displayName: found.display_name ?? found.name,
    kind: found.kind,
    connectedAt: now,
    updatedAt: now,
  };
  // `id` es el entero con `default 1` heredado del singleton: la conexión de
  // una segunda operación necesita el suyo o choca contra la clave primaria.
  const [row] = existing
    ? await db
        .update(kapsoConnection)
        .set(values)
        .where(eq(kapsoConnection.id, existing.id))
        .returning()
    : await db
        .insert(kapsoConnection)
        .values({ id: await nextKapsoConnectionId(), ...values })
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
    .where(eq(kapsoConnection.id, row!.id))
    .returning();
  invalidateKapsoConnectionCache();

  logger.info(
    {
      phoneNumberId,
      waba: found.business_account_id,
      kind: found.kind,
      operation: op.countryCode,
    },
    "kapso: number connected + webhook registered",
  );
  return updated ?? row!;
}

async function nextKapsoConnectionId(): Promise<number> {
  const rows = await db.select({ id: kapsoConnection.id }).from(kapsoConnection);
  return rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
}
