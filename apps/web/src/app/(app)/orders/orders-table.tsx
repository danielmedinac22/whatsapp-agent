"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Search, X } from "lucide-react";
import { LOGISTIC_SITUATIONS, situationOfMovement } from "@wa/shared";
import type { OrdersSearchParams } from "./page";

export type OrderRow = {
  shopify: {
    id: string;
    orderId: string;
    customerName: string | null;
    customerPhone: string;
    receivedAt: string;
    status: string;
  };
  /** Conversación del cliente, para saltar al Inbox desde el pedido. */
  conversationId: string | null;
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
    lastMovementRaw: string | null;
    lastMovementAt: string | null;
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
  en_oficina: {
    label: "En oficina (por reclamar)",
    color: "bg-orange-500/20 text-orange-200",
  },
  entregado: { label: "Entregado", color: "bg-emerald-500/20 text-emerald-200" },
  novedad: { label: "Novedad", color: "bg-red-500/20 text-red-200" },
  novedad_solucionada: {
    label: "Novedad resuelta",
    color: "bg-emerald-500/20 text-emerald-200",
  },
  devolucion: { label: "Devolución", color: "bg-amber-500/20 text-amber-200" },
  rechazado: { label: "Rechazado", color: "bg-red-500/20 text-red-200" },
  retornado: { label: "Retornado", color: "bg-amber-500/20 text-amber-200" },
  anulada: { label: "Anulada", color: "bg-red-500/20 text-red-200" },
};

const SHOPIFY_STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(
  ([value, meta]) => ({ value, label: meta.label }),
);

const DROPI_STATUS_OPTIONS = Object.entries(DROPI_STATUS_LABEL)
  .filter(([value]) => value !== "unknown")
  .map(([value, meta]) => ({ value, label: meta.label }));

const MATCH_OPTIONS = [
  { value: "high", label: "Match alto" },
  { value: "low", label: "Match bajo" },
  { value: "manual", label: "Match manual" },
  { value: "none", label: "Sin cruce en Dropi" },
];

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrdersTable({
  initialRows,
  carriers,
  filters,
  hasFilters,
}: {
  initialRows: OrderRow[];
  carriers: string[];
  filters: OrdersSearchParams;
  hasFilters: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; msg: string } | null>(null);
  const [search, setSearch] = useState(filters.q ?? "");
  const [pending, startNavigate] = useTransition();

  // El servidor es el que filtra (son 1 195 pedidos), así que los filtros
  // viven en la URL: compartible, y sobrevive al refresh de la página.
  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  const navigate = (next: OrdersSearchParams) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    startNavigate(() => router.replace(qs ? `/orders?${qs}` : "/orders"));
  };

  useEffect(() => {
    const current = filters.q ?? "";
    if (search.trim() === current) return;
    const timer = setTimeout(
      () => navigate({ ...filters, q: search.trim() || undefined }),
      300,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filters.q]);

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
        setError({ id: row.dropi.id, msg: j.error ?? `error ${r.status}` });
        return;
      }
      setRows((prev) =>
        prev.map((p) =>
          p.dropi && p.dropi.id === row.dropi!.id
            ? {
                ...p,
                dropi: {
                  ...p.dropi,
                  confirmPutAt: j.dryRun
                    ? p.dropi.confirmPutAt
                    : new Date().toISOString(),
                  confirmDryRunAt: j.dryRun
                    ? new Date().toISOString()
                    : p.dropi.confirmDryRunAt,
                  status: j.dryRun ? p.dropi.status : "pendiente",
                },
              }
            : p,
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="app-card space-y-2 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-soft)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por pedido, cliente, teléfono o guía…"
            className="app-input h-9 w-full pl-8 pr-8 text-xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              title="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-soft)] hover:text-[var(--color-text)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Situación logística"
            value={filters.situacion ?? ""}
            onChange={(v) => navigate({ ...filters, situacion: v || undefined })}
            options={LOGISTIC_SITUATIONS.map((s) => ({
              value: s.key,
              label: s.label,
            }))}
          />
          <FilterSelect
            label="Estado Dropi"
            value={filters.dropi ?? ""}
            onChange={(v) => navigate({ ...filters, dropi: v || undefined })}
            options={DROPI_STATUS_OPTIONS}
          />
          <FilterSelect
            label="Estado Shopify"
            value={filters.shopify ?? ""}
            onChange={(v) => navigate({ ...filters, shopify: v || undefined })}
            options={SHOPIFY_STATUS_OPTIONS}
          />
          <FilterSelect
            label="Transportadora"
            value={filters.carrier ?? ""}
            onChange={(v) => navigate({ ...filters, carrier: v || undefined })}
            options={carriers.map((c) => ({ value: c, label: c }))}
          />
          <FilterSelect
            label="Match"
            value={filters.match ?? ""}
            onChange={(v) => navigate({ ...filters, match: v || undefined })}
            options={MATCH_OPTIONS}
          />
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                startNavigate(() => router.replace("/orders"));
              }}
              className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-dim)] hover:border-[var(--color-accent)]"
            >
              Limpiar filtros
            </button>
          )}
          <span className="ml-auto text-xs text-[var(--color-text-soft)]">
            {pending ? "Filtrando…" : `${rows.length} pedidos`}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="app-card p-4 text-center text-sm text-[var(--color-text-dim)]">
          {hasFilters
            ? "Ningún pedido coincide con estos filtros."
            : "No hay pedidos todavía."}
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
                <th className="px-4 py-3">Situación logística</th>
                <th className="px-4 py-3">Guía / Transportadora</th>
                <th className="px-4 py-3">Match</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
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
                const situation = situationOfMovement(d?.lastMovementRaw);
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
                      {row.conversationId ? (
                        <Link
                          href={`/inbox?c=${row.conversationId}`}
                          className="inline-flex items-center gap-1.5 text-[var(--color-accent)] hover:underline"
                          title="Abrir la conversación de este cliente"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          {o.customerName ?? o.customerPhone}
                        </Link>
                      ) : (
                        <div>{o.customerName ?? "—"}</div>
                      )}
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
                      {d?.lastMovementRaw ? (
                        <>
                          <div className="text-[var(--color-text)]">
                            {situation?.label ?? d.lastMovementRaw}
                          </div>
                          <div
                            className="text-[10px] text-[var(--color-text-soft)]"
                            title={d.lastMovementRaw}
                          >
                            {situation ? d.lastMovementRaw : ""}
                            {d.lastMovementAt
                              ? ` · ${fmt(d.lastMovementAt)}`
                              : ""}
                          </div>
                        </>
                      ) : (
                        <span className="text-[var(--color-text-soft)]">—</span>
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

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={label}
      className={`h-8 rounded-md border px-2 text-xs outline-none transition ${
        value
          ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
          : "border-[var(--color-border)] bg-[rgba(8,21,30,0.72)] text-[var(--color-text-dim)] hover:border-[rgba(110,231,183,0.3)]"
      }`}
    >
      <option value="">{label}: todas</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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
