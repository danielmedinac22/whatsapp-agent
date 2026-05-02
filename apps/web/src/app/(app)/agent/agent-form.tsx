"use client";

import { useState } from "react";

import type { TemplateType } from "@wa/shared";

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
};

type TemplateOption = { id: string; name: string; type: TemplateType };

const MODELS = [
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-4o-mini",
  "openai/gpt-4.1",
  "google/gemini-2.5-flash",
  "meta-llama/llama-3.3-70b-instruct",
];

export function AgentForm({
  initial,
  templates,
}: {
  initial: Initial;
  templates: TemplateOption[];
}) {
  const tplFor = (...types: TemplateType[]) =>
    templates.filter((t) => types.includes(t.type) || t.type === "general");
  const [v, setV] = useState<Initial>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const r = await fetch("/api/agent/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(v),
      });
      if (r.ok) setSaved(true);
      else alert("Error al guardar");
    } finally {
      setSaving(false);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="app-card space-y-4 p-4"
    >
      <div className="grid gap-2 rounded-lg border border-[var(--color-border)] bg-[rgba(8,21,30,0.75)] p-3 md:grid-cols-3">
        <Metric label="Modelo" value={v.model.split("/").pop() ?? v.model} />
        <Metric label="Debounce" value={`${Math.round(v.debounceMs / 1000)}s`} />
        <Metric
          label="Auto activación"
          value={v.activateAgentOnConfirm ? "Encendida" : "Apagada"}
        />
      </div>

      <Field label="Prompt del sistema">
        <textarea
          value={v.systemPrompt}
          onChange={(e) => setV({ ...v, systemPrompt: e.target.value })}
          rows={8}
          className="app-textarea"
          placeholder="Eres un asistente de servicio al cliente…"
        />
      </Field>

      <Field label="Modelo (OpenRouter)">
        <select
          value={v.model}
          onChange={(e) => setV({ ...v, model: e.target.value })}
          className="app-select"
        >
          {MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          {!MODELS.includes(v.model) && (
            <option value={v.model}>{v.model} (custom)</option>
          )}
        </select>
        <input
          value={v.model}
          onChange={(e) => setV({ ...v, model: e.target.value })}
          className="app-input mt-3 text-xs"
          placeholder="o pega un slug custom de openrouter.ai/models"
        />
      </Field>

      <div className="grid gap-3 lg:grid-cols-2">
        <Field label={`Desfase / debounce (${v.debounceMs} ms)`}>
          <input
            type="range"
            min={0}
            max={60000}
            step={500}
            value={v.debounceMs}
            onChange={(e) =>
              setV({ ...v, debounceMs: Number(e.target.value) })
            }
            className="w-full"
          />
        </Field>

        <Field
          label={`Follow-up Shopify (${Math.round(v.followupDelayMs / 60000)} min)`}
        >
          <input
            type="range"
            min={60_000}
            max={60 * 60_000}
            step={60_000}
            value={v.followupDelayMs}
            onChange={(e) =>
              setV({ ...v, followupDelayMs: Number(e.target.value) })
            }
            className="w-full"
          />
        </Field>
      </div>

      <Field label="Plantilla de follow-up">
        <TemplateSelect
          value={v.followupTemplateId}
          onChange={(id) => setV({ ...v, followupTemplateId: id })}
          options={tplFor("followup")}
        />
      </Field>

      <div className="grid gap-3 lg:grid-cols-2">
        <Field
          label={`Remarketing (${(v.remarketingDelayMs / 3_600_000).toFixed(1)} h)`}
        >
          <input
            type="range"
            min={60 * 60_000}
            max={24 * 60 * 60_000}
            step={30 * 60_000}
            value={v.remarketingDelayMs}
            onChange={(e) =>
              setV({ ...v, remarketingDelayMs: Number(e.target.value) })
            }
            className="w-full"
          />
        </Field>

        <Field label="Plantilla de remarketing">
          <TemplateSelect
            value={v.remarketingTemplateId}
            onChange={(id) => setV({ ...v, remarketingTemplateId: id })}
            options={tplFor("remarketing")}
          />
        </Field>
      </div>

      <Field label="Plantilla de acuse al confirmar">
        <TemplateSelect
          value={v.confirmationAckTemplateId}
          onChange={(id) => setV({ ...v, confirmationAckTemplateId: id })}
          options={tplFor("confirmation_ack")}
        />
      </Field>

      <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[rgba(8,21,30,0.75)] px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={v.activateAgentOnConfirm}
          onChange={(e) =>
            setV({ ...v, activateAgentOnConfirm: e.target.checked })
          }
        />
        Activar agente automáticamente cuando el cliente responde al pedido
      </label>

      <fieldset className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[rgba(8,21,30,0.5)] p-4">
        <legend className="px-1 text-xs uppercase text-[var(--color-text-soft)]">
          Seguimiento Dropi
        </legend>

        <div className="grid gap-2 md:grid-cols-2">
          <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[rgba(8,21,30,0.75)] px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={v.dropiEnabled}
              onChange={(e) => setV({ ...v, dropiEnabled: e.target.checked })}
            />
            Activar integración Dropi
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[rgba(8,21,30,0.75)] px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={v.dropiDryRun}
              onChange={(e) => setV({ ...v, dropiDryRun: e.target.checked })}
            />
            Dry-run (no envía PUT a Dropi, sólo registra)
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Field label={`Polling cada ${v.dropiPollIntervalMin} min`}>
            <input
              type="range"
              min={1}
              max={60}
              step={1}
              value={v.dropiPollIntervalMin}
              onChange={(e) =>
                setV({ ...v, dropiPollIntervalMin: Number(e.target.value) })
              }
              className="w-full"
            />
          </Field>
          <Field label={`Sync cada ${v.dropiSyncIntervalMin} min`}>
            <input
              type="range"
              min={5}
              max={120}
              step={5}
              value={v.dropiSyncIntervalMin}
              onChange={(e) =>
                setV({ ...v, dropiSyncIntervalMin: Number(e.target.value) })
              }
              className="w-full"
            />
          </Field>
          <Field label={`Ventana de match (±${v.dropiMatchWindowDays}d)`}>
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={v.dropiMatchWindowDays}
              onChange={(e) =>
                setV({ ...v, dropiMatchWindowDays: Number(e.target.value) })
              }
              className="w-full"
            />
          </Field>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Plantilla · guía generada">
            <TemplateSelect
              value={v.dropiTemplateGuiaId}
              onChange={(id) => setV({ ...v, dropiTemplateGuiaId: id })}
              options={tplFor("dropi_guia_generada")}
            />
          </Field>
          <Field label="Plantilla · recolectado">
            <TemplateSelect
              value={v.dropiTemplateRecolectadoId}
              onChange={(id) => setV({ ...v, dropiTemplateRecolectadoId: id })}
              options={tplFor("dropi_recolectado")}
            />
          </Field>
          <Field label="Plantilla · en tránsito">
            <TemplateSelect
              value={v.dropiTemplateEnTransitoId}
              onChange={(id) => setV({ ...v, dropiTemplateEnTransitoId: id })}
              options={tplFor("dropi_en_transito")}
            />
          </Field>
          <Field label="Plantilla · con mensajero">
            <TemplateSelect
              value={v.dropiTemplateConMensajeroId}
              onChange={(id) =>
                setV({ ...v, dropiTemplateConMensajeroId: id })
              }
              options={tplFor("dropi_con_mensajero")}
            />
          </Field>
          <Field label="Plantilla · entregado">
            <TemplateSelect
              value={v.dropiTemplateEntregadoId}
              onChange={(id) => setV({ ...v, dropiTemplateEntregadoId: id })}
              options={tplFor("dropi_entregado")}
            />
          </Field>
        </div>
      </fieldset>

      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="text-sm text-[var(--color-accent)]">Guardado</span>
        )}
        <button type="submit" disabled={saving} className="app-button">
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs uppercase text-[var(--color-text-soft)]">
        {label}
      </label>
      {children}
    </div>
  );
}

function TemplateSelect({
  value,
  onChange,
  options,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  options: TemplateOption[];
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="app-select"
    >
      <option value="">— ninguna —</option>
      {options.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[rgba(12,27,38,0.76)] px-3 py-2">
      <p className="text-[11px] uppercase text-[var(--color-text-soft)]">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-[var(--color-text)]">
        {value}
      </p>
    </div>
  );
}
