"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Play, PencilLine, RotateCcw, Loader2 } from "lucide-react";

const MAX_PROMPT_CHARS = 8000;

export type ConversationOption = { id: string; label: string };

type VersionSummary = {
  id: string;
  label: string | null;
  authorEmail: string | null;
  createdAt: string;
  length: number;
  preview: string;
};

type PreviewResult = {
  reply: string;
  effectiveSystemPrompt: string;
  history: { role: "user" | "assistant"; content: string }[];
  usedConversation: boolean;
};

type Tab = "editor" | "historial" | "probar";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Editor del system prompt: escribir, probar sin enviar nada al cliente y
 * volver a cualquier versión anterior. El valor vive en el formulario padre
 * para que guardar la configuración completa nunca pise lo que se editó aquí.
 */
export function PromptCard({
  value,
  saved,
  model,
  conversations,
  onChange,
  onSaved,
}: {
  value: string;
  saved: string;
  model: string;
  conversations: ConversationOption[];
  onChange: (prompt: string) => void;
  onSaved: (prompt: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("editor");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = value !== saved;
  const tooLong = value.length > MAX_PROMPT_CHARS;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/agent/prompt", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: value, label: note || null }),
      });
      if (!r.ok) {
        setError("No se pudo guardar el prompt. Intenta de nuevo.");
        return;
      }
      onSaved(value);
      setNote("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="app-card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div className="min-w-[220px] flex-1">
          <h2 className="text-base font-semibold">Prompt del sistema</h2>
          <p className="mt-1 text-xs text-[var(--color-text-dim)]">
            Define el rol, tono, información de producto y cuándo pasar a un
            asesor. Se aplica a la siguiente respuesta del agente — no requiere
            un nuevo despliegue.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] p-1">
          <TabButton
            active={tab === "editor"}
            onClick={() => setTab("editor")}
            icon={PencilLine}
            label="Editor"
          />
          <TabButton
            active={tab === "probar"}
            onClick={() => setTab("probar")}
            icon={Play}
            label="Probar"
          />
          <TabButton
            active={tab === "historial"}
            onClick={() => setTab("historial")}
            icon={History}
            label="Historial"
          />
        </div>
      </div>

      {/* Superficie de trabajo, no de aviso. En oscuro este panel era un tinte
          cálido apenas visible; traducirlo al ámbar de «sin responder» lo
          convertía en una advertencia permanente sobre algo que no la tiene. El
          ámbar queda para lo que sí es estado: «sin guardar». */}
      {tab === "editor" && (
        <div className="bg-[var(--color-surface)] p-4">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={20}
            spellCheck={false}
            placeholder="Eres un asistente de servicio al cliente…"
            className="block w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3 font-mono text-sm leading-relaxed text-[var(--color-text)] outline-none transition focus:border-[var(--color-ink)]"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span
              className={
                tooLong ? "text-[var(--state-escalada-fg)]" : "text-[var(--color-text-dim)]"
              }
            >
              {value.length.toLocaleString()} / {MAX_PROMPT_CHARS.toLocaleString()}{" "}
              caracteres
            </span>
            {dirty && <span className="text-[var(--state-espera-fg)]">sin guardar</span>}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] pt-3">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="¿Qué cambiaste? (opcional)"
              className="app-input min-w-[200px] flex-1 text-sm"
            />
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty || tooLong || value.trim().length === 0}
              className="app-button"
            >
              {saving ? "Guardando…" : "Guardar prompt"}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-[var(--state-escalada-fg)]">{error}</p>}
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-text-dim)]">
            Cada guardado queda en el historial y se puede restaurar. Al prompt
            se le añaden automáticamente los datos del pedido del cliente
            (Shopify y Dropi) cuando existen — los ves completos en{" "}
            <strong>Probar</strong>.
          </p>
        </div>
      )}

      {tab === "probar" && (
        <PlaygroundPanel
          prompt={value}
          model={model}
          dirty={dirty}
          conversations={conversations}
        />
      )}

      {tab === "historial" && (
        <HistoryPanel
          currentPrompt={saved}
          onLoadIntoEditor={(p) => {
            onChange(p);
            setTab("editor");
          }}
          onRestored={(p) => {
            onChange(p);
            onSaved(p);
          }}
        />
      )}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-9 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition lg:min-h-0 ${
        active
          ? "bg-[var(--state-auto-bg)] text-[var(--state-auto-fg)]"
          : "text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Probar: corre el prompt del editor contra un mensaje de ejemplo
// ────────────────────────────────────────────────────────────────────────────

function PlaygroundPanel({
  prompt,
  model,
  dirty,
  conversations,
}: {
  prompt: string;
  model: string;
  dirty: boolean;
  conversations: ConversationOption[];
}) {
  const [message, setMessage] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEffective, setShowEffective] = useState(false);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/agent/prompt/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          model,
          message,
          conversationId: conversationId || null,
        }),
      });
      const data = (await r.json()) as PreviewResult | { error: unknown };
      if (!r.ok || "error" in data) {
        setError(
          typeof (data as { error?: unknown }).error === "string"
            ? ((data as { error: string }).error)
            : "El modelo no respondió. Revisa el modelo seleccionado.",
        );
        return;
      }
      setResult(data);
    } catch {
      setError("No se pudo contactar al agente.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3 p-4">
      <p className="text-xs text-[var(--color-text-dim)]">
        Escribe lo que diría un cliente y mira cómo respondería el agente con el
        prompt que tienes en el editor{dirty ? " (incluye tus cambios sin guardar)" : ""}.
        <strong className="text-[var(--color-text)]">
          {" "}
          No se envía nada por WhatsApp.
        </strong>
      </p>

      <div className="grid gap-3 md:grid-cols-[1fr_260px]">
        <div className="space-y-1">
          <label className="text-[11px] uppercase text-[var(--color-text-dim)]">
            Mensaje del cliente
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="¿Esa faja la tienen en talla L?"
            className="app-textarea w-full"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] uppercase text-[var(--color-text-dim)]">
            Contexto de una conversación
          </label>
          <select
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value)}
            className="app-select w-full"
          >
            <option value="">— sin historial —</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] leading-snug text-[var(--color-text-dim)]">
            Opcional: usa el historial y los pedidos de un cliente real.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--color-text-dim)]">
          Modelo: <code className="text-[var(--color-text)]">{model}</code>
        </span>
        <button
          type="button"
          onClick={run}
          disabled={running || message.trim().length === 0}
          className="app-button gap-2"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {running ? "Probando…" : "Probar respuesta"}
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-[color-mix(in_srgb,var(--state-escalada-fg)_35%,transparent)] bg-[var(--state-escalada-bg)] px-3 py-2 text-xs text-[var(--state-escalada-fg)]">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <p className="mb-2 text-[11px] uppercase text-[var(--color-text-dim)]">
              Respuesta del agente
            </p>
            <div className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-[var(--state-auto-bg)] px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-[var(--color-text)]">
              {result.reply || "(respuesta vacía)"}
            </div>
            {result.usedConversation && (
              <p className="mt-2 text-[11px] text-[var(--color-text-dim)]">
                Se usaron {result.history.length} mensajes previos de esa
                conversación.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowEffective((s) => !s)}
            className="app-button-secondary text-xs"
          >
            {showEffective ? "Ocultar" : "Ver"} prompt efectivo
          </button>
          {showEffective && (
            <pre className="max-h-72 overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--color-text-dim)]">
              {result.effectiveSystemPrompt}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Historial: versiones guardadas, con restauración
// ────────────────────────────────────────────────────────────────────────────

function HistoryPanel({
  currentPrompt,
  onLoadIntoEditor,
  onRestored,
}: {
  currentPrompt: string;
  onLoadIntoEditor: (prompt: string) => void;
  onRestored: (prompt: string) => void;
}) {
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openText, setOpenText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/agent/prompt/versions");
      if (!r.ok) {
        setError("No se pudo cargar el historial.");
        return;
      }
      setVersions((await r.json()) as VersionSummary[]);
    } catch {
      setError("No se pudo cargar el historial.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openVersion = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setBusyId(id);
    try {
      const r = await fetch(`/api/agent/prompt/versions/${id}`);
      if (!r.ok) return;
      const data = (await r.json()) as { prompt: string };
      setOpenText(data.prompt);
      setOpenId(id);
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (id: string) => {
    if (
      !confirm(
        "¿Restaurar esta versión? El prompt actual queda guardado en el historial y el agente empezará a usar el restaurado.",
      )
    ) {
      return;
    }
    setBusyId(id);
    try {
      const r = await fetch(`/api/agent/prompt/versions/${id}/restore`, {
        method: "POST",
      });
      if (!r.ok) {
        setError("No se pudo restaurar.");
        return;
      }
      const data = (await r.json()) as { prompt: string };
      onRestored(data.prompt);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (error) {
    return <p className="p-4 text-xs text-[var(--state-escalada-fg)]">{error}</p>;
  }

  if (!versions) {
    return (
      <p className="p-4 text-xs text-[var(--color-text-dim)]">Cargando…</p>
    );
  }

  if (versions.length === 0) {
    return (
      <p className="p-4 text-xs text-[var(--color-text-dim)]">
        Todavía no hay versiones guardadas. La primera se crea al guardar el
        prompt.
      </p>
    );
  }

  return (
    <div className="divide-y divide-[var(--color-border)]">
      {versions.map((v) => {
        const isCurrent = v.length === currentPrompt.length && v.preview === currentPrompt.slice(0, 240);
        return (
          <div key={v.id} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                  {formatDate(v.createdAt)}
                  {isCurrent && (
                    <span className="rounded-full border border-[color-mix(in_srgb,var(--state-auto-fg)_35%,transparent)] bg-[var(--state-auto-bg)] px-2 py-0.5 text-[10px] text-[var(--state-auto-fg)]">
                      en uso
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--color-text-dim)]">
                  {v.label ?? "sin nota"}
                  {v.authorEmail ? ` · ${v.authorEmail}` : ""} ·{" "}
                  {v.length.toLocaleString()} caracteres
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => openVersion(v.id)}
                  disabled={busyId === v.id}
                  className="app-button-secondary text-xs"
                >
                  {openId === v.id ? "Ocultar" : "Ver"}
                </button>
                <button
                  type="button"
                  onClick={() => restore(v.id)}
                  disabled={busyId === v.id || isCurrent}
                  className="app-button gap-1.5 text-xs"
                  title={
                    isCurrent ? "Esta versión ya está en uso" : "Restaurar"
                  }
                >
                  <RotateCcw className="h-3 w-3" />
                  Restaurar
                </button>
              </div>
            </div>

            {openId === v.id ? (
              <>
                <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--color-text-dim)]">
                  {openText}
                </pre>
                <button
                  type="button"
                  onClick={() => onLoadIntoEditor(openText)}
                  className="app-button-secondary mt-2 text-xs"
                >
                  Cargar en el editor
                </button>
              </>
            ) : (
              <p className="mt-1 truncate text-[11px] text-[var(--color-text-dim)]">
                {v.preview}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
