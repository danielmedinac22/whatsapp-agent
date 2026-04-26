import { listShopifyOrders } from "@/lib/queries";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  received: { label: "Recibido", color: "bg-blue-500/20 text-blue-300" },
  followup_scheduled: {
    label: "Follow-up agendado",
    color: "bg-amber-500/20 text-amber-300",
  },
  followup_sent: {
    label: "Follow-up enviado",
    color: "bg-purple-500/20 text-purple-300",
  },
  confirmed: {
    label: "Confirmado",
    color: "bg-emerald-500/20 text-emerald-300",
  },
  no_response: {
    label: "Sin respuesta",
    color: "bg-zinc-500/20 text-zinc-300",
  },
  cancelled: { label: "Cancelado", color: "bg-red-500/20 text-red-300" },
};

function fmt(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function OrdersPage() {
  const orders = await listShopifyOrders(200);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold">Pedidos Shopify</h1>
        <p className="text-sm text-[var(--color-text-dim)]">
          Pedidos recibidos vía webhook y estado del follow-up.
        </p>
      </header>

      {orders.length === 0 ? (
        <div className="rounded bg-[var(--color-panel)] p-8 text-center text-sm text-[var(--color-text-dim)] border">
          No hay pedidos todavía. Cuando configures el webhook de Shopify
          aparecerán aquí.
        </div>
      ) : (
        <div className="overflow-hidden rounded border bg-[var(--color-panel)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-panel-2)] text-left text-xs uppercase tracking-wide text-[var(--color-text-dim)]">
              <tr>
                <th className="px-4 py-3">Pedido</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Recibido</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const st = STATUS_LABEL[o.status] ?? {
                  label: o.status,
                  color: "bg-zinc-500/20",
                };
                return (
                  <tr key={o.id} className="border-t">
                    <td className="px-4 py-3 font-mono text-xs">
                      {o.orderId}
                    </td>
                    <td className="px-4 py-3">
                      <div>{o.customerName ?? "—"}</div>
                      <div className="text-xs text-[var(--color-text-dim)]">
                        {o.customerPhone}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {o.totalPrice ? `${o.totalPrice} ${o.currency ?? ""}` : "—"}
                    </td>
                    <td className="px-4 py-3">{fmt(o.receivedAt)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs ${st.color}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-text-dim)]">
                      {o.followupSentAt
                        ? `enviado ${fmt(o.followupSentAt)}`
                        : o.followupScheduledFor
                          ? `agendado ${fmt(o.followupScheduledFor)}`
                          : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
