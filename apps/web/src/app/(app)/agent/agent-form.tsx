"use client";

import { useMemo, useState } from "react";

import type { TemplateType } from "@wa/shared";

import { PromptCard, type ConversationOption } from "./prompt-card";

type Initial = {
  systemPrompt: string;
  model: string;
  debounceMs: number;
  followupDelayMs: number;
  followupTemplateId: string | null;
  remarketingDelayMs: number;
  remarketingTemplateId: string | null;
  confirmationAckTemplateId: string | null;
  activateAgentOnConfirm: boolean;
  dropiEnabled: boolean;
  dropiDryRun: boolean;
  dropiPollIntervalMin: number;
  dropiSyncIntervalMin: number;
  dropiMatchWindowDays: number;
  dropiTemplateGuiaId: string | null;
  dropiTemplateRecolectadoId: string | null;
  dropiTemplateEnTransitoId: string | null;
  dropiTemplateConMensajeroId: string | null;
  dropiTemplateEntregadoId: string | null;
  dropiTemplateEnOficinaId: string | null;
};

type TemplateOption = { id: string; name: string; type: TemplateType };

type ModelOption = { slug: string; label: string; group: "Anthropic" | "OpenAI" | "Google" };

const MODEL_OPTIONS: ModelOption[] = [
  // Anthropic
  { slug: "anthropic/claude-opus-4.7", label: "Claude Opus 4.7", group: "Anthropic" },
  { slug: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", group: "Anthropic" },
  { slug: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5", group: "Anthropic" },
  // OpenAI
  { slug: "openai/gpt-5.5-pro", label: "GPT-5.5 Pro", group: "OpenAI" },
  { slug: "openai/gpt-5.5", label: "GPT-5.5", group: "OpenAI" },
  { slug: "openai/gpt-5.4", label: "GPT-5.4", group: "OpenAI" },
  { slug: "openai/gpt-5.4-mini", label: "GPT-5.4 mini", group: "OpenAI" },
  { slug: "openai/gpt-5.4-nano", label: "GPT-5.4 nano", group: "OpenAI" },
  // Google
  { slug: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", group: "Google" },
  { slug: "google/gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite", group: "Google" },
  { slug: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", group: "Google" },
  { slug: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", group: "Google" },
];

const QUICK_MODELS = [
  { slug: "anthropic/claude-sonnet-4.6", label: "Sonnet 4.6" },
  { slug: "anthropic/claude-haiku-4.5", label: "Haiku 4.5" },
  { slug: "openai/gpt-5.4-mini", label: "GPT-5.4 mini" },
  { slug: "google/gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite" },
];

export function AgentForm({
  initial,
  templates,
  conversations,
}: {
  initial: Initial;
  templates: TemplateOption[];
  conversations: ConversationOption[];
}) {
  const tplFor = (...types: TemplateType[]) =>
    templates.filter((t) => types.includes(t.type) || t.type === "general");
  const [v, setV] = useState<Initial>(initial);
  const [baseline, setBaseline] = useState<Initial>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // El prompt tiene su propio guardado (con nota e historial), así que la
  // barra de abajo sólo mira el resto de la configuración.
  const dirty = useMemo(() => {
    const strip = ({ systemPrompt: _p, ...rest }: Initial) => rest;
    return JSON.stringify(strip(v)) !== JSON.stringify(strip(baseline));
  }, [v, baseline]);

  const persist = async (state: Initial) => {
    const r = await fetch("/api/agent/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    });
    if (!r.ok) {
      alert("Error al guardar");
      return false;
    }
    setBaseline(state);
    setSavedAt(Date.now());
    return true;
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      // Nunca publica un borrador del prompt: eso pasa sólo por su botón.
      await persist({ ...v, systemPrompt: baseline.systemPrompt });
    } finally {
      setSaving(false);
    }
  };

  const discard = () =>
    setV((s) => ({ ...baseline, systemPrompt: s.systemPrompt }));

  /** El prompt ya se guardó por su propio endpoint: sincroniza el baseline
   *  para que "Guardar configuración" no lo revierta. */
  const onPromptSaved = (prompt: string) => {
    setBaseline((b) => ({ ...b, systemPrompt: prompt }));
    setV((s) => ({ ...s, systemPrompt: prompt }));
    setSavedAt(Date.now());
  };

  return (
    <div className="space-y-4 pb-24">
      {/* System prompt — editor, banco de pruebas e historial */}
      <PromptCard
        value={v.systemPrompt}
        saved={baseline.systemPrompt}
        model={v.model}
        conversations={conversations}
        onChange={(systemPrompt) => setV((s) => ({ ...s, systemPrompt }))}
        onSaved={onPromptSaved}
      />

      {/* Model */}
      <section className="app-card p-4">
        <h2 className="text-base font-semibold">Modelo de IA</h2>
        <p className="mt-1 text-xs text-[var(--color-text-dim)]">
          Slug de OpenRouter. Escribe para autocompletar o usa un acceso
          rápido.
        </p>
        <input
          list="agent-models"
          value={v.model}
          onChange={(e) => setV({ ...v, model: e.target.value })}
          className="app-input mt-3 w-full"
          placeholder="anthropic/claude-sonnet-4.6"
          spellCheck={false}
          autoComplete="off"
        />
        <datalist id="agent-models">
          {MODEL_OPTIONS.map((m) => (
            <option key={m.slug} value={m.slug} label={`${m.label} · ${m.group}`} />
          ))}
        </datalist>
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_MODELS.map((m) => {
            const active = v.model === m.slug;
            return (
              <button
                key={m.slug}
                type="button"
                onClick={() => setV({ ...v, model: m.slug })}
                className={`rounded-md border px-2.5 py-1 text-xs transition ${
                  active
                    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                    : "border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-emerald-400/30"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Behaviour & timing */}
      <section className="app-card p-4">
        <h2 className="text-base font-semibold">Comportamiento y tiempos</h2>
        <p className="mt-1 text-xs text-[var(--color-text-dim)]">
          Cuándo responde el agente y cuándo dispara campañas.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <NumberField
            label="Debounce de respuesta"
            unit="segundos"
            min={0}
            max={120}
            step={1}
            value={Math.round(v.debounceMs / 1000)}
            onChange={(n) => setV({ ...v, debounceMs: n * 1000 })}
            help="Espera para agrupar mensajes consecutivos del cliente."
          />
          <NumberField
            label="Follow-up Shopify"
            unit="minutos"
            min={1}
            max={60}
            step={1}
            value={Math.round(v.followupDelayMs / 60000)}
            onChange={(n) => setV({ ...v, followupDelayMs: n * 60000 })}
            help="Tiempo desde el primer contacto sin compra."
          />
          <NumberField
            label="Remarketing"
            unit="horas"
            min={1}
            max={48}
            step={1}
            value={Math.round(v.remarketingDelayMs / 3_600_000)}
            onChange={(n) => setV({ ...v, remarketingDelayMs: n * 3_600_000 })}
            help="Tras carrito abandonado."
          />
        </div>
        <ToggleRow
          className="mt-4"
          label="Auto-activar agente al confirmar"
          help="Cuando el cliente confirma el pedido, el agente toma la conversación."
          checked={v.activateAgentOnConfirm}
          onChange={(b) => setV({ ...v, activateAgentOnConfirm: b })}
        />
      </section>

      {/* Templates */}
      <section className="app-card overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="text-base font-semibold">Plantillas</h2>
          <p className="mt-1 text-xs text-[var(--color-text-dim)]">
            Mensajes que el sistema envía automáticamente en cada momento.
          </p>
        </div>
        <TemplateRow
          label="Follow-up Shopify"
          help="Tras el delay configurado arriba si el cliente no responde."
          value={v.followupTemplateId}
          onChange={(id) => setV({ ...v, followupTemplateId: id })}
          options={tplFor("followup")}
        />
        <TemplateRow
          label="Remarketing"
          help="Carrito abandonado / segunda ronda."
          value={v.remarketingTemplateId}
          onChange={(id) => setV({ ...v, remarketingTemplateId: id })}
          options={tplFor("remarketing")}
        />
        <TemplateRow
          label="Acuse al confirmar"
          help="Confirmación inmediata que recibe el cliente."
          value={v.confirmationAckTemplateId}
          onChange={(id) => setV({ ...v, confirmationAckTemplateId: id })}
          options={tplFor("confirmation_ack")}
          last
        />
      </section>

      {/* Dropi */}
      <section className="app-card overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="text-base font-semibold">Seguimiento Dropi</h2>
          <p className="mt-1 text-xs text-[var(--color-text-dim)]">
            Sincronización de pedidos y notificaciones por estado de guía.
          </p>
        </div>
        <div className="space-y-3 px-4 py-3">
          <ToggleRow
            label="Activar integración"
            checked={v.dropiEnabled}
            onChange={(b) => setV({ ...v, dropiEnabled: b })}
          />
          <ToggleRow
            label="Dry-run"
            help="No envía PUT a Dropi — solo registra lo que haría."
            checked={v.dropiDryRun}
            onChange={(b) => setV({ ...v, dropiDryRun: b })}
          />
          <div className="grid gap-3 pt-1 md:grid-cols-3">
            <NumberField
              label="Polling"
              unit="min"
              min={1}
              max={120}
              step={1}
              value={v.dropiPollIntervalMin}
              onChange={(n) => setV({ ...v, dropiPollIntervalMin: n })}
            />
            <NumberField
              label="Sync"
              unit="min"
              min={1}
              max={240}
              step={1}
              value={v.dropiSyncIntervalMin}
              onChange={(n) => setV({ ...v, dropiSyncIntervalMin: n })}
            />
            <NumberField
              label="Ventana de match"
              unit="días"
              min={1}
              max={60}
              step={1}
              value={v.dropiMatchWindowDays}
              onChange={(n) => setV({ ...v, dropiMatchWindowDays: n })}
            />
          </div>
        </div>

        <div className="border-t border-[var(--color-border)] px-4 py-2 text-[11px] uppercase text-[var(--color-text-soft)]">
          Plantillas por estado
        </div>
        <TemplateRow
          label="Guía generada"
          value={v.dropiTemplateGuiaId}
          onChange={(id) => setV({ ...v, dropiTemplateGuiaId: id })}
          options={tplFor("dropi_guia_generada")}
        />
        <TemplateRow
          label="Recolectado"
          value={v.dropiTemplateRecolectadoId}
          onChange={(id) => setV({ ...v, dropiTemplateRecolectadoId: id })}
          options={tplFor("dropi_recolectado")}
        />
        <TemplateRow
          label="En tránsito"
          value={v.dropiTemplateEnTransitoId}
          onChange={(id) => setV({ ...v, dropiTemplateEnTransitoId: id })}
          options={tplFor("dropi_en_transito")}
        />
        <TemplateRow
          label="Con mensajero"
          value={v.dropiTemplateConMensajeroId}
          onChange={(id) => setV({ ...v, dropiTemplateConMensajeroId: id })}
          options={tplFor("dropi_con_mensajero")}
        />
        <TemplateRow
          label="Entregado"
          value={v.dropiTemplateEntregadoId}
          onChange={(id) => setV({ ...v, dropiTemplateEntregadoId: id })}
          options={tplFor("dropi_entregado")}
        />
        <TemplateRow
          label="En oficina (por reclamar)"
          value={v.dropiTemplateEnOficinaId}
          onChange={(id) => setV({ ...v, dropiTemplateEnOficinaId: id })}
          options={tplFor("dropi_en_oficina")}
          last
        />
      </section>

      {/* Sticky save bar */}
      {dirty && (
        <div className="fixed bottom-4 left-1/2 z-30 w-[min(720px,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-emerald-400/30 bg-[rgba(8,21,30,0.96)] px-4 py-3 shadow-[0_18px_40px_rgba(3,10,16,0.6)] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-[var(--color-text)]">
              Tienes cambios sin guardar
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={discard}
                disabled={saving}
                className="app-button-secondary"
              >
                Descartar
              </button>
              <button
                type="button"
                onClick={saveAll}
                disabled={saving}
                className="app-button"
              >
                {saving ? "Guardando…" : "Guardar configuración"}
              </button>
            </div>
          </div>
        </div>
      )}

      {!dirty && savedAt && Date.now() - savedAt < 2500 && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-md border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-100 shadow-lg">
          Guardado
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
  help,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (n: number) => void;
  help?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] uppercase text-[var(--color-text-soft)]">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
          }}
          className="app-input w-24 text-sm tabular-nums"
        />
        <span className="text-xs text-[var(--color-text-dim)]">{unit}</span>
      </div>
      {help && (
        <p className="text-[11px] leading-snug text-[var(--color-text-dim)]">
          {help}
        </p>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  help,
  checked,
  onChange,
  className,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (b: boolean) => void;
  className?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-[var(--color-border)] bg-[rgba(8,21,30,0.55)] px-3 py-2.5 ${className ?? ""}`}
    >
      <div>
        <p className="text-sm text-[var(--color-text)]">{label}</p>
        {help && (
          <p className="mt-0.5 text-[11px] text-[var(--color-text-dim)]">
            {help}
          </p>
        )}
      </div>
      <Switch checked={checked} onChange={onChange} />
    </label>
  );
}

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition ${
        checked
          ? "bg-emerald-500/70"
          : "bg-[rgba(255,255,255,0.12)]"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function TemplateRow({
  label,
  help,
  value,
  onChange,
  options,
  last,
}: {
  label: string;
  help?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  options: TemplateOption[];
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-3 ${
        last ? "" : "border-b border-[var(--color-border)]"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-[var(--color-text)]">{label}</p>
        {help && (
          <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-dim)]">
            {help}
          </p>
        )}
      </div>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="app-select w-[260px] max-w-[55%] flex-shrink-0"
      >
        <option value="">— ninguna —</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}
