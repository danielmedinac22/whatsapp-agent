"use client";

import { useEffect, useState } from "react";
import type { WaConnectionStatus } from "@wa/shared";

const COLOR: Record<WaConnectionStatus, string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-500",
  qr: "bg-amber-500",
  disconnected: "bg-red-500",
};

const LABEL: Record<WaConnectionStatus, string> = {
  connected: "conectado",
  connecting: "conectando…",
  qr: "esperando QR",
  disconnected: "desconectado",
};

export function ConnectionIndicator() {
  const [status, setStatus] = useState<WaConnectionStatus>("disconnected");

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/wa/status", { cache: "no-store" });
        if (!alive || !r.ok) return;
        const j = (await r.json()) as { status: WaConnectionStatus };
        setStatus(j.status);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="app-card-muted flex h-10 items-center justify-between gap-3 px-3 text-xs">
      <span className="text-[var(--color-text-dim)]">WhatsApp</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${COLOR[status]}`} />
        <span className="truncate text-[var(--color-text)]">{LABEL[status]}</span>
      </span>
    </div>
  );
}
