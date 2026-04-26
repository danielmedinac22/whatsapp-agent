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
    <div className="mx-auto w-full max-w-3xl space-y-8 p-6">
      <header>
        <h1 className="text-xl font-semibold">Plantillas</h1>
        <p className="text-sm text-[var(--color-text-dim)]">
          Usa <code>{"{{variable}}"}</code> para insertar valores en el cuerpo.
        </p>
      </header>

      <form
        action={createTemplate}
        className="space-y-3 rounded bg-[var(--color-panel)] p-4 border"
      >
        <div>
          <label className="text-xs text-[var(--color-text-dim)]">Nombre</label>
          <input
            name="name"
            required
            className="mt-1 w-full rounded bg-[var(--color-panel-2)] px-3 py-2 outline-none"
            placeholder="confirmacion_pedido"
          />
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-dim)]">Cuerpo</label>
          <textarea
            name="body"
            required
            rows={4}
            className="mt-1 w-full rounded bg-[var(--color-panel-2)] px-3 py-2 outline-none"
            placeholder="Hola {{nombre}}, ¿confirmas tu pedido?"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
          >
            Crear plantilla
          </button>
        </div>
      </form>

      <div className="space-y-3">
        {list.length === 0 && (
          <p className="text-sm text-[var(--color-text-dim)]">Aún no hay plantillas.</p>
        )}
        {list.map((t) => (
          <div
            key={t.id}
            className="rounded bg-[var(--color-panel)] p-4 border space-y-2"
          >
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
                  className="text-xs text-red-300 hover:underline"
                >
                  Eliminar
                </button>
              </form>
            </div>
            <pre className="whitespace-pre-wrap rounded bg-[var(--color-panel-2)] p-3 text-sm">
              {t.body}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
