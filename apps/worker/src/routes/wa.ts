import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { getKapsoConnection } from "../kapso/connection";
import { isTemplateApproved } from "../kapso/provisioning";
import {
  renderTemplateBody,
  sanitizeParam,
  templateByName,
} from "../kapso/templates";
import { normalizePhone } from "../lib/phone";
import { enqueueOutbound } from "../jobs/outbound";

export const wa = new Hono();

/** Connection status — fed by kapso_connection (no QR/session lifecycle). */
wa.get("/status", async (c) => {
  const conn = await getKapsoConnection();
  return c.json({
    status: conn?.phoneNumberId ? "connected" : "disconnected",
    phone: conn?.displayPhoneNumber ?? null,
    phoneNumberId: conn?.phoneNumberId ?? null,
    displayName: conn?.displayName ?? null,
    kind: conn?.kind ?? null,
    connectedAt: conn?.connectedAt ?? null,
  });
});

const sendSchema = z
  .object({
    to: z.string().min(5).optional(),
    // Legacy field from the web inbox — a Baileys JID or raw phone.
    jid: z.string().min(5).optional(),
    body: z.string().min(1).max(4096),
  })
  .refine((v) => v.to || v.jid, { message: "to (wa_id) is required" });

wa.post("/send", async (c) => {
  const parsed = sendSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const { to, jid, body } = parsed.data;
  const waId = normalizePhone(to ?? jid!.split("@")[0]);
  if (!waId) return c.json({ error: "invalid destination" }, 400);
  const { outboundId } = await enqueueOutbound({
    to: waId,
    body,
    source: "manual",
    dedupKey: `manual:${randomUUID()}`,
  });
  const conn = await getKapsoConnection();
  return c.json({
    ok: true,
    outboundId,
    status: conn?.phoneNumberId ? "connected" : "disconnected",
  });
});

const sendTemplateSchema = z.object({
  to: z.string().min(5),
  templateName: z.string().min(1),
  params: z.array(z.string()).default([]),
  conversationId: z.string().uuid().optional(),
});

/**
 * Operator-initiated template send — the "reopen conversation" path for
 * threads outside the Meta 24h window. Only catalog templates approved for
 * the current WABA are sendable.
 */
wa.post("/send-template", async (c) => {
  const parsed = sendTemplateSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const { to, templateName, params, conversationId } = parsed.data;

  const waId = normalizePhone(to);
  if (!waId) return c.json({ error: "invalid destination" }, 400);
  const def = templateByName(templateName);
  if (!def) return c.json({ error: "unknown template" }, 400);
  const expected = (def.bodyText.match(/\{\{\d+\}\}/g) ?? []).length;
  if (params.length !== expected) {
    return c.json(
      { error: `template expects ${expected} params, got ${params.length}` },
      400,
    );
  }
  if (!(await isTemplateApproved(templateName))) {
    return c.json({ error: "template not approved for this WABA" }, 409);
  }

  const clean = params.map((p) => sanitizeParam(p));
  const { outboundId } = await enqueueOutbound({
    to: waId,
    body: renderTemplateBody(templateName, clean),
    source: "manual",
    dedupKey: `manual-template:${randomUUID()}`,
    conversationId: conversationId ?? null,
    template: { name: templateName, params: clean },
  });
  return c.json({ ok: true, outboundId });
});
