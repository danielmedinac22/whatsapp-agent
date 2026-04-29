import { revalidatePath } from "next/cache";
import { db, templates, eq } from "@/lib/db";
import { listTemplates } from "@/lib/queries";
import { auth } from "@/auth";
import { TemplateEditor } from "./template-editor";

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

async function updateTemplate(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!id || !name || !body) return;
  await db
    .update(templates)
    .set({
      name,
      body,
      variables: extractVariables(body),
      updatedAt: new Date(),
    })
    .where(eq(templates.id, id));
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
          Usa los chips para insertar variables en el cuerpo. La vista previa muestra cómo verá el mensaje el cliente.
        </p>
      </header>

      <TemplateEditor
        templates={list.map((t) => ({
          id: t.id,
          name: t.name,
          body: t.body,
          variables: t.variables,
        }))}
        createAction={createTemplate}
        updateAction={updateTemplate}
        deleteAction={deleteTemplate}
      />
    </div>
  );
}
