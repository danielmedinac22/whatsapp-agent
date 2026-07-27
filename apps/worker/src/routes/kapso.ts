import { Hono } from "hono";
import { z } from "zod";
import { desc, eq } from "@wa/db";
import { waTemplates, webhookEvents } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import {
  parseInboundMessage,
  parseStatusEvent,
  verifyKapsoSignature,
  type KapsoInboundPayload,
} from "../kapso/inbound";
import { applyDeliveryStatus } from "../kapso/delivery";
import { handleInbound } from "../inbound/pipeline";
import { connectKapsoNumber, getKapsoConnection } from "../kapso/connection";
import {
  ensureKapsoTemplates,
  refreshKapsoTemplateStatuses,
} from "../kapso/provisioning";
import { listPhoneNumbers } from "../kapso/client";

/** Public webhook (HMAC-authenticated, mounted OUTSIDE the Bearer middleware). */
export const kapsoWebhook = new Hono();

kapsoWebhook.post("/webhook", async (c) => {
  const raw = await c.req.text();
  const signature = c.req.header("x-webhook-signature");
  if (!verifyKapsoSignature(raw, signature ?? null)) {
    logger.warn("kapso webhook: invalid signature");
    return c.json({ error: "invalid signature" }, 401);
  }

  let payload: KapsoInboundPayload & { id?: string };
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  // Payload v2 carries the event name and idempotency key in HEADERS, not in
  // the body: X-Webhook-Event + X-Idempotency-Key.
  const eventName =
    c.req.header("x-webhook-event") ?? payload.event ?? null;
  const root = payload.data ?? payload;
  const eventId =
    c.req.header("x-idempotency-key") ??
    payload.id ??
    `${eventName ?? "unknown"}:${root.message?.id ?? raw.length}`;
  const inserted = await db
    .insert(webhookEvents)
    .values({ source: "kapso", eventId, event: eventName })
    .onConflictDoNothing({ target: [webhookEvents.source, webhookEvents.eventId] })
    .returning({ id: webhookEvents.id });
  if (inserted.length === 0) {
    return c.json({ ok: true, deduped: true });
  }

  const status = parseStatusEvent(eventName, payload);
  if (status) {
    await applyDeliveryStatus(status).catch((err) =>
      logger.error({ err, waId: status.waMessageId }, "kapso: status apply failed"),
    );
    return c.json({ ok: true });
  }

  const inbound = parseInboundMessage(payload);
  if (inbound) {
    await handleInbound(inbound).catch((err) => {
      logger.error(
        { err, waId: inbound.waMessageId },
        "kapso: inbound pipeline failed",
      );
    });
    return c.json({ ok: true });
  }

  logger.debug({ event: eventName }, "kapso webhook: ignored event");
  return c.json({ ok: true, ignored: true });
});

/** Admin API (behind the Bearer middleware, /api/kapso/*). */
export const kapsoAdmin = new Hono();

kapsoAdmin.get("/status", async (c) => {
  const conn = await getKapsoConnection();
  const templates = conn?.businessAccountId
    ? await db
        .select({
          name: waTemplates.name,
          status: waTemplates.status,
          statusReason: waTemplates.statusReason,
          lastCheckedAt: waTemplates.lastCheckedAt,
        })
        .from(waTemplates)
        .where(eq(waTemplates.businessAccountId, conn.businessAccountId))
        .orderBy(desc(waTemplates.updatedAt))
    : [];
  return c.json({ connection: conn, templates });
});

kapsoAdmin.get("/numbers", async (c) => {
  return c.json({ numbers: await listPhoneNumbers() });
});

const connectSchema = z.object({ phoneNumberId: z.string().min(3) });

kapsoAdmin.post("/connect", async (c) => {
  const parsed = connectSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const conn = await connectKapsoNumber(parsed.data.phoneNumberId);
  // Sandbox numbers have no real WABA review flow; template submit may fail
  // there — logged, non-fatal.
  await ensureKapsoTemplates().catch((err) =>
    logger.warn({ err: String(err) }, "kapso connect: template submit failed"),
  );
  await refreshKapsoTemplateStatuses().catch(() => {});
  return c.json({ ok: true, connection: conn });
});

kapsoAdmin.post("/templates/sync", async (c) => {
  await ensureKapsoTemplates();
  await refreshKapsoTemplateStatuses();
  const conn = await getKapsoConnection();
  const templates = conn?.businessAccountId
    ? await db
        .select({ name: waTemplates.name, status: waTemplates.status })
        .from(waTemplates)
        .where(eq(waTemplates.businessAccountId, conn.businessAccountId))
    : [];
  return c.json({ ok: true, templates });
});
