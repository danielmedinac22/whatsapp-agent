import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { getKapsoConnection } from "../kapso/connection";
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
