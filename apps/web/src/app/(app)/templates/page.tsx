import { revalidatePath } from "next/cache";
import { db, templates, eq } from "@/lib/db";
import { listTemplates } from "@/lib/queries";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

function extractVariables(body: string): string[] {
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) set.add(m[1]!);
  return [...set];
}

async function createTemplate(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session) return;
  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!name || !body) return;
  await db
    .insert(templates)
    .values({
      name,
      body,
      variables: extractVariables(body),
      createdBy: session.user.id,
    })
    .onConflictDoNothing({ target: templates.name });
  revalidatePath("/templates");
}

async function deleteTemplate(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  await db.delete(templates).where(eq(templates.id, id));
  revalidatePath("/templates");
}

export default async function TemplatesPage() {
  const list = await listTemplates();

  return (
    <div className="app-page max-w-5xl space-y-3">
      <header className="max-w-3xl">
        <h1 className="app-title">Plantillas</h1>
        <p className="app-subtitle app-muted mt-1">
          Usa <code>{"{{variable}}"}</code> para insertar valores en el cuerpo.
        </p>
      </header>

      <form
        action={createTemplate}
        className="app-card space-y-3 p-4"
      >
        <div>
          <label className="text-xs uppercase text-[var(--color-text-soft)]">
            Nombre
          </label>
          <input
            name="name"
            required
            className="app-input mt-2"
            placeholder="confirmacion_pedido"
          />
        </div>
        <div>
          <label className="text-xs uppercase text-[var(--color-text-soft)]">
            Cuerpo
          </label>
          <textarea
            name="body"
            required
            rows={4}
            className="app-textarea mt-2"
            placeholder="Hola {{nombre}}, ¿confirmas tu pedido?"
          />
        </div>
        <div className="flex justify-end">
          <button type="submit" className="app-button">
            Crear plantilla
          </button>
        </div>
      </form>

      <div className="space-y-3">
        {list.length === 0 && (
          <p className="app-card p-4 text-sm text-[var(--color-text-dim)]">
            Aún no hay plantillas.
          </p>
        )}
        {list.map((t) => (
          <div key={t.id} className="app-card space-y-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{t.name}</p>
                {t.variables.length > 0 && (
                  <p className="mt-1 text-xs text-[var(--color-text-dim)]">
                    variables: {t.variables.join(", ")}
                  </p>
                )}
              </div>
              <form action={deleteTemplate}>
                <input type="hidden" name="id" value={t.id} />
                <button
                  type="submit"
                  className="rounded-md border border-red-500/20 px-2 py-1 text-xs text-red-200 transition hover:bg-red-950/30"
                >
                  Eliminar
                </button>
              </form>
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
