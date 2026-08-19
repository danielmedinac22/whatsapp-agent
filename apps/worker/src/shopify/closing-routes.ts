/**
 * Lo que el panel necesita saber de la tienda que no puede resolver solo: qué
 * permite el token, y qué cierres no llegaron a la tienda.
 *
 * **Vive en `shopify/` y no en `routes/` por el mismo motivo que
 * `catalog-routes.ts`**: ese directorio tiene otros dueños en esta ola y dos
 * ramas escribiendo el mismo archivo chocan sin que ningún check local lo vea.
 * Cuando la ola cierre, mudarlo es un `git mv` y una línea en `index.ts`.
 */

import { Hono } from "hono";
import { sql } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { panelOperation } from "../operations";
import {
  SALES_ORDER_DEAD_QUEUE,
  SALES_ORDER_QUEUE,
  type SalesOrderJob,
} from "../jobs/sales-order";
import { getShopifyConnection, verifyStoreConnection } from "./admin";
import { REQUESTED_SCOPES, resolveStoreCapabilities } from "./scopes";
import { storeWriteMode } from "./write-mode";

export const storeClosings = new Hono();

/**
 * El estado de la tienda de una operación: si está conectada, qué permite el
 * token y si la escritura está encendida.
 *
 * Los tres casos salen con `200` y un campo `store`, no como error: **la tienda
 * sin conectar es el estado normal de hoy** (`shopify_connection` está vacía en
 * producción) y la pantalla tiene que poder explicarlo, no mostrar un fallo.
 *
 * La verificación es **entera de solo lectura** — nombre de la tienda, permisos
 * concedidos y un producto— y nunca escribe. Es el riesgo R6 de la
 * no-regresión: al conectar se le da al sistema capacidad de crear pedidos en
 * una tienda viva, así que lo primero que se hace con la credencial es leer.
 */
storeClosings.get("/store/status", async (c) => {
  const op = await panelOperation(c);
  const conn = await getShopifyConnection(op);
  const writeMode = storeWriteMode();

  if (!conn?.shopDomain || !conn.adminAccessToken) {
    return c.json({
      store: "not_connected" as const,
      writeMode,
      requestedScopes: REQUESTED_SCOPES,
    });
  }

  const verified = await verifyStoreConnection(conn);
  if (!verified.ok) {
    return c.json({
      store: "unreachable" as const,
      shopDomain: conn.shopDomain,
      writeMode,
      requestedScopes: REQUESTED_SCOPES,
      error: verified.error,
    });
  }

  const v = verified.verification;
  return c.json({
    store: "connected" as const,
    shopDomain: conn.shopDomain,
    apiVersion: conn.apiVersion,
    shopName: v.shopName,
    writeMode,
    requestedScopes: REQUESTED_SCOPES,
    productsReadable: v.productsReadable,
    productError: v.productError,
    // Sin permisos legibles el informe no se inventa: una consulta que falla no
    // es un dato que no existe, y decir «faltan todos» sería peor que decir
    // «no pude mirar».
    capabilities: v.scopes ? resolveStoreCapabilities(v.scopes) : null,
    scopeError: v.scopeError,
  });
});

interface QueuedRow {
  id: string;
  name: string;
  data: SalesOrderJob;
  state: string;
  retry_count: number;
  retry_limit: number;
  created_on: string;
  start_after: string;
  output: unknown;
}

/**
 * Los cierres que no llegaron a la tienda, con su motivo.
 *
 * Sale de las colas de pg-boss porque ahí es donde el cierre vive: en `data`
 * viajan sus datos completos, que es lo que permite volver a intentarlo o
 * crearlo a mano. No hay tabla propia y no hace falta — una tabla nueva pedía
 * una migración, y el esquema de esta ola tiene otro dueño.
 *
 * Los de `sales-order-dead` son los que **esperan a una persona**: o agotaron
 * los reintentos, o fallaron por algo que reintentar no arregla. Se lo dice la
 * cola en la que están, no su estado: un job de esa cola marcado `completed`
 * significa que la alerta salió, no que el cierre se resolvió.
 */
storeClosings.get("/closings", async (c) => {
  const op = await panelOperation(c);
  try {
    const rows = (await db.execute(sql`
      select id::text, name, data, state::text, retry_count, retry_limit,
             created_on, start_after, output
      from pgboss.job
      where name in (${SALES_ORDER_QUEUE}, ${SALES_ORDER_DEAD_QUEUE})
      order by created_on desc
      limit 200
    `)) as unknown as QueuedRow[];

    const mine = rows.filter((r) => r.data?.operationId === op.id);
    return c.json({
      closings: mine.map((r) => ({
        id: r.id,
        awaitingHuman: r.name === SALES_ORDER_DEAD_QUEUE,
        reason: r.data?.reason ?? "sin motivo registrado",
        attempts: r.retry_count,
        maxAttempts: r.retry_limit,
        nextAttemptAt: r.name === SALES_ORDER_QUEUE ? r.start_after : null,
        createdAt: r.created_on,
        conversationId: r.data?.conversationId ?? null,
        leadRef: r.data?.closing?.leadRef ?? null,
        customerName: [
          r.data?.closing?.contact?.firstName,
          r.data?.closing?.contact?.lastName,
        ]
          .filter(Boolean)
          .join(" ")
          .trim(),
        customerPhone: r.data?.closing?.contact?.phone ?? null,
      })),
    });
  } catch (err) {
    // La cola puede no existir todavía: hasta que el vendedor cierre su primera
    // venta, `createQueue` no corrió. Cero cierres pendientes es la verdad.
    logger.warn({ err }, "no se pudo leer la cola de cierres");
    return c.json({ closings: [] });
  }
});
