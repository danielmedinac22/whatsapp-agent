import { listCarriers, listShopifyOrdersWithDropi } from "@/lib/queries";
import { resolvePanelOperation } from "@/lib/operation";
import { OrdersTable, type OrderRow } from "./orders-table";

export const dynamic = "force-dynamic";

export type OrdersSearchParams = {
  q?: string;
  shopify?: string;
  dropi?: string;
  carrier?: string;
  match?: string;
  situacion?: string;
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<OrdersSearchParams>;
}) {
  const sp = await searchParams;
  const op = await resolvePanelOperation();
  const [rows, carriers] = await Promise.all([
    listShopifyOrdersWithDropi(op, {
      q: sp.q,
      shopifyStatus: sp.shopify,
      dropiStatus: sp.dropi,
      carrier: sp.carrier,
      match: sp.match,
      situacion: sp.situacion,
    }),
    listCarriers(op),
  ]);

  const serialized: OrderRow[] = rows.map(
    ({ shopify, dropi, conversationId }) => ({
      shopify: {
        id: shopify.id,
        orderId: shopify.orderId,
        customerName: shopify.customerName,
        customerPhone: shopify.customerPhone,
        receivedAt: shopify.receivedAt.toISOString(),
        status: shopify.status,
      },
      conversationId,
      dropi: dropi?.id
        ? {
            id: dropi.id,
            dropiOrderId: dropi.dropiOrderId!,
            status: dropi.status!,
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
            lastMovementRaw: dropi.lastMovementRaw,
            lastMovementAt: dropi.lastMovementAt
              ? dropi.lastMovementAt.toISOString()
              : null,
          }
        : null,
    }),
  );

  const hasFilters = Boolean(
    sp.q || sp.shopify || sp.dropi || sp.carrier || sp.match || sp.situacion,
  );

  return (
    <div className="app-page space-y-3">
      <header className="max-w-3xl">
        <h1 className="app-title">Pedidos</h1>
        <p className="app-subtitle app-muted mt-1">
          Filtra por situación logística y salta a la conversación del cliente.
          El check verde aparece cuando Shopify ya marcó el pedido como
          confirmado.
        </p>
      </header>

      <OrdersTable
        initialRows={serialized}
        carriers={carriers}
        filters={sp}
        hasFilters={hasFilters}
      />
    </div>
  );
}
