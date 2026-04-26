import { Hono } from "hono";

export const health = new Hono();

health.get("/", (c) =>
  c.json({ ok: true, ts: new Date().toISOString() }),
);
