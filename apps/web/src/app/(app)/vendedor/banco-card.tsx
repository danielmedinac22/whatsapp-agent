"use client";

import { useRef, useState } from "react";
import type { SalesAgentSettingsInput } from "@wa/shared";
import type { ProductoDelBanco } from "@/lib/vendedor";

/**
 * El banco de pruebas del vendedor: **conversar con Sebastián sin encenderlo.**
 *
 * Hermana de la pestaña «Probar» de Katherine (`agent/prompt-card.tsx`), y
 * existe por algo que en aquella no pasaba. Encender a Katherine no es un acto:
 * ya está encendida. Encender al vendedor sí lo es, y además es **irreversible
 * en un punto** — el guardado que le escribe un nombre estampa la línea de
 * corte, y esa fecha no se vuelve a mover. Sin este banco, la única manera de
 * saber cómo contesta era tomar esa decisión.
 *
 * Por eso manda **lo que está en el formulario ahora**, sin guardar: se prueba
 * el borrador, se ajusta el tono, se vuelve a probar, y recién cuando convence
 * se guarda.
 *
 * **El estado de la conversación vive acá y en ningún otro lado.** No hay fila,
 * no hay conversación, no hay `agent_runs`: cada turno manda la historia
 * completa. Recargar la pantalla empieza de cero, y está bien — una prueba que
 * sobreviviera a la recarga sería un estado más que mantener de acuerdo con la
 * configuración que se está editando.
 */

/** Un mensaje de la historia, tal como viaja al modelo. */
type Turno = { role: "user" | "assistant"; content: string };

/**
 * Lo que la pantalla dibuja de un turno del vendedor.
 *
 * **No es lo mismo que lo que el modelo escribió**, y por eso son campos
 * distintos: en un turno de cierre el sistema reemplaza su texto, y mostrar el
 * suyo enseñaría un mensaje que el cliente nunca va a leer. `noSalio` es
 * justamente ese texto, guardado para poder ver la diferencia.
 */
type Respondio = {
  textos: string[];
  fuente: "modelo" | "sistema";
  /** Lo que el vendedor redactó y no llegó a salir. */
  noSalio: string | null;
};

/** Los tres estados reales de la cascada de reconocimiento. */
type Origen =
  /** El anuncio resolvió a un producto. Es el caso que la pauta paga. */
  | { kind: "resuelto"; productId: string }
  /** El anuncio no está registrado, o el lead llegó sin anuncio. */
  | { kind: "desconocido" }
  /** El anuncio apunta a varios y la cascada no elige. */
  | { kind: "ambiguo"; candidateIds: string[] };

interface Pedido {
  kind:
    | "armado"
    | "faltan_datos"
    | "falta_la_presentacion"
    | "a_un_asesor"
    | "sin_tienda";
  order?: {
    currency: string;
    lines: Array<{ title: string; quantity: number; unitPrice: number; lineTotal: number }>;
    totals: { subtotal: number; discount: number; total: number };
    customer: { firstName: string; lastName: string; phone: string };
    shipping: { kind: string; city: string; division: string; address?: string };
    tags: string[];
  };
  discountClamped?: boolean;
  requestedPct?: number;
  appliedPct?: number;
  errors?: Array<{ code: string; field?: string; value?: string }>;
  opciones?: string[];
  motivo?: string;
}

interface Respuesta {
  reply: string;
  cliente: { textos: string[]; fuente: "modelo" | "sistema" };
  writeMode: "dry_run" | "live";
  effectiveSystemPrompt: string;
  podiaCerrar: boolean;
  pedido: Pedido | null;
}

export function BancoCard({
  values,
  productos,
}: {
  /**
   * El borrador del formulario, tal como está ahora.
   *
   * `reasoningEffort` llega como `string` y no como el conjunto cerrado porque
   * la columna es texto libre y el formulario muestra lo guardado aunque no lo
   * reconozca. Quien lo rechaza es el esquema del banco, del otro lado, y la
   * pantalla lo dice como lo que es: un campo que no se puede probar.
   */
  values: Omit<SalesAgentSettingsInput, "reasoningEffort"> & {
    reasoningEffort: string;
  };
  productos: ProductoDelBanco[];
}) {
  const [origen, setOrigen] = useState<Origen>(
    productos[0] ? { kind: "resuelto", productId: productos[0].id } : { kind: "desconocido" },
  );
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [respuestas, setRespuestas] = useState<Record<number, Respondio>>({});
  const [pedidos, setPedidos] = useState<Record<number, Pedido>>({});
  const [writeMode, setWriteMode] = useState<"dry_run" | "live" | null>(null);
  const [texto, setTexto] = useState("");
  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  const sinNombre = values.displayName.trim() === "";

  const enviar = async () => {
    const mensaje = texto.trim();
    if (!mensaje || corriendo) return;

    const historia: Turno[] = [...turnos, { role: "user", content: mensaje }];
    setTurnos(historia);
    setTexto("");
    setError(null);
    setCorriendo(true);

    try {
      const r = await fetch("/api/vendedor/probar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          settings: values,
          productId: origen.kind === "resuelto" ? origen.productId : null,
          candidateIds: origen.kind === "ambiguo" ? origen.candidateIds : null,
          turns: historia,
        }),
      });

      if (!r.ok) {
        setError(
          r.status === 400
            ? "Hay un campo de la configuración que no se puede probar. Revisá el límite de descuento, el modelo y el razonamiento."
            : "No se pudo probar. El proveedor del modelo no contestó — puede ser el saldo de la llave.",
        );
        return;
      }

      const j = (await r.json()) as Respuesta;
      setPrompt(j.effectiveSystemPrompt);
      setWriteMode(j.writeMode);

      // La historia que viaja al modelo es **lo que salió**, no lo que redactó:
      // es lo que `loadHistory` lee en producción, donde el hilo guarda los
      // mensajes enviados. Un turno del que no salió nada no entra en la
      // historia, porque para el cliente no ocurrió.
      const salio = j.cliente.textos.join("\n\n").trim();
      const indice = historia.length;
      setRespuestas((r0) => ({
        ...r0,
        [indice]: {
          textos: j.cliente.textos,
          fuente: j.cliente.fuente,
          noSalio:
            j.cliente.fuente === "sistema" && j.reply.trim() ? j.reply.trim() : null,
        },
      }));
      if (j.pedido) setPedidos((p) => ({ ...p, [indice]: j.pedido as Pedido }));
      if (salio) setTurnos([...historia, { role: "assistant", content: salio }]);

      requestAnimationFrame(() =>
        finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }),
      );
    } catch {
      setError("No se pudo probar. Revisá la conexión e intentá de nuevo.");
    } finally {
      setCorriendo(false);
    }
  };

  return (
    <section className="app-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Probar</h2>
        {turnos.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setTurnos([]);
              setRespuestas({});
              setPedidos({});
              setError(null);
              setPrompt(null);
            }}
            className="text-xs text-[var(--color-text-dim)] underline underline-offset-2"
          >
            Empezar de nuevo
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-[var(--color-text-dim)]">
        Conversá con el vendedor tal como está configurado arriba,{" "}
        <strong className="font-semibold text-[var(--color-text)]">
          sin guardar y sin encenderlo
        </strong>
        . No sale ningún mensaje por WhatsApp, no se crea ningún pedido y ningún
        cliente se entera.
      </p>

      {writeMode && (
        <p className="mt-2 text-[11px] leading-snug text-[var(--color-text-dim)]">
          {writeMode === "live"
            ? "La escritura a la tienda está encendida, así que al cerrar el cliente leería el pedido con su número. Acá igual no se crea ninguno."
            : "La escritura a la tienda está en seco, así que al cerrar el cliente lee que sus datos quedaron y que una persona le confirma — no que el pedido exista."}
        </p>
      )}

      {sinNombre && (
        <p className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--state-espera-fg)_35%,transparent)] bg-[var(--state-espera-bg)] px-3 py-2 text-[11px] leading-snug text-[var(--state-espera-fg)]">
          Todavía no tiene nombre visible, así que se va a presentar sin nombre.
          Escribí uno arriba para probarlo entero — probar no lo enciende, solo
          guardar lo hace.
        </p>
      )}

      {/* ── De dónde viene el lead ────────────────────────────────────── */}
      <div className="mt-4 space-y-1">
        <label className="text-[11px] uppercase text-[var(--color-text-dim)]">
          De dónde viene el cliente
        </label>
        <select
          value={
            origen.kind === "resuelto" ? origen.productId : origen.kind
          }
          onChange={(e) => {
            const val = e.target.value;
            if (val === "desconocido") setOrigen({ kind: "desconocido" });
            else if (val === "ambiguo")
              setOrigen({
                kind: "ambiguo",
                candidateIds: productos.slice(0, 3).map((p) => p.id),
              });
            else setOrigen({ kind: "resuelto", productId: val });
          }}
          className="app-input"
        >
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name ?? "(sin nombre local — se lee de la tienda)"}
              {p.vendible ? "" : " — sin precio, no se puede cerrar"}
            </option>
          ))}
          <option value="desconocido">
            Llegó sin anuncio reconocido — no sabe qué producto
          </option>
          {productos.length > 1 && (
            <option value="ambiguo">
              El anuncio apunta a varios — tiene que preguntar cuál
            </option>
          )}
        </select>
        <p className="text-[11px] leading-snug text-[var(--color-text-dim)]">
          En producción esto lo deduce el clic del anuncio, y es lo único que un
          banco no puede simular. Los tres casos son reales: mirá también los dos
          de abajo, que son los que decide una conversación que llega sin
          anuncio.
        </p>
        {productos.length === 0 && (
          <p className="text-[11px] leading-snug text-[var(--color-warn)]">
            El catálogo está vacío, así que solo se puede probar el caso sin
            producto. Cargá uno en Catálogo para ver el cierre completo.
          </p>
        )}
      </div>

      {/* ── La conversación ───────────────────────────────────────────── */}
      <div className="mt-4 space-y-2">
        {turnos.length === 0 && (
          <p className="rounded-md bg-[var(--color-surface-sunk,var(--color-bg))] px-3 py-6 text-center text-xs text-[var(--color-text-dim)]">
            Escribí como escribiría un cliente. Preguntá el precio, dudá, pedí
            descuento.
          </p>
        )}

        {turnos.map((t, i) => {
          if (t.role === "user") {
            return (
              <div
                key={i}
                className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--state-auto-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
              >
                <p className="whitespace-pre-wrap leading-relaxed">{t.content}</p>
              </div>
            );
          }
          const r = respuestas[i];
          return (
            <div key={i} className="space-y-2">
              {(r?.textos ?? [t.content]).map((texto, k) => (
                <div
                  key={k}
                  className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-text)]"
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{texto}</p>
                  {r?.fuente === "sistema" && (
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--color-text-dim)]">
                      Lo escribe el sistema, no el vendedor
                    </p>
                  )}
                </div>
              ))}
              {pedidos[i] && <PedidoArmado pedido={pedidos[i]} />}
              {r?.noSalio && (
                <details className="mr-auto max-w-[85%]">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-[var(--color-text-dim)]">
                    El vendedor redactó algo que no sale
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap rounded-md border border-dashed border-[var(--color-border)] px-3 py-2 text-xs leading-relaxed text-[var(--color-text-dim)]">
                    {r.noSalio}
                  </p>
                </details>
              )}
            </div>
          );
        })}

        {corriendo && (
          <p className="text-xs text-[var(--color-text-dim)]">Pensando…</p>
        )}
        <div ref={finRef} />
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--color-warn)_35%,transparent)] px-3 py-2 text-xs leading-snug text-[var(--color-warn)]">
          {error}
        </p>
      )}

      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar();
            }
          }}
          rows={2}
          placeholder="Hola, vi el anuncio…"
          className="app-input min-h-[2.75rem] flex-1 resize-none"
        />
        <button
          type="button"
          onClick={() => void enviar()}
          disabled={corriendo || texto.trim() === ""}
          className="app-button shrink-0"
        >
          {corriendo ? "…" : "Enviar"}
        </button>
      </div>

      {prompt && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] uppercase text-[var(--color-text-dim)]">
            Lo que el modelo leyó
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-[var(--color-bg)] p-3 text-[11px] leading-relaxed text-[var(--color-text-dim)]">
            {prompt}
          </pre>
        </details>
      )}
    </section>
  );
}

/**
 * Qué pasó cuando el vendedor intentó cerrar.
 *
 * **Dice «se habría armado», nunca «quedó registrado».** El pedido no existe en
 * ninguna parte, y es la misma regla por la que el cierre en modo seco prefiere
 * callarse antes que decirle al cliente que su pedido quedó: una pantalla de
 * pruebas que hable como producción entrena a creerle.
 */
function PedidoArmado({ pedido }: { pedido: Pedido }) {
  if (pedido.kind === "armado" && pedido.order) {
    const o = pedido.order;
    return (
      <div className="mr-auto max-w-[85%] rounded-lg border border-[color-mix(in_srgb,var(--state-auto-fg)_35%,transparent)] bg-[var(--state-auto-bg)] px-3 py-2.5 text-xs">
        <p className="text-[10px] uppercase tracking-wide text-[var(--state-auto-fg)]">
          El pedido que se habría armado · no existe
        </p>
        <ul className="mt-1.5 space-y-0.5 text-[var(--color-text)]">
          {o.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span>
                {l.quantity} × {l.title}
              </span>
              <span className="tabular-nums">
                {o.currency} {l.lineTotal.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-1.5 flex justify-between gap-2 border-t border-[color-mix(in_srgb,var(--state-auto-fg)_25%,transparent)] pt-1.5 font-semibold text-[var(--color-text)]">
          <span>Total</span>
          <span className="tabular-nums">
            {o.currency} {o.totals.total.toFixed(2)}
          </span>
        </div>
        <p className="mt-1.5 text-[var(--color-text-dim)]">
          {o.customer.firstName} {o.customer.lastName} · {o.customer.phone}
          <br />
          {o.shipping.kind === "pickup_at_office"
            ? `Reclama en oficina · ${o.shipping.city}, ${o.shipping.division}`
            : `${o.shipping.address} · ${o.shipping.city}, ${o.shipping.division}`}
        </p>
        {pedido.discountClamped && (
          <p className="mt-1.5 text-[var(--color-warn)]">
            Pactó {pedido.requestedPct}% y el límite es {pedido.appliedPct}%: se
            cobraría el autorizado y un asesor lo revisaría.
          </p>
        )}
      </div>
    );
  }

  const texto =
    pedido.kind === "faltan_datos"
      ? `Le faltan datos para armarlo: ${(pedido.errors ?? [])
          .map((e) => FALTA[e.code] ?? e.code)
          .join(", ")}.`
      : pedido.kind === "falta_la_presentacion"
        ? `Tiene que preguntar la presentación: ${(pedido.opciones ?? []).join(", ")}.`
        : pedido.kind === "sin_tienda"
          ? "La tienda no está conectada. En producción el pedido quedaría en cola esperando, sin perderse."
          : `En producción esto habría pasado a un asesor. ${pedido.motivo ?? ""}`;

  return (
    <div className="mr-auto max-w-[85%] rounded-lg border border-[color-mix(in_srgb,var(--state-espera-fg)_35%,transparent)] bg-[var(--state-espera-bg)] px-3 py-2 text-xs leading-relaxed text-[var(--state-espera-fg)]">
      {texto}
    </div>
  );
}

/** Los errores del constructor de orden, dichos como los diría una persona. */
const FALTA: Record<string, string> = {
  missing_required: "un dato obligatorio",
  address_and_pickup_conflict: "dio dirección y dijo que reclama en oficina",
  phone_invalid: "el teléfono no es válido para el país",
  division_unknown: "ese departamento no existe",
  city_unknown: "ese municipio no existe en el país",
  city_in_other_division: "el municipio no está en ese departamento",
  country_unsupported: "no hay listas para el país de la operación",
  no_lines: "no hay ningún producto en el pedido",
  line_invalid: "la cantidad o el precio de la línea no sirven",
};
