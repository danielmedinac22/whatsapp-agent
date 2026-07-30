"use client";

import { useRef, useState, useTransition } from "react";
import {
  TEMPLATE_VARIABLES,
  TEMPLATE_VARIABLE_EXAMPLES,
  templateTypeValues,
  type TemplateType,
} from "@wa/shared";

type TemplateRow = {
  id: string;
  name: string;
  body: string;
  variables: string[];
  type: TemplateType;
};

const TYPE_LABELS: Record<TemplateType, string> = {
  general: "General",
  followup: "Follow-up Shopify",
  remarketing: "Remarketing",
  confirmation_ack: "Acuse de confirmación",
  dropi_guia_generada: "Dropi · guía generada",
  dropi_recolectado: "Dropi · recolectado",
  dropi_en_transito: "Dropi · en tránsito",
  dropi_con_mensajero: "Dropi · con mensajero",
  dropi_entregado: "Dropi · entregado",
  dropi_en_oficina: "Dropi · en oficina",
};

type Props = {
  templates: TemplateRow[];
  createAction: (formData: FormData) => Promise<void>;
  updateAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
};

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

type PreviewToken =
  | { kind: "text"; text: string }
  | { kind: "known"; key: string; example: string }
  | { kind: "unknown"; key: string };

function tokenizeBody(body: string): PreviewToken[] {
  const tokens: PreviewToken[] = [];
  let lastIndex = 0;
  const re = new RegExp(VAR_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ kind: "text", text: body.slice(lastIndex, m.index) });
    }
    const key = m[1]!;
    const example = TEMPLATE_VARIABLE_EXAMPLES[key];
    if (example !== undefined) {
      tokens.push({ kind: "known", key, example });
    } else {
      tokens.push({ kind: "unknown", key });
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < body.length) {
    tokens.push({ kind: "text", text: body.slice(lastIndex) });
  }
  return tokens;
}

export function TemplateEditor({
  templates,
  createAction,
  updateAction,
  deleteAction,
}: Props) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<TemplateType>("general");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const isEditing = editingId !== null;

  function reset() {
    setEditingId(null);
    setName("");
    setBody("");
    setType("general");
  }

  function startEditing(t: TemplateRow) {
    setEditingId(t.id);
    setName(t.name);
    setBody(t.body);
    setType(t.type);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function insertVariable(key: string) {
    const ta = textareaRef.current;
    const placeholder = `{{${key}}}`;
    if (!ta) {
      setBody((prev) => prev + placeholder);
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const next = body.slice(0, start) + placeholder + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      const caret = start + placeholder.length;
      ta.setSelectionRange(caret, caret);
    });
  }

  function handleSubmit(formData: FormData) {
    if (isEditing) formData.set("id", editingId!);
    formData.set("name", name);
    formData.set("body", body);
    formData.set("type", type);
    startTransition(async () => {
      if (isEditing) await updateAction(formData);
      else await createAction(formData);
      reset();
    });
  }

  const tokens = tokenizeBody(body);
  const unknownVars = Array.from(
    new Set(
      tokens
        .filter((t): t is Extract<PreviewToken, { kind: "unknown" }> => t.kind === "unknown")
        .map((t) => t.key),
    ),
  );

  return (
    <div className="space-y-3">
      <form action={handleSubmit} className="app-card space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            {isEditing ? `Editando: ${name || "—"}` : "Nueva plantilla"}
          </h2>
          {isEditing && (
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-dim)] transition hover:bg-[rgba(255,255,255,0.04)]"
            >
              Cancelar
            </button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs uppercase text-[var(--color-text-soft)]">
              Nombre
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="app-input mt-2"
              placeholder="confirmacion_pedido"
            />
          </div>
          <div>
            <label className="text-xs uppercase text-[var(--color-text-soft)]">
              Tipo
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TemplateType)}
              className="app-select mt-2"
            >
              {templateTypeValues.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs uppercase text-[var(--color-text-soft)]">
            Variables disponibles
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => insertVariable(v.key)}
                title={`${v.description} · ej: ${v.example}`}
                className="group inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[rgba(110,231,183,0.06)] px-2.5 py-1 text-xs text-[var(--color-text)] transition hover:border-[var(--color-accent)] hover:bg-[rgba(110,231,183,0.14)]"
              >
                <span className="text-[var(--color-accent)]">+</span>
                <span className="font-medium">{v.label}</span>
                <span className="text-[var(--color-text-soft)]">
                  {`{{${v.key}}}`}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-soft)]">
            Haz click en una variable para insertarla en la posición del cursor.
          </p>
        </div>

        <div>
          <label className="text-xs uppercase text-[var(--color-text-soft)]">
            Cuerpo
          </label>
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={6}
            className="app-textarea mt-2"
            placeholder="Hola {{nombre}}, ¿confirmas tu pedido?"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase text-[var(--color-text-soft)]">
              Vista previa
            </span>
            {unknownVars.length > 0 && (
              <span className="text-xs text-[var(--color-danger)]">
                Variables no reconocidas: {unknownVars.join(", ")}
              </span>
            )}
          </div>
          <div
            className="mt-2 rounded-2xl border border-[var(--color-border)] p-3 text-sm leading-relaxed whitespace-pre-wrap"
            style={{ background: "var(--color-bubble-out)" }}
          >
            {body.length === 0 ? (
              <span className="text-[var(--color-text-soft)]">
                Escribe el cuerpo para ver la vista previa…
              </span>
            ) : (
              tokens.map((tok, i) => {
                if (tok.kind === "text") return <span key={i}>{tok.text}</span>;
                if (tok.kind === "known") {
                  return (
                    <span
                      key={i}
                      title={`{{${tok.key}}}`}
                      className="rounded px-1 text-[var(--color-accent)]"
                      style={{ background: "rgba(110,231,183,0.12)" }}
                    >
                      {tok.example}
                    </span>
                  );
                }
                return (
                  <span
                    key={i}
                    title="Variable no reconocida"
                    className="rounded px-1 text-[var(--color-danger)]"
                    style={{ background: "rgba(248,113,113,0.12)" }}
                  >
                    {`{{${tok.key}}}`}
                  </span>
                );
              })
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="submit"
            disabled={pending || !name.trim() || !body.trim()}
            className="app-button disabled:opacity-50"
          >
            {pending
              ? "Guardando…"
              : isEditing
                ? "Guardar cambios"
                : "Crear plantilla"}
          </button>
        </div>
      </form>

      <div className="space-y-3">
        {templates.length === 0 && (
          <p className="app-card p-4 text-sm text-[var(--color-text-dim)]">
            Aún no hay plantillas.
          </p>
        )}
        {templates.map((t) => (
          <div key={t.id} className="app-card space-y-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{t.name}</p>
                  <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-text-soft)]">
                    {TYPE_LABELS[t.type]}
                  </span>
                </div>
                {t.variables.length > 0 && (
                  <p className="mt-1 text-xs text-[var(--color-text-dim)]">
                    variables: {t.variables.join(", ")}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => startEditing(t)}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-dim)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-text)]"
                >
                  Editar
                </button>
                <form action={deleteAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-red-500/20 px-2 py-1 text-xs text-red-200 transition hover:bg-red-950/30"
                  >
                    Eliminar
                  </button>
                </form>
              </div>
            </div>
            <pre className="whitespace-pre-wrap rounded-lg border border-[var(--color-border)] bg-[rgba(8,21,30,0.82)] p-3 text-sm">
              {t.body}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
