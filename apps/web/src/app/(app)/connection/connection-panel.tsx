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
    <div className="w-full max-w-md space-y-6 rounded-lg bg-[var(--color-panel)] p-8 border">
      <div>
        <h2 className="text-xl font-semibold">Conexión de WhatsApp</h2>
        <p className="text-sm text-[var(--color-text-dim)]">
          Estado:{" "}
          <span className="font-medium text-[var(--color-text)]">
            {labelFor(snap.status)}
          </span>
        </p>
      </div>

      {snap.status === "connected" && (
        <div className="rounded bg-[var(--color-bubble-out)]/40 p-4 text-sm">
          Tu WhatsApp está conectado.
        </div>
      )}

      {snap.qr && snap.status !== "connected" && (
        <div className="flex flex-col items-center gap-3">
          <canvas ref={canvasRef} className="rounded bg-white p-2" />
          <p className="text-center text-xs text-[var(--color-text-dim)]">
            Abre WhatsApp en tu teléfono → Dispositivos vinculados → Vincular
            dispositivo
          </p>
        </div>
      )}

      <div className="flex gap-2">
        {snap.status !== "connected" && (
          <button
            onClick={start}
            className="flex-1 rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            {snap.qr ? "Regenerar QR" : "Iniciar / mostrar QR"}
          </button>
        )}
        {snap.status === "connected" && (
          <button
            onClick={logout}
            className="flex-1 rounded border border-red-500/40 px-4 py-2 text-sm text-red-300 hover:bg-red-900/20"
          >
            Desconectar
          </button>
        )}
      </div>
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
