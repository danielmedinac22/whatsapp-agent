"use client";

import { useMemo, useState, useTransition } from "react";

export type OrderRow = {
  shopify: {
    id: string;
    orderId: string;
    customerName: string | null;
    customerPhone: string;
    receivedAt: string;
    status: string;
  };
  dropi: {
    id: string;
    dropiOrderId: number;
    status: string;
    guideNumber: string | null;
    carrier: string | null;
    matchConfidence: string | null;
    confirmPutAt: string | null;
    confirmDryRunAt: string | null;
    guidePdfPath: string | null;
  } | null;
};

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
  recolectado: { label: "Recolectado", color: "bg-cyan-500/20 text-cyan-200" },
  en_transito: { label: "En tránsito", color: "bg-cyan-500/20 text-cyan-200" },
  con_mensajero: {
    label: "Con mensajero",
    color: "bg-fuchsia-500/20 text-fuchsia-200",
  },
  entregado: { label: "Entregado", color: "bg-emerald-500/20 text-emerald-200" },
  novedad: { label: "Novedad", color: "bg-red-500/20 text-red-200" },
  anulada: { label: "Anulada", color: "bg-red-500/20 text-red-200" },
};

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SHOPIFY_FILTERS: Array<{
  value: "all" | "confirmed" | "pending";
  label: string;
}> = [
  { value: "all", label: "Todas" },
  { value: "confirmed", label: "Confirmadas en Shopify" },
  { value: "pending", label: "Pendientes Shopify" },
];

export function OrdersTable({ initialRows }: { initialRows: OrderRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<"all" | "confirmed" | "pending">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; msg: string } | null>(null);
  const [, startTransition] = useTransition();

  const visible = useMemo(() => {
    if (filter === "confirmed")
      return rows.filter((r) => r.shopify.status === "confirmed");
    if (filter === "pending")
      return rows.filter((r) => r.shopify.status !== "confirmed");
    return rows;
  }, [rows, filter]);

  async function confirm(row: OrderRow) {
    if (!row.dropi) return;
    setError(null);
    setBusy(row.dropi.id);
    try {
      const r = await fetch(`/api/dropi/orders/${row.dropi.id}/confirm`, {
        method: "POST",
      });
      const j = (await r.json()) as {
        ok?: boolean;
        dryRun?: boolean;
        alreadyDone?: boolean;
        error?: string;
      };
      if (!r.ok || !j.ok) {
        setError({
          id: row.dropi.id,
          msg: j.error ?? `error ${r.status}`,
        });
        return;
      }
      // Optimistic update
      startTransition(() => {
        setRows((prev) =>
          prev.map((p) =>
            p.dropi && p.dropi.id === row.dropi!.id
              ? {
                  ...p,
                  dropi: {
                    ...p.dropi,
                    confirmPutAt: j.dryRun ? p.dropi.confirmPutAt : new Date().toISOString(),
                    confirmDryRunAt: j.dryRun
                      ? new Date().toISOString()
                      : p.dropi.confirmDryRunAt,
                    status: j.dryRun ? p.dropi.status : "pendiente",
                  },
                }
              : p,
          ),
        );
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {SHOPIFY_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              filter === f.value
                ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                : "border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-[var(--color-accent)]"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-2 text-xs text-[var(--color-text-soft)]">
          {visible.length} de {rows.length}
        </span>
      </div>

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
            {visible.map((row) => {
              const o = row.shopify;
              const d = row.dropi;
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
                <tr key={`${o.id}:${d?.id ?? "none"}`}>
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
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-xs ${ds.color}`}
                        >
                          {ds.label}
                        </span>
                        <ConfirmButton
                          row={row}
                          busy={busy === d!.id}
                          onClick={() => confirm(row)}
                        />
                        {error?.id === d!.id && (
                          <span className="text-[10px] text-red-300">
                            {error.msg}
                          </span>
                        )}
                      </div>
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
    </div>
  );
}

function ConfirmButton({
  row,
  busy,
  onClick,
}: {
  row: OrderRow;
  busy: boolean;
  onClick: () => void;
}) {
  const d = row.dropi!;
  // Only show button when Dropi is still pending confirmation.
  if (d.confirmPutAt || d.status !== "pendiente_confirmacion") return null;
  const shopifyConfirmed = row.shopify.status === "confirmed";
  const tooltip = shopifyConfirmed
    ? "Confirmar pedido en Dropi"
    : "Shopify aún no confirmado — confirmar igual";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={tooltip}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs transition disabled:opacity-50 ${
        shopifyConfirmed
          ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
          : "border-zinc-500/40 bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20"
      }`}
    >
      {busy ? "…" : "✓"}
    </button>
  );
}
