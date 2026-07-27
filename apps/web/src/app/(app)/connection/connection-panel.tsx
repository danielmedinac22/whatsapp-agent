"use client";

import { useEffect, useState } from "react";

type Snapshot = {
  status: "connected" | "disconnected";
  phone?: string | null;
  phoneNumberId?: string | null;
  displayName?: string | null;
  kind?: string | null;
  connectedAt?: string | null;
};

export function ConnectionPanel() {
  const [snap, setSnap] = useState<Snapshot>({ status: "disconnected" });

  useEffect(() => {
    let alive = true;
    const fetchStatus = async () => {
      try {
        const r = await fetch("/api/wa/status", { cache: "no-store" });
        if (!alive || !r.ok) return;
        const j = (await r.json()) as Snapshot;
        setSnap(j);
      } catch {
        /* ignore */
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  const connected = snap.status === "connected";

  return (
    <div className="app-card w-full max-w-5xl p-4">
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Conexión de WhatsApp</h2>
          <p className="mt-1 text-sm leading-5 text-[var(--color-text-dim)]">
            Número conectado vía Kapso (WhatsApp Cloud API oficial). Sin QR ni
            sesiones que expiren: la conexión se gestiona desde el panel de
            Kapso.
          </p>
        </div>

        {connected ? (
          <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/25 text-emerald-200">
                ✓
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-emerald-300/80">
                  Conectado {snap.kind === "sandbox" ? "· sandbox" : ""}
                </p>
                <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                  {snap.displayName || "WhatsApp Business"}
                </p>
                {snap.phone && (
                  <p className="truncate text-xs text-[var(--color-text-dim)]">
                    {snap.phone.startsWith("+") ? snap.phone : `+${snap.phone}`}
                  </p>
                )}
                {snap.phoneNumberId && (
                  <p className="truncate text-xs text-[var(--color-text-dim)]">
                    phone_number_id: {snap.phoneNumberId}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            Sin número conectado. Conecta o aprovisiona un número desde el panel
            de Kapso (app.kapso.ai) y vincúlalo al worker con{" "}
            <code className="rounded bg-black/30 px-1">
              POST /api/kapso/connect
            </code>
            .
          </div>
        )}
      </div>
    </div>
  );
}
