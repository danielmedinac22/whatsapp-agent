"use client";

import { useMemo, useState } from "react";
import {
  activeSalesTonePreset,
  discountEdgeQuestion,
  SALES_DISCOUNT_BEHAVIOR_OPTIONS,
  SALES_REASONING_EFFORTS,
  SALES_TONE_PRESETS,
  salesDiscountState,
  type SalesDiscountBehavior,
} from "@wa/shared";

/**
 * La configuración del vendedor: secciones apiladas, la misma anatomía que la
 * de Katherine (`agent/agent-form.tsx`) — cuatro `app-card` con su `<h2>`, y la
 * barra de guardado abajo.
 *
 * **Sin pestañas, y no es una omisión.** Partir una configuración en pestañas
 * esconde la mitad de lo que se está cambiando; cuando esta pantalla crezca, lo
 * que crece es el scroll. Está decidido y no se re-litiga.
 *
 * El orden es el de una configuración normal —quién es, qué dice, qué puede
 * dar— y no el del riesgo. Se propuso poner el límite de descuento primero por
 * ser lo único que cuesta plata, y se prefirió conservar el orden de lectura,
 * que además es el que ya tiene la pantalla de Katherine.
 *
 * Lo único con tratamiento propio es el límite: es el único campo del panel que
 * gasta plata y no tenía precedente en la anatomía heredada.
 */

/** El borrador que se edita. `reasoningEffort` es texto porque la columna lo es. */
type Draft = {
  displayName: string;
  greeting: string;
  closingPush: string;
  funnelMessage: string;
  toneInstructions: string;
  discountLimitPct: number;
  discountLimitBehavior: SalesDiscountBehavior;
  model: string;
  reasoningEffort: string;
};

/**
 * Los mismos slugs que ofrece la pantalla de Katherine. Están repetidos y no
 * importados de allá a propósito: su lista es de su formulario, y el vendedor
 * puede querer otra —hoy arranca en un `mini` porque persuadir no es una tarea
 * de razonamiento y la latencia en WhatsApp cuesta ventas—. El campo es de
 * texto libre con autocompletado, así que la lista no cierra nada.
 */
const MODEL_OPTIONS = [
  { slug: "openai/gpt-5.4-mini", label: "GPT-5.4 mini · OpenAI" },
  { slug: "openai/gpt-5.4", label: "GPT-5.4 · OpenAI" },
  { slug: "openai/gpt-5.5", label: "GPT-5.5 · OpenAI" },
  { slug: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5 · Anthropic" },
  { slug: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6 · Anthropic" },
  {
    slug: "google/gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash Lite · Google",
  },
];

const EFFORT_LABEL: Record<string, string> = {
  low: "Bajo — responde antes",
  medium: "Medio",
  high: "Alto — piensa más, tarda más",
};

export function VendedorForm({
  initial,
  phone,
}: {
  initial: Draft;
  /** El número por el que sale lo que escribe. Contexto, no campo. */
  phone: string | null;
}) {
  const [v, setV] = useState<Draft>(initial);
  const [baseline, setBaseline] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(v) !== JSON.stringify(baseline),
    [v, baseline],
  );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setV((s) => ({ ...s, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/vendedor/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(v),
      });
      if (!r.ok) {
        setError(
          r.status === 400
            ? "Hay un campo que la configuración no acepta. Revisa el límite de descuento y el modelo."
            : "No se pudo guardar. Intenta de nuevo.",
        );
        return;
      }
      setBaseline(v);
      setSavedAt(Date.now());
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const prohibido = salesDiscountState(v.discountLimitPct) === "prohibido";
  const preset = activeSalesTonePreset(v.toneInstructions);

  return (
    <div className="space-y-4 pb-24">
      {/* ── Identidad ─────────────────────────────────────────────────── */}
      <section className="app-card p-4">
        <h2 className="text-base font-semibold">Identidad</h2>
        <p className="mt-1 text-xs text-[var(--color-text-dim)]">
          Lo que el cliente ve.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field
            label="Nombre visible"
            /* El listón de «hay vendedor» es este campo, y decirlo acá es lo
               único que impide que alguien llene el tono, guarde, y crea que ya
               está atendiendo. */
            help="Con este campo vacío el vendedor no atiende: la conversación la sigue llevando el agente de confirmación."
            value={v.displayName}
            onChange={(s) => set("displayName", s)}
            placeholder="Sebastián"
          />
          <div className="space-y-1">
            <label className="text-[11px] uppercase text-[var(--color-text-dim)]">
              Número que responde
            </label>
            <input
              value={phone ?? "sin conexión de WhatsApp"}
              readOnly
              className="app-input tabular-nums text-[var(--color-text-dim)]"
            />
            <p className="text-[11px] leading-snug text-[var(--color-text-dim)]">
              Se configura en Conexión; esta pantalla no lo cambia.
            </p>
          </div>
        </div>
      </section>

      {/* ── Mensajes base ─────────────────────────────────────────────── */}
      <section className="app-card p-4">
        <h2 className="text-base font-semibold">Mensajes base</h2>
        <p className="mt-1 text-xs text-[var(--color-text-dim)]">
          Los momentos que controlas palabra por palabra. Lo que dejes vacío no
          se le menciona.
        </p>
        <div className="mt-3 space-y-3">
          <Field
            label="Saludo"
            help="Con qué abre cuando alguien escribe por primera vez."
            value={v.greeting}
            onChange={(s) => set("greeting", s)}
            placeholder="¡Hola! Soy Sebastián de Vorare 👋 ¿En qué te ayudo?"
          />
          <Field
            label="Empuje al cierre"
            help="Lo que dice cuando la conversación ya está madura."
            value={v.closingPush}
            onChange={(s) => set("closingPush", s)}
            placeholder="¿Te lo aparto? Pagas cuando lo recibes."
          />
          <Field
            label="Mensaje de embudo"
            help="Para quien todavía está mirando y no quiere decidir hoy."
            value={v.funnelMessage}
            onChange={(s) => set("funnelMessage", s)}
            placeholder="Te dejo el enlace por si quieres verlo con calma."
          />
        </div>
      </section>

      {/* ── El límite ─ el único campo del panel que gasta plata ──────── */}
      <section className="app-card border-[color-mix(in_srgb,var(--state-espera-fg)_35%,transparent)] bg-[var(--state-espera-bg)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-[var(--color-warn)]">
            Límite de descuento
          </h2>
          <span className="rounded bg-[var(--color-warn)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-[var(--color-card)]">
            tiene consecuencia
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={v.discountLimitPct}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) {
                  set("discountLimitPct", Math.max(0, Math.min(100, Math.trunc(n))));
                }
              }}
              aria-label="Límite de descuento en porcentaje"
              /* El verde del cero no es decorativo: prohibir descuentos es el
                 estado seguro y el valor por defecto de la columna, así que no
                 puede pintarse como una alarma. */
              className={`h-11 w-24 rounded-md border px-3 text-center text-lg font-bold tabular-nums outline-none transition ${
                prohibido
                  ? "border-[color-mix(in_srgb,var(--color-ink)_40%,transparent)] bg-[var(--state-auto-bg)] text-[var(--color-ink)]"
                  : "border-[color-mix(in_srgb,var(--state-espera-fg)_40%,transparent)] bg-[var(--state-espera-bg)] text-[var(--color-warn)]"
              }`}
            />
            <span className="text-sm text-[var(--color-text-dim)]">%</span>
          </div>
          <p className="max-w-[46ch] flex-1 text-xs leading-relaxed text-[var(--color-text-dim)]">
            {prohibido ? (
              <>
                <strong className="text-[var(--color-ink)]">
                  Los descuentos están prohibidos.
                </strong>{" "}
                Si el cliente insiste con el precio, el vendedor defiende el
                valor del producto y no inventa rebajas ni promociones.
              </>
            ) : (
              <>
                El vendedor puede negociar hasta{" "}
                <strong className="text-[var(--color-text)]">
                  {v.discountLimitPct}%
                </strong>{" "}
                por su cuenta, y solo si hace falta para cerrar — no lo ofrece de
                entrada. Pon <strong className="text-[var(--color-text)]">0</strong>{" "}
                para prohibirlos.
              </>
            )}
          </p>
        </div>

        {/* ── el borde ─ un límite sin consecuencia declarada no está
            definido: está numerado. La pregunta se reformula sola con el
            límite en cero, porque prohibir descuentos no evita que se los
            pidan — solo cambia qué es «pasarse». ──────────────────────── */}
        <div className="mt-4 border-t border-[color-mix(in_srgb,var(--state-espera-fg)_25%,transparent)] pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-dim)]">
            {discountEdgeQuestion(v.discountLimitPct)}
          </p>
          <div className="mt-2 space-y-1.5">
            {SALES_DISCOUNT_BEHAVIOR_OPTIONS.map((o) => {
              const active = v.discountLimitBehavior === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set("discountLimitBehavior", o.key)}
                  className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition ${
                    active
                      ? "border-[color-mix(in_srgb,var(--state-espera-fg)_40%,transparent)] bg-[var(--state-espera-bg)]"
                      : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                  }`}
                >
                  <span
                    className={`mt-[3px] flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full border ${
                      active
                        ? "border-[var(--color-warn)]"
                        : "border-[var(--color-border-strong)]"
                    }`}
                  >
                    {active ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warn)]" />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{o.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-[var(--state-auto-fg)]">
                      {o.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {/* Lo que la pantalla no puede prometer, dicho donde se decide: hoy
              las tres viajan como instrucción al vendedor. Ticket 01 ya lo
              había dejado escrito para el límite, y vale igual para su borde. */}
          <p className="mt-2 text-[11px] leading-snug text-[var(--color-text-dim)]">
            Las tres viajan como instrucción al vendedor. El límite se hace
            cumplir al armar el pedido —ahí el sistema recorta y avisa—, no en
            medio del chat.
          </p>
        </div>
      </section>

      {/* ── Tono ──────────────────────────────────────────────────────── */}
      <section className="app-card p-4">
        <h2 className="text-base font-semibold">Tono e instrucciones</h2>
        <p className="mt-1 text-xs text-[var(--color-text-dim)]">
          No tiene consecuencia: cambia cómo suena, no lo que puede hacer.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {SALES_TONE_PRESETS.map((p) => {
            const active = preset === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => set("toneInstructions", p.text)}
                aria-pressed={active}
                className={`rounded-lg border p-2.5 text-left transition ${
                  active
                    ? "border-[color-mix(in_srgb,var(--state-auto-fg)_35%,transparent)] bg-[var(--state-auto-bg)]"
                    : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                }`}
              >
                <span className="block text-sm font-semibold">{p.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-[var(--color-text-dim)]">
                  {p.hint}
                </span>
              </button>
            );
          })}
        </div>

        <label className="mt-3 block text-[11px] uppercase text-[var(--color-text-dim)]">
          Instrucciones
        </label>
        <textarea
          rows={5}
          value={v.toneInstructions}
          onChange={(e) => set("toneInstructions", e.target.value)}
          className="app-textarea mt-1"
          placeholder="Cómo habla, qué evita, qué aclara siempre."
        />
        <p className="mt-1 text-[11px] leading-snug text-[var(--color-text-dim)]">
          Texto libre. Los presets son un punto de partida: en cuanto edites una
          coma, el texto es tuyo y ninguna tarjeta queda marcada.
        </p>
      </section>

      {/* ── Modelo ────────────────────────────────────────────────────── */}
      <section className="app-card p-4">
        <h2 className="text-base font-semibold">Modelo y razonamiento</h2>
        <p className="mt-1 text-xs text-[var(--color-text-dim)]">
          Con qué modelo contesta. Si cierra mal, es el primer sospechoso — y
          cambiarlo es guardar, no desplegar.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-[11px] uppercase text-[var(--color-text-dim)]">
              Modelo
            </label>
            <input
              list="vendedor-models"
              value={v.model}
              onChange={(e) => set("model", e.target.value)}
              className="app-input"
              spellCheck={false}
              autoComplete="off"
              placeholder="openai/gpt-5.4-mini"
            />
            <datalist id="vendedor-models">
              {MODEL_OPTIONS.map((m) => (
                <option key={m.slug} value={m.slug} label={m.label} />
              ))}
            </datalist>
            <p className="text-[11px] leading-snug text-[var(--color-text-dim)]">
              Slug de OpenRouter.
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] uppercase text-[var(--color-text-dim)]">
              Esfuerzo de razonamiento
            </label>
            <select
              value={v.reasoningEffort}
              onChange={(e) => set("reasoningEffort", e.target.value)}
              className="app-select"
            >
              {SALES_REASONING_EFFORTS.map((e) => (
                <option key={e} value={e}>
                  {EFFORT_LABEL[e] ?? e}
                </option>
              ))}
              {/* La columna es texto libre: si lo guardado no es ninguno de los
                  tres, se muestra tal cual en vez de fingir otro valor. */}
              {!SALES_REASONING_EFFORTS.includes(
                v.reasoningEffort as (typeof SALES_REASONING_EFFORTS)[number],
              ) && (
                <option value={v.reasoningEffort}>
                  {v.reasoningEffort} — valor guardado, no reconocido
                </option>
              )}
            </select>
            <p className="text-[11px] leading-snug text-[var(--color-text-dim)]">
              Persuadir no es una tarea de razonamiento: subirlo agrega segundos
              de espera en cada respuesta.
            </p>
          </div>
        </div>
      </section>

      {/* ── Barra de guardado ─────────────────────────────────────────── */}
      {dirty && (
        <div className="fixed bottom-4 left-1/2 z-30 w-[min(720px,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-[color-mix(in_srgb,var(--state-auto-fg)_35%,transparent)] bg-[var(--color-card)] px-4 py-3 shadow-[var(--shadow-panel)] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--color-text)]">
              {error ?? "Los cambios aplican en la próxima conversación, sin desplegar."}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setV(baseline);
                  setError(null);
                }}
                disabled={saving}
                className="app-button-secondary"
              >
                Descartar
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="app-button"
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {!dirty && savedAt && Date.now() - savedAt < 2500 && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-md border border-[color-mix(in_srgb,var(--state-auto-fg)_35%,transparent)] bg-[var(--state-auto-bg)] px-3 py-1.5 text-xs text-[var(--state-auto-fg)] shadow-lg">
          Guardado
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  help,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] uppercase text-[var(--color-text-dim)]">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="app-input"
        placeholder={placeholder}
      />
      <p className="text-[11px] leading-snug text-[var(--color-text-dim)]">
        {help}
      </p>
    </div>
  );
}
