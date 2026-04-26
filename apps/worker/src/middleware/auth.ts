import type { MiddlewareHandler } from "hono";

export function auth(): MiddlewareHandler {
  const expected = process.env.WORKER_API_TOKEN;
  return async (c, next) => {
    if (!expected) {
      return c.json({ error: "WORKER_API_TOKEN not configured" }, 500);
    }
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token !== expected) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
