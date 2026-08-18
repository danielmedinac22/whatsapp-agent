import { Hono } from "hono";
import { eq } from "@wa/db";
import { shopifyConnection } from "@wa/db";
import { panelOperation } from "../operations";
import { shopifyConnectionInput } from "@wa/shared";
import { db } from "../db";
import {
  getShopifyConnection,
  invalidateShopifyConnectionCache,
  pingShopify,
} from "../shopify/admin";

export const shopifyConn = new Hono();

/**
 * Las tres rutas hablan de la tienda de **una** operación: la que el admin
 * eligió en el riel del panel, que llega en el header `x-operation-id`.
 *
 * Antes leían y borraban `where(id = 1)` de frente, sin pasar por el accesor —
 * el `id = 1` que este ticket sale a borrar. Un GET que siempre muestra la fila
 * uno enseña la tienda de Guatemala aunque el operador crea estar viendo otra,
 * y un DELETE que siempre borra la fila uno borra la de Guatemala.
 */

shopifyConn.get("/connection", async (c) => {
  const row = await getShopifyConnection(await panelOperation(c));
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

  // La tienda declara a qué operación pertenece, y ya no hay forma de guardarla
  // sin decirlo: `operation_id` es obligatoria desde la `0021`.
  const op = await panelOperation(c);
  const existing = await getShopifyConnection(op);
  const now = new Date();
  const values = {
    operationId: op.id,
    shopDomain: v.shopDomain,
    adminAccessToken: v.adminAccessToken,
    apiVersion,
    connectedAt: now,
    updatedAt: now,
  };
  if (existing) {
    await db
      .update(shopifyConnection)
      .set(values)
      .where(eq(shopifyConnection.id, existing.id));
  } else {
    // `id` es el entero con `default 1` heredado del singleton: la tienda de una
    // segunda operación necesita el suyo o choca contra la clave primaria.
    const rows = await db
      .select({ id: shopifyConnection.id })
      .from(shopifyConnection);
    const nextId = rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
    await db.insert(shopifyConnection).values({ id: nextId, ...values });
  }
  invalidateShopifyConnectionCache(op);
  return c.json({ ok: true, shopName: ping.shopName });
});

shopifyConn.delete("/connection", async (c) => {
  const op = await panelOperation(c);
  await db
    .delete(shopifyConnection)
    .where(eq(shopifyConnection.operationId, op.id));
  invalidateShopifyConnectionCache(op);
  return c.json({ ok: true });
});
