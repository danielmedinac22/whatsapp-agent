"use client";

import { useState } from "react";

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
};

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
  templates: { id: string; name: string }[];
}) {
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
        <select
          value={v.followupTemplateId ?? ""}
          onChange={(e) =>
            setV({ ...v, followupTemplateId: e.target.value || null })
          }
          className="app-select"
        >
          <option value="">— ninguna —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
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
          <select
            value={v.remarketingTemplateId ?? ""}
            onChange={(e) =>
              setV({ ...v, remarketingTemplateId: e.target.value || null })
            }
            className="app-select"
          >
            <option value="">— ninguna —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Plantilla de acuse al confirmar">
        <select
          value={v.confirmationAckTemplateId ?? ""}
          onChange={(e) =>
            setV({ ...v, confirmationAckTemplateId: e.target.value || null })
          }
          className="app-select"
        >
          <option value="">— ninguna —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
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
