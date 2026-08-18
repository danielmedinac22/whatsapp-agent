import { revalidatePath } from "next/cache";
import { db, templates, and, eq } from "@/lib/db";
import { listTemplates } from "@/lib/queries";
import { resolvePanelOperation } from "@/lib/operation";
import { auth } from "@/auth";
import { templateTypeValues, type TemplateType } from "@wa/shared";
import { TemplateEditor } from "./template-editor";

export const dynamic = "force-dynamic";

function extractVariables(body: string): string[] {
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) set.add(m[1]!);
  return [...set];
}

function parseType(input: string): TemplateType {
  return (templateTypeValues as readonly string[]).includes(input)
    ? (input as TemplateType)
    : "general";
}

async function createTemplate(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session) return;
  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const type = parseType(String(formData.get("type") ?? "general"));
  if (!name || !body) return;
  // La plantilla nace de la operación sobre la que se está trabajando. El
  // conflicto es contra (operación, nombre) desde la `0024`: dos operaciones
  // pueden tener su propia plantilla con el mismo nombre, y hasta ahora la
  // segunda se perdía en silencio contra el único del nombre a secas.
  const op = await resolvePanelOperation();
  await db
    .insert(templates)
    .values({
      operationId: op.id,
      name,
      body,
      variables: extractVariables(body),
      type,
      createdBy: session.user.id,
    })
    .onConflictDoNothing({ target: [templates.operationId, templates.name] });
  revalidatePath("/templates");
}

async function updateTemplate(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const type = parseType(String(formData.get("type") ?? "general"));
  if (!id || !name || !body) return;
  // Editar y borrar son escrituras por id, igual que las del Inbox: el id llega
  // del formulario y la pertenencia se verifica dentro del `where`.
  const op = await resolvePanelOperation();
  await db
    .update(templates)
    .set({
      name,
      body,
      variables: extractVariables(body),
      type,
      updatedAt: new Date(),
    })
    .where(and(eq(templates.id, id), eq(templates.operationId, op.id)));
  revalidatePath("/templates");
}

async function deleteTemplate(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  const op = await resolvePanelOperation();
  await db
    .delete(templates)
    .where(and(eq(templates.id, id), eq(templates.operationId, op.id)));
  revalidatePath("/templates");
}

export default async function TemplatesPage() {
  const list = await listTemplates(await resolvePanelOperation());

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
          type: t.type,
        }))}
        createAction={createTemplate}
        updateAction={updateTemplate}
        deleteAction={deleteTemplate}
      />
    </div>
  );
}
