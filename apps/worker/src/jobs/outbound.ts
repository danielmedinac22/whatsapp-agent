import { eq } from "@wa/db";
import {
  contacts,
  conversations,
  messages,
  outboundMessages,
  type OutboundMessage,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { getSocket, getStatus } from "../baileys/session";
import { classifyBaileysError } from "../lib/baileys-errors";
import { OUTBOUND_QUEUE, getBoss } from "./queue";

const MAX_BODY_LEN = 4096;

interface EnqueueInput {
  jid: string;
  body: string;
  source:
    | "followup"
    | "remarketing"
    | "agent"
    | "manual"
    | "confirmation_ack"
    | "dropi_status";
  sourceRef?: string | null;
  dedupKey: string;
  conversationId?: string | null;
  sentByUserId?: string | null;
  /** ms from now to defer the first attempt */
  delayMs?: number;
}

export async function enqueueOutbound(input: EnqueueInput): Promise<{
  outboundId: string;
  enqueued: boolean;
}> {
  const scheduledFor = input.delayMs && input.delayMs > 0
    ? new Date(Date.now() + input.delayMs)
    : new Date();

  const inserted = await db
    .insert(outboundMessages)
    .values({
      jid: input.jid,
      body: input.body,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      dedupKey: input.dedupKey,
      conversationId: input.conversationId ?? null,
      sentByUserId: input.sentByUserId ?? null,
      scheduledFor,
    })
    .onConflictDoNothing({ target: outboundMessages.dedupKey })
    .returning({ id: outboundMessages.id });

  if (inserted.length === 0) {
    const [existing] = await db
      .select({ id: outboundMessages.id })
      .from(outboundMessages)
      .where(eq(outboundMessages.dedupKey, input.dedupKey))
      .limit(1);
    if (existing) {
      logger.debug(
        { dedupKey: input.dedupKey, outboundId: existing.id },
        "outbound: dedup hit, not re-enqueued",
      );
      return { outboundId: existing.id, enqueued: false };
    }
    throw new Error(
      `outbound dedup conflict but row not found for ${input.dedupKey}`,
    );
  }

  const outboundId = inserted[0]!.id;
  const boss = await getBoss();
  const startAfter = input.delayMs && input.delayMs > 0
    ? Math.floor(input.delayMs / 1000)
    : 0;

  await boss.send(
    OUTBOUND_QUEUE,
    { outboundId },
    {
      singletonKey: input.dedupKey,
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      ...(startAfter > 0 ? { startAfter } : {}),
    },
  );

  logger.info(
    { outboundId, source: input.source, jid: input.jid, dedupKey: input.dedupKey },
    "outbound: enqueued",
  );
  return { outboundId, enqueued: true };
}

interface OutboundJob {
  outboundId: string;
}

async function loadRow(id: string): Promise<OutboundMessage | undefined> {
  const [row] = await db
    .select()
    .from(outboundMessages)
    .where(eq(outboundMessages.id, id))
    .limit(1);
  return row;
}

async function markPermanent(
  id: string,
  err: unknown,
  attempts: number,
): Promise<void> {
  await db
    .update(outboundMessages)
    .set({
      status: "dead",
      failedAt: new Date(),
      lastError: err instanceof Error ? err.message : String(err),
      lastErrorKind: "permanent",
      attempts,
      updatedAt: new Date(),
    })
    .where(eq(outboundMessages.id, id));
}

async function markTransientFailure(
  id: string,
  err: unknown,
  attempts: number,
): Promise<void> {
  await db
    .update(outboundMessages)
    .set({
      status: "pending",
      lastError: err instanceof Error ? err.message : String(err),
      lastErrorKind: "transient",
      attempts,
      updatedAt: new Date(),
    })
    .where(eq(outboundMessages.id, id));
}

async function handleOutbound(payload: OutboundJob): Promise<void> {
  const row = await loadRow(payload.outboundId);
  if (!row) {
    logger.warn({ outboundId: payload.outboundId }, "outbound: row not found");
    return;
  }

  // Idempotency guard — already terminal or completed.
  if (
    row.status === "acked" ||
    row.status === "dead" ||
    row.status === "failed" ||
    (row.status === "sent" && row.ackedAt)
  ) {
    return;
  }

  // Body length is a permanent error — don't retry.
  if (row.body.length > MAX_BODY_LEN) {
    await markPermanent(
      row.id,
      new Error(`body too long (${row.body.length} > ${MAX_BODY_LEN})`),
      row.attempts + 1,
    );
    return;
  }

  const sock = getSocket();
  const { status: connStatus } = getStatus();
  if (!sock || connStatus !== "connected") {
    await markTransientFailure(
      row.id,
      new Error(`socket not connected (status=${connStatus})`),
      row.attempts + 1,
    );
    throw new Error("socket not connected"); // pg-boss retries with backoff
  }

  // Mark sending so observers see in-flight state.
  await db
    .update(outboundMessages)
    .set({
      status: "sending",
      attempts: row.attempts + 1,
      updatedAt: new Date(),
    })
    .where(eq(outboundMessages.id, row.id));

  // Light typing indicator (best-effort).
  try {
    await sock.sendPresenceUpdate("composing", row.jid);
    await new Promise((r) => setTimeout(r, Math.min(row.body.length * 25, 1800)));
    await sock.sendPresenceUpdate("paused", row.jid);
  } catch {
    /* ignore presence failures */
  }

  let waId: string | null = null;
  try {
    const result = await sock.sendMessage(row.jid, { text: row.body });
    waId = result?.key?.id ?? null;
    if (!waId) {
      throw new Error("sendMessage returned without key.id");
    }
  } catch (err) {
    const kind = classifyBaileysError(err);
    if (kind === "permanent") {
      await markPermanent(row.id, err, row.attempts + 1);
      logger.warn(
        { outboundId: row.id, err: err instanceof Error ? err.message : err },
        "outbound: permanent failure, marked dead",
      );
      return; // no throw → pg-boss completes the job
    }
    await markTransientFailure(row.id, err, row.attempts + 1);
    logger.warn(
      { outboundId: row.id, err: err instanceof Error ? err.message : err },
      "outbound: transient failure, will retry",
    );
    throw err; // pg-boss retries with backoff
  }

  await db
    .update(outboundMessages)
    .set({
      status: "sent",
      waId,
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(outboundMessages.id, row.id));

  // Mirror the outbound into messages so the chat UI shows it for every source
  // (followup/remarketing didn't write to messages before — this fixes that).
  // conversationId may be null for manual sends without context; resolve via JID
  // if not provided.
  let convId = row.conversationId;
  if (!convId) {
    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(eq(contacts.jid, row.jid))
      .limit(1);
    convId = conv?.id ?? null;
  }
  if (convId) {
    const insertValues = {
      conversationId: convId,
      direction: "out" as const,
      waId,
      body: row.body,
      status: "sent" as const,
      fromAgent: row.source === "agent",
      sentByUserId: row.sentByUserId ?? null,
    };
    if (row.source === "agent") {
      // Preserve fromAgent=true even if the Baileys echo (messages.upsert)
      // raced and inserted the row first with default fromAgent=false.
      await db
        .insert(messages)
        .values(insertValues)
        .onConflictDoUpdate({
          target: messages.waId,
          set: { fromAgent: true, status: "sent" },
        });
    } else {
      await db
        .insert(messages)
        .values(insertValues)
        .onConflictDoNothing({ target: messages.waId });
    }
  }

  logger.info(
    { outboundId: row.id, waId, source: row.source, attempts: row.attempts + 1 },
    "outbound: sent",
  );
}

export async function startOutboundWorker(): Promise<void> {
  const boss = await getBoss();
  const workerId = await boss.work<OutboundJob>(OUTBOUND_QUEUE, async (raw) => {
    const list = (Array.isArray(raw) ? raw : [raw]) as Array<{
      id?: string;
      data?: OutboundJob;
    }>;
    for (const job of list) {
      const data = (job?.data ?? job) as OutboundJob;
      if (!data?.outboundId) {
        logger.warn({ jobId: job?.id }, "outbound worker: missing outboundId");
        continue;
      }
      await handleOutbound(data);
    }
  });
  logger.info({ workerId }, "outbound worker started");
}
