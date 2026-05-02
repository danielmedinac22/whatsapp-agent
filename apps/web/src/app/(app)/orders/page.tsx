import { listShopifyOrdersWithDropi } from "@/lib/queries";

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

const DROPI_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  unknown: { label: "—", color: "bg-zinc-500/20 text-zinc-300" },
  pendiente_confirmacion: {
    label: "Pend. confirmación",
    color: "bg-amber-500/20 text-amber-200",
  },
  pendiente: {
    label: "Confirmado en Dropi",
    color: "bg-blue-500/20 text-blue-200",
  },
  guia_generada: {
    label: "Guía generada",
    color: "bg-purple-500/20 text-purple-200",
  },
  preparado_transportadora: {
    label: "Preparado",
    color: "bg-purple-500/20 text-purple-200",
  },
  recolectado: {
    label: "Recolectado",
    color: "bg-cyan-500/20 text-cyan-200",
  },
  en_transito: {
    label: "En tránsito",
    color: "bg-cyan-500/20 text-cyan-200",
  },
  con_mensajero: {
    label: "Con mensajero",
    color: "bg-fuchsia-500/20 text-fuchsia-200",
  },
  entregado: {
    label: "Entregado",
    color: "bg-emerald-500/20 text-emerald-200",
  },
  novedad: { label: "Novedad", color: "bg-red-500/20 text-red-200" },
  anulada: { label: "Anulada", color: "bg-red-500/20 text-red-200" },
};

function fmt(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function OrdersPage() {
  const rows = await listShopifyOrdersWithDropi(200);

  return (
    <div className="app-page space-y-3">
      <header className="max-w-3xl">
        <h1 className="app-title">Pedidos</h1>
        <p className="app-subtitle app-muted mt-1">
          Shopify (webhook + follow-up) cruzado con Dropi (estado de guía)
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="app-card p-4 text-center text-sm text-[var(--color-text-dim)]">
          No hay pedidos todavía.
        </div>
      ) : (
        <div className="app-card overflow-x-auto">
          <table className="app-table">
            <thead className="bg-[rgba(12,27,38,0.82)]">
              <tr>
                <th className="px-4 py-3">Pedido</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Recibido</th>
                <th className="px-4 py-3">Estado Shopify</th>
                <th className="px-4 py-3">Estado Dropi</th>
                <th className="px-4 py-3">Guía / Transportadora</th>
                <th className="px-4 py-3">Match</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ shopify: o, dropi: d }) => {
                const st = STATUS_LABEL[o.status] ?? {
                  label: o.status,
                  color: "bg-zinc-500/20 text-zinc-200",
                };
                const ds = d
                  ? (DROPI_STATUS_LABEL[d.status] ?? {
                      label: d.status,
                      color: "bg-zinc-500/20 text-zinc-200",
                    })
                  : null;
                return (
                  <tr key={o.id}>
                    <td className="px-4 py-3 font-mono text-xs">
                      {o.orderId}
                      {d?.dropiOrderId && (
                        <div className="text-[10px] text-[var(--color-text-soft)]">
                          dropi #{d.dropiOrderId}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div>{o.customerName ?? "—"}</div>
                      <div className="text-xs text-[var(--color-text-dim)]">
                        {o.customerPhone}
                      </div>
                    </td>
                    <td className="px-4 py-3">{fmt(o.receivedAt)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs ${st.color}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {ds ? (
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-xs ${ds.color}`}
                        >
                          {ds.label}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--color-text-soft)]">
                          —
                        </span>
                      )}
                      {d?.confirmDryRunAt && !d.confirmPutAt && (
                        <div className="text-[10px] text-amber-300">
                          dry-run {fmt(d.confirmDryRunAt)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {d?.guideNumber ? (
                        <div className="font-mono">{d.guideNumber}</div>
                      ) : (
                        <span className="text-[var(--color-text-soft)]">—</span>
                      )}
                      {d?.carrier && (
                        <div className="text-[var(--color-text-dim)]">
                          {d.carrier}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {d?.matchConfidence ? (
                        <span
                          className={
                            d.matchConfidence === "high"
                              ? "text-emerald-300"
                              : d.matchConfidence === "manual"
                                ? "text-blue-300"
                                : "text-amber-300"
                          }
                        >
                          {d.matchConfidence}
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-soft)]">—</span>
                      )}
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
