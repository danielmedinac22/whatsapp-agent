"use client";

import { useEffect, useState } from "react";

/**
 * Los cierres que no llegaron a la tienda.
 *
 * Existe porque **una venta cerrada que falla en silencio es peor que no
 * vender**: el cliente ya se despidió creyendo que compró, y nadie lo descubre
 * hasta que escribe molesto. Esta lista es la mitad visible de esa promesa — la
 * otra es la alerta que le llega al equipo por WhatsApp.
 *
 * Vive dentro de la tarjeta de la tienda a propósito: un cierre encolado casi
 * siempre lo está por algo de la conexión —no conectada, token corto, la tienda
 * caída—, así que el sitio donde se arregla es este mismo.
 */

type Closing = {
  id: string;
  awaitingHuman: boolean;
  reason: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  createdAt: string;
  conversationId: string | null;
  leadRef: string | null;
  customerName: string;
  customerPhone: string | null;
};

export function StoreClosings() {
  const [closings, setClosings] = useState<Closing[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/shopify/closings", { cache: "no-store" });
        if (!alive || !r.ok) return;
        const j = (await r.json()) as { closings: Closing[] };
        setClosings(j.closings);
      } catch {
        /* la lista vacía es la verdad hasta que haya cierres */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Sin cierres pendientes no se dibuja nada. Una tarjeta vacía que dice «no
  // hay nada» ocupa el mismo espacio que una con problemas y entrena a no
  // mirarla.
  if (!closings || closings.length === 0) return null;

  const esperando = closings.filter((c) => c.awaitingHuman);
  const reintentando = closings.filter((c) => !c.awaitingHuman);

  return (
    <div className="space-y-3 border-t border-[rgba(255,255,255,0.06)] pt-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          Cierres que no llegaron a la tienda
        </h3>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-dim)]">
          Ventas que el vendedor cerró y todavía no son un pedido. Los datos
          están guardados: ninguna se perdió.
        </p>
      </div>

      {esperando.length > 0 && (
        <Grupo
          titulo={`${esperando.length} esperan a una persona`}
          tono="err"
          detalle="Se agotaron los reintentos o el fallo no mejora reintentando. Hay que crear el pedido a mano."
          items={esperando}
        />
      )}

      {reintentando.length > 0 && (
        <Grupo
          titulo={`${reintentando.length} en reintento`}
          tono="warn"
          detalle="El sistema los vuelve a intentar solo, con esperas cada vez más largas."
          items={reintentando}
        />
      )}
    </div>
  );
}

function Grupo({
  titulo,
  detalle,
  tono,
  items,
}: {
  titulo: string;
  detalle: string;
  tono: "err" | "warn";
  items: Closing[];
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        tono === "err"
          ? "border-red-500/25 bg-red-950/20"
          : "border-amber-400/25 bg-amber-500/10"
      }`}
    >
      <p className="text-sm font-semibold text-[var(--color-text)]">{titulo}</p>
      <p className="mt-0.5 text-xs leading-5 text-[var(--color-text-dim)]">
        {detalle}
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((c) => (
          <li
            key={c.id}
            className="rounded-md bg-[rgba(8,21,30,0.45)] p-2 text-xs leading-5"
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-[var(--color-text)]">
                {c.customerName || c.customerPhone || "Cliente sin nombre"}
              </span>
              {c.customerPhone && (
                <span className="text-[var(--color-text-dim)]">
                  {c.customerPhone}
                </span>
              )}
              <span className="text-[var(--color-text-soft)]">
                {new Date(c.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="mt-1 text-[var(--color-text-dim)]">{c.reason}</div>
            {!c.awaitingHuman && (
              <div className="mt-0.5 text-[var(--color-text-soft)]">
                Intento {c.attempts} de {c.maxAttempts}
                {c.nextAttemptAt
                  ? ` · próximo ${new Date(c.nextAttemptAt).toLocaleString()}`
                  : ""}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
