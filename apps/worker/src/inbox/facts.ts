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

import { and, eq, inArray, isNull } from "@wa/db";
import { dropiOrders, shopifyOrders } from "@wa/db";
import { db } from "../db";
import type { Operation, OrderFacts } from "@wa/db";

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

/**
 * Los pedidos de **un conjunto** de contactos, acotados a una operación.
 *
 * Es la carga de conjunto que necesita la liberación de asignaciones
 * (`inbox/asignacion.ts`): mirar diez conversaciones asignadas de a una serían
 * veinte consultas, y el primer barrido después de encender al vendedor puede
 * encontrarse con doscientas.
 *
 * **Va acotada por operación y {@link loadOrderFacts} no**, y la diferencia no
 * es un descuido de ninguna de las dos. Aquélla la llama el pipeline de
 * entrada, que ya resolvió a qué operación pertenece el mensaje y mira un
 * contacto que es de esa conversación; ésta decide si una conversación cambió
 * de bandeja, y la bandeja se deriva sobre los pedidos **de su operación** —es
 * lo que hace `loadOrderFactsByContact` en el panel, que es contra quien esto
 * tiene que dar el mismo resultado—. Un contacto que escribe a los dos países
 * tiene pedidos en los dos, y contar los colombianos para decidir la bandeja
 * guatemalteca soltaría una asignación que nadie movió.
 *
 * Es la tercera implementación de la **carga** y la misma regla de siempre: el
 * tipo las ata —las tres devuelven `OrderFacts`—, así que el día que el ruteo
 * necesite un hecho más, las tres dejan de compilar juntas.
 */
export async function loadOrderFactsByContacts(
  op: Operation,
  contactIds: readonly string[],
): Promise<Map<string, OrderFacts[]>> {
  const porContacto = new Map<string, OrderFacts[]>();
  if (contactIds.length === 0) return porContacto;
  const ids = [...contactIds];

  const [fromStore, onlyLogistics] = await Promise.all([
    db
      .select({
        contactId: shopifyOrders.contactId,
        createdAt: shopifyOrders.receivedAt,
        pipelineStatus: shopifyOrders.status,
        logisticsStatus: dropiOrders.status,
      })
      .from(shopifyOrders)
      .leftJoin(dropiOrders, eq(dropiOrders.shopifyOrderRowId, shopifyOrders.id))
      .where(
        and(
          eq(shopifyOrders.operationId, op.id),
          inArray(shopifyOrders.contactId, ids),
        ),
      ),
    db
      .select({
        contactId: dropiOrders.contactId,
        createdAt: dropiOrders.createdAt,
        logisticsStatus: dropiOrders.status,
      })
      .from(dropiOrders)
      .where(
        and(
          eq(dropiOrders.operationId, op.id),
          inArray(dropiOrders.contactId, ids),
          isNull(dropiOrders.shopifyOrderRowId),
        ),
      ),
  ]);

  const agregar = (contactId: string | null, order: OrderFacts): void => {
    if (!contactId) return;
    const actuales = porContacto.get(contactId);
    if (actuales) actuales.push(order);
    else porContacto.set(contactId, [order]);
  };
  for (const row of fromStore) {
    agregar(row.contactId, {
      createdAt: row.createdAt,
      pipelineStatus: row.pipelineStatus,
      logisticsStatus: row.logisticsStatus,
    });
  }
  for (const row of onlyLogistics) {
    agregar(row.contactId, {
      createdAt: row.createdAt,
      pipelineStatus: null,
      logisticsStatus: row.logisticsStatus,
    });
  }
  return porContacto;
}
