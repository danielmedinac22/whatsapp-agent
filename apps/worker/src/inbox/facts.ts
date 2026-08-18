/**
 * Los hechos que el ruteo necesita, leídos de la base.
 *
 * `resolve.ts` es puro y no consulta nada; este archivo es el borde que le
 * carga los pedidos. Está separado por la misma razón que en ventas: la regla
 * se prueba con fixtures, y la consulta —que es la parte que no se prueba, en
 * línea con la convención del repo— no puede colarse dentro de ella.
 *
 * Un pedido puede existir en la tienda, en la logística, o en las dos: el
 * cruce lo hace `dropi_orders.shopify_order_row_id`. Se cargan los tres casos
 * porque el ruteo mira la fecha del **último** pedido, y dejar fuera los que
 * solo existen en logística —los que Dropi trajo sin pasar por la tienda—
 * haría que un cliente con pedido en curso pareciera un lead sin nada.
 */

import { and, eq, isNull } from "@wa/db";
import { dropiOrders, shopifyOrders } from "@wa/db";
import { db } from "../db";
import type { OrderFacts } from "@wa/db";

/** Todos los pedidos de un contacto, en la forma que el ruteo espera. */
export async function loadOrderFacts(
  contactId: string,
): Promise<OrderFacts[]> {
  const [fromStore, onlyLogistics] = await Promise.all([
    db
      .select({
        createdAt: shopifyOrders.receivedAt,
        pipelineStatus: shopifyOrders.status,
        logisticsStatus: dropiOrders.status,
      })
      .from(shopifyOrders)
      .leftJoin(dropiOrders, eq(dropiOrders.shopifyOrderRowId, shopifyOrders.id))
      .where(eq(shopifyOrders.contactId, contactId)),
    db
      .select({
        createdAt: dropiOrders.createdAt,
        logisticsStatus: dropiOrders.status,
      })
      .from(dropiOrders)
      .where(
        and(
          eq(dropiOrders.contactId, contactId),
          isNull(dropiOrders.shopifyOrderRowId),
        ),
      ),
  ]);

  return [
    ...fromStore.map((row) => ({
      createdAt: row.createdAt,
      pipelineStatus: row.pipelineStatus,
      logisticsStatus: row.logisticsStatus,
    })),
    ...onlyLogistics.map((row) => ({
      createdAt: row.createdAt,
      pipelineStatus: null,
      logisticsStatus: row.logisticsStatus,
    })),
  ];
}
