"use client";

import { useEffect, useState } from "react";

type DropiState = {
  apiBaseUrl: string;
  email: string | null;
  userId: number | null;
  hasBearer: boolean;
  hasPassword: boolean;
  tokenExpiresAt: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
} | null;

export function DropiPanel() {
  const [snap, setSnap] = useState<DropiState>(null);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bearer, setBearer] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const load = async () => {
    const r = await fetch("/api/dropi/connection", { cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as DropiState;
      setSnap(j);
      if (j?.email) setEmail(j.email);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await load();
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
      const body: Record<string, unknown> = {};
      if (email.trim()) body.email = email.trim();
      if (password.trim()) body.password = password.trim();
      if (bearer.trim()) body.bearerToken = bearer.trim();
      const r = await fetch("/api/dropi/connection", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as { ok?: boolean; error?: unknown };
      if (!r.ok || !j.ok) {
        setMsg({
          kind: "err",
          text:
            typeof j.error === "string"
              ? j.error
              : "no se pudo guardar la conexión",
        });
        return;
      }
      setMsg({ kind: "ok", text: "guardado" });
      setPassword("");
      setBearer("");
      await load();
    } catch (err) {
      setMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const runSync = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/dropi/sync", { method: "POST" });
      const j = (await r.json()) as {
        ok?: boolean;
        fetched?: number;
        upserted?: number;
        matched?: number;
        error?: string;
      };
      if (!r.ok || !j.ok) {
        setMsg({
          kind: "err",
          text: j.error ?? "sync falló",
        });
        return;
      }
      setMsg({
        kind: "ok",
        text: `sync ok · ${j.fetched ?? 0} pedidos · ${j.matched ?? 0} con match Shopify`,
      });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("¿Desconectar Dropi? Se perderá el token y las credenciales."))
      return;
    setBusy(true);
    try {
      await fetch("/api/dropi/connection", { method: "DELETE" });
      setSnap(null);
      setEmail("");
      setPassword("");
      setBearer("");
      setMsg({ kind: "ok", text: "desconectado" });
    } finally {
      setBusy(false);
    }
  };

  const tokenExpiresLabel = snap?.tokenExpiresAt
    ? new Date(snap.tokenExpiresAt).toLocaleString()
    : null;

  return (
    <div className="app-card w-full max-w-5xl p-4">
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Conexión de Dropi</h2>
          <p className="mt-1 text-sm leading-5 text-[var(--color-text-dim)]">
            Sincroniza pedidos, marca como confirmados (PUT
            <code className="mx-1 rounded bg-[rgba(8,21,30,0.72)] px-1">
              status=PENDIENTE
            </code>
            ) y notifica al cliente cuando cambia el estado de la guía.
          </p>
        </div>

        {loaded && snap?.hasBearer && (
          <div className="rounded-lg border border-emerald-400/18 bg-emerald-500/10 p-3 text-sm">
            Token activo
            {snap.userId ? ` · user ${snap.userId}` : null}
            {tokenExpiresLabel ? ` · expira ${tokenExpiresLabel}` : null}
          </div>
        )}
        {loaded && !snap?.hasBearer && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            Sin token activo. Pega un bearer manual mientras no esté cableado el
            login automático.
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-[11px] uppercase text-[var(--color-text-soft)]">
              Email Dropi (para login automático)
            </span>
            <input
              className="app-input w-full"
              placeholder="usuario@dropi.gt"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[11px] uppercase text-[var(--color-text-soft)]">
              Password Dropi
              {snap?.hasPassword && (
                <span className="ml-2 text-[var(--color-text-dim)]">
                  (déjalo vacío para mantener)
                </span>
              )}
            </span>
            <input
              className="app-input w-full"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
          </label>
        </div>

        <label className="space-y-1 text-sm">
          <span className="text-[11px] uppercase text-[var(--color-text-soft)]">
            Bearer manual (temporal — pegar JWT desde DevTools)
          </span>
          <input
            className="app-input w-full"
            type="password"
            placeholder="eyJ0eXA…"
            value={bearer}
            onChange={(e) => setBearer(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

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
            disabled={busy || (!email && !password && !bearer)}
            className="app-button"
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
          <button
            onClick={runSync}
            disabled={busy || !snap?.hasBearer}
            className="app-button-secondary"
          >
            Probar sync
          </button>
          {snap?.hasBearer && (
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
