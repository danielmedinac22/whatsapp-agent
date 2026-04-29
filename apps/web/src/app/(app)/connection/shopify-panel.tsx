"use client";

import { useEffect, useState } from "react";

type ConnectionState = {
  shopDomain: string | null;
  apiVersion: string | null;
  hasToken: boolean;
  connectedAt: string | null;
  updatedAt: string | null;
} | null;

export function ShopifyPanel() {
  const [snap, setSnap] = useState<ConnectionState>(null);
  const [loaded, setLoaded] = useState(false);
  const [domain, setDomain] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/shopify/connection", { cache: "no-store" });
        if (!alive) return;
        if (r.ok) {
          const j = (await r.json()) as ConnectionState;
          setSnap(j);
          if (j?.shopDomain) setDomain(j.shopDomain);
        }
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const r = await fetch("/api/shopify/connection", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shopDomain: domain.trim(),
          adminAccessToken: token.trim(),
        }),
      });
      const j = (await r.json()) as { ok?: boolean; shopName?: string; error?: string };
      if (!r.ok || !j.ok) {
        setMsg({
          kind: "err",
          text: typeof j.error === "string" ? j.error : "no se pudo conectar",
        });
        return;
      }
      setMsg({ kind: "ok", text: `conectado a "${j.shopName ?? domain}"` });
      setToken("");
      const r2 = await fetch("/api/shopify/connection", { cache: "no-store" });
      if (r2.ok) setSnap((await r2.json()) as ConnectionState);
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "error" });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("¿Desconectar Shopify? El agente perderá el contexto del producto.")) return;
    setBusy(true);
    try {
      await fetch("/api/shopify/connection", { method: "DELETE" });
      setSnap(null);
      setDomain("");
      setToken("");
      setMsg({ kind: "ok", text: "desconectado" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-card w-full max-w-5xl p-4">
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Conexión de Shopify</h2>
          <p className="mt-1 text-sm leading-5 text-[var(--color-text-dim)]">
            El agente usará la descripción de tus productos para responder
            preguntas específicas (tallas, materiales, garantías, etc.).
          </p>
        </div>

        {loaded && snap?.hasToken && (
          <div className="rounded-lg border border-emerald-400/18 bg-emerald-500/10 p-3 text-sm">
            Conectado a{" "}
            <span className="font-semibold">{snap.shopDomain}</span>
            {snap.apiVersion ? ` · API ${snap.apiVersion}` : null}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-[11px] uppercase text-[var(--color-text-soft)]">
              Dominio de la tienda
            </span>
            <input
              className="app-input w-full"
              placeholder="mitienda.myshopify.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[11px] uppercase text-[var(--color-text-soft)]">
              Admin API access token
              {snap?.hasToken && (
                <span className="ml-2 text-[var(--color-text-dim)]">
                  (déjalo vacío para mantener el actual)
                </span>
              )}
            </span>
            <input
              className="app-input w-full"
              placeholder="shpat_..."
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>

        <p className="text-xs leading-5 text-[var(--color-text-dim)]">
          Crea una <span className="font-medium">custom app</span> en Shopify
          Admin → Settings → Apps → Develop apps. Otorga al menos los scopes{" "}
          <code className="rounded bg-[rgba(8,21,30,0.72)] px-1">
            read_products
          </code>{" "}
          y{" "}
          <code className="rounded bg-[rgba(8,21,30,0.72)] px-1">
            read_orders
          </code>{" "}
          y copia el Admin API access token.
        </p>

        {msg && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              msg.kind === "ok"
                ? "border-emerald-400/18 bg-emerald-500/10"
                : "border-red-500/25 bg-red-950/20 text-red-100"
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            onClick={save}
            disabled={busy || !domain || (!snap?.hasToken && !token)}
            className="app-button"
          >
            {busy ? "Probando…" : snap?.hasToken ? "Actualizar" : "Conectar"}
          </button>
          {snap?.hasToken && (
            <button
              onClick={disconnect}
              disabled={busy}
              className="app-button-secondary border-red-500/25 text-red-100 hover:bg-red-950/30"
            >
              Desconectar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
