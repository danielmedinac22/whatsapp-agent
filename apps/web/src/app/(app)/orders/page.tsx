import { listShopifyOrdersWithDropi } from "@/lib/queries";
import { OrdersTable, type OrderRow } from "./orders-table";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const rows = await listShopifyOrdersWithDropi(200);

  const serialized: OrderRow[] = rows.map(({ shopify, dropi }) => ({
    shopify: {
      id: shopify.id,
      orderId: shopify.orderId,
      customerName: shopify.customerName,
      customerPhone: shopify.customerPhone,
      receivedAt: shopify.receivedAt.toISOString(),
      status: shopify.status,
    },
    dropi: dropi
      ? {
          id: dropi.id,
          dropiOrderId: dropi.dropiOrderId,
          status: dropi.status,
          guideNumber: dropi.guideNumber,
          carrier: dropi.carrier,
          matchConfidence: dropi.matchConfidence,
          confirmPutAt: dropi.confirmPutAt
            ? dropi.confirmPutAt.toISOString()
            : null,
          confirmDryRunAt: dropi.confirmDryRunAt
            ? dropi.confirmDryRunAt.toISOString()
            : null,
          guidePdfPath: dropi.guidePdfPath,
        }
      : null,
  }));

  return (
    <div className="app-page space-y-3">
      <header className="max-w-3xl">
        <h1 className="app-title">Pedidos</h1>
        <p className="app-subtitle app-muted mt-1">
          Confirma manualmente desde aquí. El check verde aparece cuando Shopify
          ya marcó el pedido como confirmado.
        </p>
      </header>

      {serialized.length === 0 ? (
        <div className="app-card p-4 text-center text-sm text-[var(--color-text-dim)]">
          No hay pedidos todavía.
        </div>
      ) : (
        <OrdersTable initialRows={serialized} />
      )}
    </div>
  );
}
