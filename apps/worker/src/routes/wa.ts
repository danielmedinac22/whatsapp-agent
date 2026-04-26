import { Hono } from "hono";
import { z } from "zod";
import {
  getSocket,
  getStatus,
  logoutSession,
  startSession,
} from "../baileys/session";
import { logger } from "../lib/logger";

export const wa = new Hono();

wa.get("/status", (c) => c.json(getStatus()));

wa.post("/start", async (c) => {
  startSession().catch((err) =>
    logger.error({ err }, "startSession threw"),
  );
  return c.json({ ok: true });
});

wa.post("/logout", async (c) => {
  await logoutSession();
  return c.json({ ok: true });
});

const sendSchema = z.object({
  jid: z.string().min(1),
  body: z.string().min(1).max(4096),
});

wa.post("/send", async (c) => {
  const sock = getSocket();
  if (!sock) return c.json({ error: "not connected" }, 409);
  const parsed = sendSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const { jid, body } = parsed.data;
  const result = await sock.sendMessage(jid, { text: body });
  return c.json({ ok: true, id: result?.key.id });
});
