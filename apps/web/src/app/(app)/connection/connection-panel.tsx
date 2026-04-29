"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { WaConnectionStatus } from "@wa/shared";

type Snapshot = { status: WaConnectionStatus; qr: string | null };

export function ConnectionPanel() {
  const [snap, setSnap] = useState<Snapshot>({
    status: "disconnected",
    qr: null,
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    const es = new EventSource("/api/events");
    es.addEventListener("wa", (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data) as
          | { type: "qr"; qr: string }
          | { type: "status"; status: WaConnectionStatus };
        if (ev.type === "qr") {
          setSnap((s) => ({ ...s, qr: ev.qr, status: "qr" }));
        } else if (ev.type === "status") {
          setSnap((s) => ({
            ...s,
            status: ev.status,
            qr: ev.status === "connected" ? null : s.qr,
          }));
        }
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      // browser will retry automatically
    };

    return () => {
      alive = false;
      es.close();
    };
  }, []);

  useEffect(() => {
    if (snap.qr && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, snap.qr, {
        width: 280,
        margin: 1,
      }).catch(() => {});
    }
  }, [snap.qr]);

  const start = async () => {
    await fetch("/api/wa/start", { method: "POST" });
  };
  const logout = async () => {
    if (!confirm("¿Cerrar sesión de WhatsApp y borrar credenciales?")) return;
    await fetch("/api/wa/logout", { method: "POST" });
    setSnap({ status: "disconnected", qr: null });
  };

  return (
    <div className="app-card w-full max-w-5xl p-4">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Conexión de WhatsApp</h2>
            <p className="mt-1 text-sm leading-5 text-[var(--color-text-dim)]">
              Estado:{" "}
              <span className="font-medium text-[var(--color-text)]">
                {labelFor(snap.status)}
              </span>
            </p>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <StatusTile
              label="Estado"
              value={labelFor(snap.status)}
              accent={snap.status === "connected" ? "text-emerald-300" : "text-amber-200"}
            />
            <StatusTile
              label="Sesión"
              value={snap.status === "connected" ? "Activa" : "Pendiente"}
            />
            <StatusTile
              label="Acción"
              value={snap.status === "connected" ? "Monitorear" : "Escanear QR"}
            />
          </div>

          {snap.status === "connected" && (
            <div className="rounded-lg border border-emerald-400/18 bg-emerald-500/10 p-3 text-sm">
              Tu WhatsApp está conectado y listo para recibir y enviar mensajes.
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {snap.status !== "connected" && (
              <button onClick={start} className="app-button">
                {snap.qr ? "Regenerar QR" : "Iniciar / mostrar QR"}
              </button>
            )}
            {snap.status === "connected" && (
              <button
                onClick={logout}
                className="app-button-secondary border-red-500/25 text-red-100 hover:bg-red-950/30"
              >
                Desconectar
              </button>
            )}
          </div>
        </div>

        <div className="app-card-muted flex min-h-[280px] flex-col items-center justify-center gap-3 p-4">
          {snap.qr && snap.status !== "connected" ? (
            <>
              <canvas ref={canvasRef} className="rounded-lg bg-white p-2" />
              <p className="max-w-xs text-center text-xs leading-5 text-[var(--color-text-dim)]">
                Abre WhatsApp en tu teléfono, entra a Dispositivos vinculados y
                escanea este código.
              </p>
            </>
          ) : (
            <>
              <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[rgba(8,21,30,0.72)] text-2xl">
                {snap.status === "connected" ? "✓" : "⌁"}
              </div>
              <p className="max-w-xs text-center text-sm leading-5 text-[var(--color-text-dim)]">
                {snap.status === "connected"
                  ? "La sesión está enlazada. Puedes seguir operando desde el inbox."
                  : "Cuando generes el QR, aparecerá aquí para completar el enlace del dispositivo."}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[rgba(8,21,30,0.72)] px-3 py-2">
      <p className="text-[11px] uppercase text-[var(--color-text-soft)]">
        {label}
      </p>
      <p className={`mt-1 text-sm font-semibold text-[var(--color-text)] ${accent ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

function labelFor(s: WaConnectionStatus): string {
  switch (s) {
    case "connected":
      return "conectado";
    case "connecting":
      return "conectando…";
    case "qr":
      return "esperando escaneo de QR";
    case "disconnected":
      return "desconectado";
  }
}
