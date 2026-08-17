import { eq } from "@wa/db";
import { kapsoConnection, type KapsoConnection } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import {
  type InboundOperationDecision,
  type OperationRef,
  OperationScopedCache,
  canUseSingleOperationFallback,
  decideInboundOperation,
  getSingleOperationId,
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

/** La fila singleton previa a la migración: la operación única vive ahí. */
const SINGLETON_ID = 1;

const cache = new OperationScopedCache<KapsoConnection | null>();
/** El catálogo entero, para resolver el entrante por su `phone_number_id`. */
let allConnectionsCache: { rows: KapsoConnection[]; at: number } | null = null;
const CACHE_MS = 30_000;

/**
 * La conexión de WhatsApp de una operación.
 *
 * **Estricta**: una operación sin conexión propia devuelve `null`, no la
 * conexión de otra. `operationId: null` significa *la operación única* y lee la
 * fila singleton `id = 1` — el comportamiento exacto de antes de la migración.
 *
 * Quien no pueda quedarse sin conexión (todo camino de envío) usa
 * {@link resolveKapsoConnection}, que es la versión con red.
 */
export async function getKapsoConnection(
  operationId: OperationRef,
): Promise<KapsoConnection | null> {
  const hit = cache.get(operationId);
  if (hit) return hit.value;
  const [row] = await db
    .select()
    .from(kapsoConnection)
    .where(
      operationId === null
        ? eq(kapsoConnection.id, SINGLETON_ID)
        : eq(kapsoConnection.operationId, operationId),
    )
    .limit(1);
  const value = row ?? null;
  cache.set(operationId, value);
  return value;
}

/**
 * La conexión con la que se atiende a una operación, **con la red de seguridad
 * de la operación única**.
 *
 * Resuelve estricto primero. Si la operación pedida no tiene conexión propia
 * *y* resulta ser la única operación activa que existe, cae en la fila
 * singleton y **deja un error en el log**. Es la misma regla que el pipeline de
 * entrada: dejar de enviar es peor que enviar por el único número que hay, y
 * ese estado (una operación viva sin conexión etiquetada) es una
 * desconfiguración que hay que ver, no un caso normal.
 *
 * La red no adivina: si la operación pedida **no** es la única activa, no cae en
 * nada. Mandar el mensaje de un país por el número de otro sería peor que no
 * mandarlo, y ese es el escenario que aparece en cuanto exista Colombia.
 */
export async function resolveKapsoConnection(
  operationId: OperationRef,
): Promise<KapsoConnection | null> {
  const direct = await getKapsoConnection(operationId);
  if (direct || operationId === null) return direct;

  const single = await getSingleOperationId();
  if (!canUseSingleOperationFallback(operationId, single)) return null;

  const fallback = await getKapsoConnection(null);
  logger.error(
    { operationId, phoneNumberId: fallback?.phoneNumberId ?? null },
    "kapso: la operación única no tiene conexión etiquetada; se atiende con la fila singleton",
  );
  return fallback;
}

/**
 * Sin argumento borra la caché entera; con una operación borra su entrada y la
 * de la operación única. Ver {@link OperationScopedCache.invalidate}.
 */
export function invalidateKapsoConnectionCache(
  operationId?: OperationRef,
): void {
  cache.invalidate(operationId);
  allConnectionsCache = null;
}

/** The active phone_number_id, or throw — send paths need it. */
export async function requirePhoneNumberId(
  operationId: OperationRef,
): Promise<string> {
  const conn = await resolveKapsoConnection(operationId);
  if (!conn?.phoneNumberId) {
    throw new Error("Kapso connection not configured (no phone_number_id)");
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
  const [connections, singleOperationId] = await Promise.all([
    listKapsoConnections(),
    getSingleOperationId(),
  ]);
  return decideInboundOperation({
    phoneNumberId,
    connections,
    singleOperationId,
  });
}

export function webhookUrl(): string {
  return `${publicBaseUrl()}/kapso/webhook`;
}

/**
 * Bind this worker to a Kapso WhatsApp number: verify it exists in the
 * project, persist the singleton row, and register the number-scoped inbound
 * webhook pointing at this worker's public URL.
 *
 * La conexión declara a qué operación pertenece. Sin `operationId` explícito se
 * etiqueta con la operación única; si hay más de una, el campo se omite y la
 * fila conserva la operación que ya tuviera — reconectar un número no puede
 * cambiarle el país por descuido.
 */
export async function connectKapsoNumber(
  phoneNumberId: string,
  operationId?: string,
): Promise<KapsoConnection> {
  const numbers = await listPhoneNumbers();
  const found = numbers.find((n) => n.phone_number_id === phoneNumberId);
  if (!found) {
    throw new Error(
      `phone_number_id ${phoneNumberId} not found in the Kapso project`,
    );
  }

  const owner = operationId ?? (await getSingleOperationId());
  const now = new Date();
  const values = {
    id: SINGLETON_ID,
    ...(owner ? { operationId: owner } : {}),
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
    .where(eq(kapsoConnection.id, SINGLETON_ID))
    .returning();
  invalidateKapsoConnectionCache();

  logger.info(
    {
      phoneNumberId,
      waba: found.business_account_id,
      kind: found.kind,
      operationId: owner ?? null,
    },
    "kapso: number connected + webhook registered",
  );
  return updated ?? row!;
}
