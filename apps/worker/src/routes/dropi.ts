import { Hono } from "hono";
import { and, eq, inArray } from "@wa/db";
import {
  conversations,
  contacts,
  dropiOrders,
  shopifyOrders,
  type Operation,
} from "@wa/db";
import { dropiConnectionInput } from "@wa/shared";
import { db } from "../db";
import { logger } from "../lib/logger";
import {
  getDropiConnection,
  invalidateDropiConnectionCache,
  requireSoleActiveOperation,
  upsertDropiConnection,
} from "../dropi/config";
import { enqueueDropiSyncNow, runDropiSync } from "../jobs/dropi-sync";
import {
  confirmDropiOrderById,
  enqueueDropiConfirm,
} from "../jobs/dropi-confirm";
import { enqueueDropiPollNow } from "../jobs/dropi-poll";
import { DropiHttpError } from "../dropi/client";

export const dropi = new Hono();

/**
 * De qué operación habla el panel. Hasta que exista el selector (ticket 07) el
 * panel no manda ninguna, así que se resuelve la única activa — y con dos
 * activas falla en vez de adivinar. Cuando llegue el selector, se cambia aquí
 * y todas las rutas de este archivo quedan migradas de una vez.
 */
async function panelOperation(): Promise<Operation> {
  return requireSoleActiveOperation();
}

dropi.get("/connection", async (c) => {
  const op = await panelOperation().catch(() => null);
  if (!op) return c.json(null);
  const row = await getDropiConnection(op);
  if (!row) return c.json(null);
  return c.json({
    apiBaseUrl: row.apiBaseUrl,
    email: row.email,
    userId: row.userId,
    hasBearer: Boolean(row.bearerToken),
    hasPassword: Boolean(row.password),
    tokenExpiresAt: row.tokenExpiresAt,
    assetsBaseUrl: row.assetsBaseUrl,
    connectedAt: row.connectedAt,
    updatedAt: row.updatedAt,
    lastAutoLoginAt: row.lastAutoLoginAt,
    lastAutoLoginError: row.lastAutoLoginError,
    adminPhone: row.adminPhone,
    pending2faExpiresAt: row.pending2faExpiresAt,
    pending2faRequestedAt: row.pending2faRequestedAt,
    has2faPending: Boolean(
      row.pending2faToken &&
        row.pending2faExpiresAt &&
        row.pending2faExpiresAt.getTime() > Date.now(),
    ),
  });
});

dropi.post("/connection/refresh", async (c) => {
  const { refreshDropiAuth, Dropi2FAPendingError } = await import(
    "../dropi/auth"
  );
  try {
    const auth = await refreshDropiAuth(await panelOperation());
    return c.json({ ok: true, userId: auth.userId });
  } catch (err) {
    if (err instanceof Dropi2FAPendingError) {
      return c.json({
        ok: false,
        pending2fa: true,
        error:
          "Dropi pidió código 2FA. Revisa WhatsApp o pega el código en el panel.",
      });
    }
    logger.error({ err }, "manual dropi auto-login failed");
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

dropi.post("/connection/2fa/submit", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { code?: string };
  const code = (body.code ?? "").trim();
  if (!/^\d{4,8}$/.test(code)) {
    return c.json(
      { ok: false, error: "código inválido (esperado 4-8 dígitos)" },
      400,
    );
  }
  const { submitDropi2FACode } = await import("../dropi/auth");
  const result = await submitDropi2FACode(await panelOperation(), code);
  if (!result.ok) {
    return c.json({ ok: false, error: result.error }, 400);
  }
  return c.json({ ok: true, userId: result.auth.userId });
});

dropi.put("/connection", async (c) => {
  const parsed = dropiConnectionInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const v = parsed.data;
  const patch: Parameters<typeof upsertDropiConnection>[1] = {};
  if (v.apiBaseUrl !== undefined) patch.apiBaseUrl = v.apiBaseUrl;
  if (v.email !== undefined) patch.email = v.email ?? null;
  if (v.password !== undefined) patch.password = v.password ?? null;
  if (v.bearerToken !== undefined) {
    patch.bearerToken = v.bearerToken ?? null;
    // reset derived metadata; getValidDropiAuth will rederive from JWT.
    patch.userId = null;
    patch.tokenExpiresAt = null;
  }
  if (v.assetsBaseUrl !== undefined) {
    patch.assetsBaseUrl = v.assetsBaseUrl;
  }
  if (v.adminPhone !== undefined) {
    patch.adminPhone = v.adminPhone ?? null;
  }
  patch.connectedAt = new Date();
  await upsertDropiConnection(await panelOperation(), patch);
  return c.json({ ok: true });
});

dropi.delete("/connection", async (c) => {
  const op = await panelOperation();
  await upsertDropiConnection(op, {
    email: null,
    password: null,
    bearerToken: null,
    userId: null,
    tokenExpiresAt: null,
    connectedAt: null,
  });
  invalidateDropiConnectionCache(op);
  return c.json({ ok: true });
});

dropi.post("/sync/run", async (c) => {
  try {
    const result = await runDropiSync();
    return c.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "manual dropi sync failed");
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

dropi.post("/sync/enqueue", async (c) => {
  const id = await enqueueDropiSyncNow();
  return c.json({ ok: true, jobId: id });
});

dropi.post("/poll/enqueue", async (c) => {
  const id = await enqueueDropiPollNow();
  return c.json({ ok: true, jobId: id });
});

/**
 * Triggered by web after a manual confirmation in the inbox.
 * Looks up active Shopify orders for the contact and enqueues a
 * dropi-confirm for each.
 */
dropi.post("/confirm-by-conversation", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    conversationId?: string;
  };
  if (!body.conversationId) {
    return c.json({ error: "conversationId required" }, 400);
  }
  const [conv] = await db
    .select({ contactId: conversations.contactId })
    .from(conversations)
    .where(eq(conversations.id, body.conversationId))
    .limit(1);
  if (!conv) return c.json({ error: "conversation not found" }, 404);

  const orders = await db
    .select({ id: shopifyOrders.id })
    .from(shopifyOrders)
    .where(
      and(
        eq(shopifyOrders.contactId, conv.contactId),
        inArray(shopifyOrders.status, [
          "received",
          "followup_scheduled",
          "followup_sent",
        ]),
      ),
    );
  for (const o of orders) {
    await enqueueDropiConfirm(o.id);
  }
  return c.json({ ok: true, enqueued: orders.length });
});

/**
 * List dropi orders (for UI). Optional filter for low-confidence matches.
 */
dropi.get("/orders", async (c) => {
  const onlyLow = c.req.query("onlyLow") === "1";
  const rows = await db
    .select({
      dropi: dropiOrders,
      shopify: shopifyOrders,
      contact: contacts,
    })
    .from(dropiOrders)
    .leftJoin(shopifyOrders, eq(dropiOrders.shopifyOrderRowId, shopifyOrders.id))
    .leftJoin(contacts, eq(dropiOrders.contactId, contacts.id))
    .limit(200);
  const filtered = onlyLow
    ? rows.filter((r) => r.dropi.matchConfidence === "low")
    : rows;
  return c.json(filtered);
});

/**
 * Manual confirmation triggered from /pedidos UI.
 * Takes the dropi_orders.id (UUID, our internal row id) and runs the PUT
 * synchronously so the UI can show success/failure right away.
 */
dropi.post("/orders/:id/confirm", async (c) => {
  const id = c.req.param("id");
  try {
    const r = await confirmDropiOrderById(id, { force: true });
    return c.json(r);
  } catch (err) {
    const status = err instanceof DropiHttpError ? err.status : 500;
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      status >= 400 && status < 600 ? (status as 400) : 500,
    );
  }
});

dropi.post("/orders/:id/link", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    shopifyOrderRowId?: string | null;
  };
  await db
    .update(dropiOrders)
    .set({
      shopifyOrderRowId: body.shopifyOrderRowId ?? null,
      matchConfidence: "manual",
      updatedAt: new Date(),
    })
    .where(eq(dropiOrders.id, id));
  return c.json({ ok: true });
});
