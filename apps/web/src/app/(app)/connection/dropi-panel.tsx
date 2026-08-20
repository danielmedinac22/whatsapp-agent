"use client";

import { useEffect, useState } from "react";

type DropiState = {
  apiBaseUrl: string;
  email: string | null;
  userId: number | null;
  hasBearer: boolean;
  hasPassword: boolean;
  tokenExpiresAt: string | null;
  assetsBaseUrl: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
  lastAutoLoginAt: string | null;
  lastAutoLoginError: string | null;
  adminPhone: string | null;
  pending2faExpiresAt: string | null;
  pending2faRequestedAt: string | null;
  has2faPending: boolean;
} | null;

export function DropiPanel() {
  const [snap, setSnap] = useState<DropiState>(null);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bearer, setBearer] = useState("");
  const [assetsBaseUrl, setAssetsBaseUrl] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const load = async () => {
    const r = await fetch("/api/dropi/connection", { cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as DropiState;
      setSnap(j);
      if (j?.email) setEmail(j.email);
      if (j?.assetsBaseUrl) setAssetsBaseUrl(j.assetsBaseUrl);
      if (j?.adminPhone) setAdminPhone(j.adminPhone);
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
      if (assetsBaseUrl.trim() && assetsBaseUrl !== snap?.assetsBaseUrl) {
        body.assetsBaseUrl = assetsBaseUrl.trim();
      }
      if (adminPhone.trim() !== (snap?.adminPhone ?? "")) {
        body.adminPhone = adminPhone.trim() || null;
      }
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
      setEditing(false);
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

  const submitOtp = async () => {
    const code = otpCode.trim();
    if (!/^\d{4,8}$/.test(code)) {
      setMsg({ kind: "err", text: "código inválido (4-8 dígitos)" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/dropi/connection/2fa/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        userId?: number;
        error?: string;
      };
      if (!r.ok || !j.ok) {
        setMsg({ kind: "err", text: j.error ?? "verify falló" });
        return;
      }
      setMsg({
        kind: "ok",
        text: `token Dropi renovado · user ${j.userId}`,
      });
      setOtpCode("");
      await load();
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

  const tryAutoLogin = async () => {
    if (!snap?.adminPhone) {
      setMsg({
        kind: "err",
        text:
          "Guarda primero el teléfono admin para 2FA — el auto-login te escribirá ahí cuando Dropi pida código.",
      });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/dropi/connection/refresh", {
        method: "POST",
      });
      const j = (await r.json()) as {
        ok?: boolean;
        userId?: number;
        error?: string;
      };
      if (!r.ok || !j.ok) {
        setMsg({ kind: "err", text: j.error ?? "auto-login falló" });
        return;
      }
      setMsg({
        kind: "ok",
        text: `auto-login ok · user ${j.userId}`,
      });
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
      setEditing(false);
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
            <code className="mx-1 rounded bg-[var(--color-ink-wash)] px-1">
              status=PENDIENTE
            </code>
            ) y notifica al cliente cuando cambia el estado de la guía.
          </p>
        </div>

        {loaded && snap?.hasBearer && !editing && (
          <div className="rounded-lg border border-[color-mix(in_srgb,var(--state-auto-fg)_35%,transparent)] bg-[var(--state-auto-bg)] p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--state-auto-bg)] text-[var(--state-auto-fg)]">
                ✓
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-[var(--state-auto-fg)]">
                  Conectado
                </p>
                <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                  {snap.email ?? "—"}
                </p>
                <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-[var(--color-text-dim)] sm:grid-cols-2">
                  {snap.userId !== null && (
                    <DetailRow label="User ID" value={String(snap.userId)} />
                  )}
                  {tokenExpiresLabel && (
                    <DetailRow label="Token expira" value={tokenExpiresLabel} />
                  )}
                  {snap.adminPhone && (
                    <DetailRow label="Admin 2FA" value={`+${snap.adminPhone}`} />
                  )}
                  {snap.lastAutoLoginAt && (
                    <DetailRow
                      label="Último auto-login"
                      value={new Date(snap.lastAutoLoginAt).toLocaleString()}
                    />
                  )}
                  {snap.assetsBaseUrl && (
                    <DetailRow label="CDN" value={snap.assetsBaseUrl} />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        {loaded && !snap?.hasBearer && (
          <div className="rounded-lg border border-[color-mix(in_srgb,var(--state-espera-fg)_35%,transparent)] bg-[var(--state-espera-bg)] p-3 text-sm text-[var(--state-espera-fg)]">
            Sin token activo. Guarda email + password y pulsa &laquo;Probar
            auto-login&raquo;, o pega un bearer manual.
          </div>
        )}
        {loaded && snap?.lastAutoLoginError && (
          <div className="rounded-lg border border-[color-mix(in_srgb,var(--state-escalada-fg)_35%,transparent)] bg-[var(--state-escalada-bg)] p-3 text-sm text-[var(--state-escalada-fg)]">
            Último auto-login falló: {snap.lastAutoLoginError}
            {snap.lastAutoLoginAt
              ? ` (${new Date(snap.lastAutoLoginAt).toLocaleString()})`
              : null}
          </div>
        )}

        {loaded && snap?.has2faPending && (
          <div className="space-y-2 rounded-lg border border-[color-mix(in_srgb,var(--state-espera-fg)_35%,transparent)] bg-[var(--state-espera-bg)] p-3 text-sm text-[var(--state-espera-fg)]">
            <div className="font-semibold">🔐 Dropi pidió código 2FA</div>
            <div className="text-xs">
              Te lo pedimos por WhatsApp{snap.adminPhone ? ` al ${snap.adminPhone}` : ""}
              . También puedes pegarlo aquí:
              {snap.pending2faExpiresAt
                ? ` (vence ${new Date(snap.pending2faExpiresAt).toLocaleTimeString()})`
                : ""}
            </div>
            <div className="flex gap-2">
              <input
                className="app-input flex-1"
                placeholder="código de 6 dígitos"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
              <button
                onClick={submitOtp}
                disabled={busy || !/^\d{4,8}$/.test(otpCode.trim())}
                className="app-button"
              >
                Enviar OTP
              </button>
            </div>
          </div>
        )}

        {loaded && (!snap?.hasBearer || editing) && (
        <>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-[11px] uppercase text-[var(--color-text-dim)]">
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
            <span className="text-[11px] uppercase text-[var(--color-text-dim)]">
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
          <span className="text-[11px] uppercase text-[var(--color-text-dim)]">
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

        <label className="space-y-1 text-sm">
          <span className="text-[11px] uppercase text-[var(--color-text-dim)]">
            Teléfono admin para 2FA (E.164 sin +, ej. 573167405767)
          </span>
          <input
            className="app-input w-full"
            placeholder="573167405767"
            value={adminPhone}
            onChange={(e) => setAdminPhone(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="block text-[11px] text-[var(--color-text-dim)]">
            Cuando Dropi pida código 2FA, te escribimos a este número y al
            responder con el código de Google Authenticator se renueva el
            token automáticamente.
          </span>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-[11px] uppercase text-[var(--color-text-dim)]">
            Base URL de assets (CDN de Dropi para PDFs de guías)
          </span>
          <input
            className="app-input w-full"
            placeholder="https://d2ob47cxeawi8a.cloudfront.net"
            value={assetsBaseUrl}
            onChange={(e) => setAssetsBaseUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={save}
            disabled={
              busy ||
              (!email &&
                !password &&
                !bearer &&
                adminPhone.trim() === (snap?.adminPhone ?? "") &&
                assetsBaseUrl.trim() === (snap?.assetsBaseUrl ?? ""))
            }
            className="app-button"
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
          <button
            onClick={tryAutoLogin}
            disabled={
              busy || !(snap?.email || email) || !(snap?.hasPassword || password)
            }
            className="app-button-secondary"
            title="Hace login con email+password y guarda un nuevo bearer"
          >
            Probar auto-login
          </button>
          {editing && (
            <button
              onClick={() => {
                setEditing(false);
                setPassword("");
                setBearer("");
                setEmail(snap?.email ?? "");
                setAssetsBaseUrl(snap?.assetsBaseUrl ?? "");
                setAdminPhone(snap?.adminPhone ?? "");
                setMsg(null);
              }}
              className="app-button-secondary"
              disabled={busy}
            >
              Cancelar
            </button>
          )}
        </div>
        </>
        )}

        {msg && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              msg.kind === "ok"
                ? "border-[color-mix(in_srgb,var(--state-auto-fg)_35%,transparent)] bg-[var(--state-auto-bg)]"
                : "border-[color-mix(in_srgb,var(--state-escalada-fg)_35%,transparent)] bg-[var(--state-escalada-bg)] text-[var(--state-escalada-fg)]"
            }`}
          >
            {msg.text}
          </div>
        )}

        {loaded && snap?.hasBearer && !editing && (
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => {
                setEditing(true);
                setMsg(null);
              }}
              className="app-button-secondary"
            >
              Editar
            </button>
            <button
              onClick={runSync}
              disabled={busy}
              className="app-button-secondary"
            >
              Probar sync
            </button>
            <button
              onClick={disconnect}
              disabled={busy}
              className="app-button-secondary border-[color-mix(in_srgb,var(--state-escalada-fg)_35%,transparent)] text-[var(--state-escalada-fg)] hover:bg-[var(--state-escalada-bg)]"
            >
              Desconectar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-dim)]">
        {label}
      </span>
      <span className="truncate text-[var(--color-text)]">{value}</span>
    </div>
  );
}
