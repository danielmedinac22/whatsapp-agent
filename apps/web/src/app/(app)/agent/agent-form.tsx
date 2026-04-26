"use client";

import { useState } from "react";

type Initial = {
  systemPrompt: string;
  model: string;
  debounceMs: number;
  followupDelayMs: number;
  followupTemplateId: string | null;
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
      className="space-y-5 rounded bg-[var(--color-panel)] p-5 border"
    >
      <Field label="Prompt del sistema">
        <textarea
          value={v.systemPrompt}
          onChange={(e) => setV({ ...v, systemPrompt: e.target.value })}
          rows={8}
          className="w-full rounded bg-[var(--color-panel-2)] px-3 py-2 outline-none"
          placeholder="Eres un asistente de servicio al cliente…"
        />
      </Field>

      <Field label="Modelo (OpenRouter)">
        <select
          value={v.model}
          onChange={(e) => setV({ ...v, model: e.target.value })}
          className="w-full rounded bg-[var(--color-panel-2)] px-3 py-2 outline-none"
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
          className="mt-2 w-full rounded bg-[var(--color-panel-2)] px-3 py-2 text-xs outline-none"
          placeholder="o pega un slug custom de openrouter.ai/models"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
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
          <p className="text-xs text-[var(--color-text-dim)]">
            Tiempo que esperamos para agrupar mensajes consecutivos del mismo
            contacto en una sola petición al modelo.
          </p>
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
          <p className="text-xs text-[var(--color-text-dim)]">
            Cuánto esperamos tras un pedido sin respuesta antes de mandar el
            mensaje de follow-up.
          </p>
        </Field>
      </div>

      <Field label="Plantilla de follow-up">
        <select
          value={v.followupTemplateId ?? ""}
          onChange={(e) =>
            setV({ ...v, followupTemplateId: e.target.value || null })
          }
          className="w-full rounded bg-[var(--color-panel-2)] px-3 py-2 outline-none"
        >
          <option value="">— ninguna —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>

      <label className="flex items-center gap-2 text-sm">
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
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
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
      <label className="text-xs uppercase tracking-wide text-[var(--color-text-dim)]">
        {label}
      </label>
      {children}
    </div>
  );
}
