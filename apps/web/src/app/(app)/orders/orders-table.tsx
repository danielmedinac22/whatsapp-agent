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

/**
 * Las cinco parejas de estado del contrato de nombres, como clases.
 *
 * **Son cinco para dieciséis estados de Dropi y seis de Shopify, y eso es la
 * decisión, no una limitación que haya que sortear.** Hasta hoy la tabla usaba
 * ocho matices —ámbar, rojo, esmeralda, azul, cian, violeta, fucsia, naranja—
 * que no querían decir ocho cosas distintas: querían decir «este es otro
 * estado». Un arcoíris no se recorre con la vista, porque ningún color pesa más
 * que otro.
 *
 * Lo que las cinco parejas codifican es **qué tiene que hacer quien mira**:
 * `espera` algo pendiente, `escalada` algo que falló, `novedad` la novedad de
 * logística, `auto` lo que terminó bien y `neutro` lo que va en camino y no pide
 * nada. Los seis estados del camino feliz en movimiento —confirmado, guía,
 * preparado, recolectado, en tránsito, con mensajero— comparten el neutro a
 * propósito: el ojo tiene que caer en el ámbar y en el rojo, no en ellos.
 *
 * Lo que se pierde de distinción entre matices lo carga la etiqueta, que lleva
 * el nombre escrito. Es la misma regla del nivel 3 del spec: ningún estado se
 * codifica solo con color.
 *
 * `neutro` es `--state-sinprod-*`. El token se llama por el estado del Inbox que
 * lo estrenó; acá es el gris azulado neutro de la paleta y no hay otro.
 */
const ESTADO = {
  espera: "bg-[var(--state-espera-bg)] text-[var(--state-espera-fg)]",
  auto: "bg-[var(--state-auto-bg)] text-[var(--state-auto-fg)]",
  escalada: "bg-[var(--state-escalada-bg)] text-[var(--state-escalada-fg)]",
  novedad: "bg-[var(--state-novedad-bg)] text-[var(--state-novedad-fg)]",
  neutro: "bg-[var(--state-sinprod-bg)] text-[var(--state-sinprod-fg)]",
} as const;

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  received: { label: "Recibido", color: ESTADO.neutro },
  // Los dos follow-up esperan lo mismo —que el cliente conteste— y hasta hoy
  // eran ámbar y violeta. Comparten el ámbar; los distingue el nombre.
  followup_scheduled: { label: "Follow-up agendado", color: ESTADO.espera },
  followup_sent: { label: "Follow-up enviado", color: ESTADO.espera },
  confirmed: { label: "Confirmado", color: ESTADO.auto },
  // El cliente ya no va a contestar: no es una espera, es un pedido muerto.
  no_response: { label: "Sin respuesta", color: ESTADO.neutro },
  cancelled: { label: "Cancelado", color: ESTADO.escalada },
};

const DROPI_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  unknown: { label: "—", color: ESTADO.neutro },
  // El único de la columna que espera algo de este lado: es el que enciende el
  // botón de confirmar, dos celdas más allá.
  pendiente_confirmacion: { label: "Pend. confirmación", color: ESTADO.espera },
  // Los seis del camino feliz en movimiento. Nada que hacer con ellos.
  pendiente: { label: "Confirmado en Dropi", color: ESTADO.neutro },
  guia_generada: { label: "Guía generada", color: ESTADO.neutro },
  preparado_transportadora: { label: "Preparado", color: ESTADO.neutro },
  recolectado: { label: "Recolectado", color: ESTADO.neutro },
  en_transito: { label: "En tránsito", color: ESTADO.neutro },
  con_mensajero: { label: "Con mensajero", color: ESTADO.neutro },
  // El paquete llegó pero nadie lo reclamó: espera al cliente, no al sistema.
  en_oficina: { label: "En oficina (por reclamar)", color: ESTADO.espera },
  entregado: { label: "Entregado", color: ESTADO.auto },
  // **Este es el estado para el que existe el token `novedad`**, y hasta hoy se
  // pintaba del mismo rojo que «Rechazado» y «Anulada». No es lo mismo: una
  // novedad se resuelve, un rechazo ya pasó.
  novedad: { label: "Novedad", color: ESTADO.novedad },
  novedad_solucionada: { label: "Novedad resuelta", color: ESTADO.auto },
  devolucion: { label: "Devolución", color: ESTADO.espera },
  rechazado: { label: "Rechazado", color: ESTADO.escalada },
  retornado: { label: "Retornado", color: ESTADO.espera },
  anulada: { label: "Anulada", color: ESTADO.escalada },
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

  // «1 pedidos» lo decía la barra desde siempre. Ahora que la cuenta es el
  // encabezado de una sección se lee más, así que se arregla de paso.
  const cuenta = `${rows.length} ${rows.length === 1 ? "pedido" : "pedidos"}`;

  /**
   * **Las dos secciones que Pedidos no tenía.** Era, con el Inbox, una de las
   * dos pantallas del panel con un `h1` y cero encabezados por dentro, mientras
   * Vendedor tenía seis `h2` y Conexión cuatro: las de configuración, que se
   * abren una vez al mes, estaban mejor articuladas que las de trabajo diario.
   *
   * Son dos y no más porque la pantalla tiene dos zonas y no más: con qué se
   * recorta la lista, y la lista. Inventar una tercera para que el árbol se vea
   * poblado sería nombrar algo que no existe.
   *
   * **La cuenta viaja en el encabezado**, no al final de la barra de filtros:
   * es el resultado de la sección, no un dato de los filtros, y ahí la
   * encuentra quien viene a saber cuántos quedaron. La barra conserva
   * «Filtrando…», que es lo otro que decía y sí es suyo — el aviso de que la
   * consulta está en viaje.
   */
  return (
    <div className="space-y-3">
      <section className="space-y-2">
        <h2 className="app-section">Búsqueda y filtros</h2>
        <div className="app-card space-y-2 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-dim)]" />
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
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
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
                className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-dim)] hover:border-[var(--color-ink)]"
              >
                Limpiar filtros
              </button>
            )}
            {pending && (
              <span className="ml-auto text-xs text-[var(--color-text-dim)]">
                Filtrando…
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="app-section">Resultados · {cuenta}</h2>
        {rows.length === 0 ? (
          <div className="app-card p-4 text-center text-sm text-[var(--color-text-dim)]">
            {hasFilters
              ? "Ningún pedido coincide con estos filtros."
              : "No hay pedidos todavía."}
          </div>
        ) : (
          <div className="app-card overflow-x-auto">
            <table className="app-table">
              <thead className="bg-[var(--color-bg)]">
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
                    color: ESTADO.neutro,
                  };
                  const ds = d
                    ? (DROPI_STATUS_LABEL[d.status] ?? {
                        label: d.status,
                        color: ESTADO.neutro,
                      })
                    : null;
                  const situation = situationOfMovement(d?.lastMovementRaw);
                  return (
                    <tr key={`${o.id}:${d?.id ?? "none"}`}>
                      <td className="px-4 py-3 font-mono text-xs">
                        {o.orderId}
                        {d?.dropiOrderId && (
                          <div className="text-[10px] text-[var(--color-text-dim)]">
                            dropi #{d.dropiOrderId}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row.conversationId ? (
                          <Link
                            href={`/inbox?c=${row.conversationId}`}
                            className="inline-flex min-h-9 items-center gap-1.5 text-[var(--color-ink)] hover:underline lg:min-h-0"
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
                              <span className="text-[10px] text-[var(--color-danger)]">
                                {error.msg}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--color-text-dim)]">
                            —
                          </span>
                        )}
                        {d?.confirmDryRunAt && !d.confirmPutAt && (
                          <div className="text-[10px] text-[var(--color-warn)]">
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
                              className="text-[10px] text-[var(--color-text-dim)]"
                              title={d.lastMovementRaw}
                            >
                              {situation ? d.lastMovementRaw : ""}
                              {d.lastMovementAt
                                ? ` · ${fmt(d.lastMovementAt)}`
                                : ""}
                            </div>
                          </>
                        ) : (
                          <span className="text-[var(--color-text-dim)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {d?.guideNumber ? (
                          <div className="font-mono">{d.guideNumber}</div>
                        ) : (
                          <span className="text-[var(--color-text-dim)]">—</span>
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
                                ? "text-[var(--state-auto-fg)]"
                                : d.matchConfidence === "manual"
                                  ? "text-[var(--state-sinprod-fg)]"
                                  : "text-[var(--state-espera-fg)]"
                            }
                          >
                            {d.matchConfidence}
                          </span>
                        ) : (
                          <span className="text-[var(--color-text-dim)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
      className={`h-9 rounded-md border px-2 text-xs outline-none transition lg:h-8 ${
        value
          ? "border-[var(--color-ink)] bg-[var(--color-ink-wash)] text-[var(--color-ink)]"
          : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-text-dim)] hover:border-[var(--color-ink)]"
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
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-xs transition disabled:opacity-50 lg:h-6 lg:w-6 ${
        shopifyConfirmed
          ? "border-[var(--state-auto-fg)] bg-[var(--state-auto-bg)] text-[var(--state-auto-fg)] hover:bg-[var(--color-ink-soft)]"
          : "border-[var(--color-border-strong)] bg-[var(--state-sinprod-bg)] text-[var(--state-sinprod-fg)] hover:bg-[var(--color-hover)]"
      }`}
    >
      {busy ? "…" : "✓"}
    </button>
  );
}
