import { Hono } from "hono";
import { eq } from "@wa/db";
import { shopifyConnection } from "@wa/db";
import { shopifyConnectionInput } from "@wa/shared";
import { db } from "../db";
import {
  invalidateShopifyConnectionCache,
  pingShopify,
} from "../shopify/admin";

export const shopifyConn = new Hono();

shopifyConn.get("/connection", async (c) => {
  const [row] = await db
    .select()
    .from(shopifyConnection)
    .where(eq(shopifyConnection.id, 1))
    .limit(1);
  if (!row) return c.json(null);
  // Never return the raw token to the browser; just signal it's set.
  return c.json({
    shopDomain: row.shopDomain,
    apiVersion: row.apiVersion,
    hasToken: Boolean(row.adminAccessToken),
    connectedAt: row.connectedAt,
    updatedAt: row.updatedAt,
  });
});

shopifyConn.put("/connection", async (c) => {
  const parsed = shopifyConnectionInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const v = parsed.data;
  const apiVersion = v.apiVersion ?? "2025-01";

  const ping = await pingShopify({
    shopDomain: v.shopDomain,
    adminAccessToken: v.adminAccessToken,
    apiVersion,
  });
  if (!ping.ok) {
    return c.json({ error: `no se pudo conectar: ${ping.error}` }, 400);
  }

  const now = new Date();
  await db
    .insert(shopifyConnection)
    .values({
      id: 1,
      shopDomain: v.shopDomain,
      adminAccessToken: v.adminAccessToken,
      apiVersion,
      connectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: shopifyConnection.id,
      set: {
        shopDomain: v.shopDomain,
        adminAccessToken: v.adminAccessToken,
        apiVersion,
        connectedAt: now,
        updatedAt: now,
      },
    });
  invalidateShopifyConnectionCache();
  return c.json({ ok: true, shopName: ping.shopName });
});

shopifyConn.delete("/connection", async (c) => {
  await db.delete(shopifyConnection).where(eq(shopifyConnection.id, 1));
  invalidateShopifyConnectionCache();
  return c.json({ ok: true });
});
