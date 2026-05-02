import { and, eq, isNull } from "@wa/db";
import { agentSettings, templates } from "@wa/db";
import type { TemplateType } from "@wa/shared";
import { db } from "../db";
import { logger } from "../lib/logger";

type DropiSettingsField =
  | "dropiTemplateGuiaId"
  | "dropiTemplateRecolectadoId"
  | "dropiTemplateEnTransitoId"
  | "dropiTemplateConMensajeroId"
  | "dropiTemplateEntregadoId";

interface DefaultTemplate {
  name: string;
  type: TemplateType;
  body: string;
  agentSettingsField: DropiSettingsField;
}

const DEFAULTS: DefaultTemplate[] = [
  {
    name: "dropi_guia_generada",
    type: "dropi_guia_generada",
    agentSettingsField: "dropiTemplateGuiaId",
    body: "Hola {{nombre}} 👋\n\nTu pedido fue confirmado. Aquí los detalles de envío:\n\n📦 Guía: {{guia}}\n🚚 Transportadora: {{transportadora}}\n📎 PDF: {{pdf_guia}}\n\nPronto te avisaremos cuando salga a entrega.",
  },
  {
    name: "dropi_recolectado",
    type: "dropi_recolectado",
    agentSettingsField: "dropiTemplateRecolectadoId",
    body: "Hola {{nombre}}, tu pedido acaba de ser recolectado por {{transportadora}}. Guía: {{guia}}.",
  },
  {
    name: "dropi_en_transito",
    type: "dropi_en_transito",
    agentSettingsField: "dropiTemplateEnTransitoId",
    body: "Hola {{nombre}}, tu pedido está en tránsito. Guía: {{guia}} ({{transportadora}}).",
  },
  {
    name: "dropi_con_mensajero",
    type: "dropi_con_mensajero",
    agentSettingsField: "dropiTemplateConMensajeroId",
    body: "Hola {{nombre}}, ¡tu pedido ya está con el mensajero! Pronto lo recibirás. Guía: {{guia}}.",
  },
  {
    name: "dropi_entregado",
    type: "dropi_entregado",
    agentSettingsField: "dropiTemplateEntregadoId",
    body: "Hola {{nombre}}, muchísimas gracias por tu compra 🙌. Tu pedido ya fue entregado. ¡Esperamos verte de nuevo pronto!",
  },
];

function extractVars(body: string): string[] {
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) set.add(m[1]!);
  return [...set];
}

export async function ensureDropiTemplates(): Promise<{
  inserted: number;
  assigned: number;
}> {
  let inserted = 0;
  let assigned = 0;
  for (const t of DEFAULTS) {
    const [ins] = await db
      .insert(templates)
      .values({
        name: t.name,
        body: t.body,
        type: t.type,
        variables: extractVars(t.body),
      })
      .onConflictDoNothing({ target: templates.name })
      .returning({ id: templates.id });

    let templateId = ins?.id;
    if (ins) inserted++;
    if (!templateId) {
      const [existing] = await db
        .select({ id: templates.id })
        .from(templates)
        .where(eq(templates.name, t.name))
        .limit(1);
      templateId = existing?.id;
    }
    if (!templateId) continue;

    // Auto-assign only when the corresponding agent_settings field is null
    // (don't override an operator's manual choice).
    const col = agentSettings[t.agentSettingsField];
    const res = await db
      .update(agentSettings)
      .set({ [t.agentSettingsField]: templateId, updatedAt: new Date() })
      .where(and(eq(agentSettings.id, 1), isNull(col)));
    // pg-postgres doesn't return rowCount uniformly; treat any update as a
    // best-effort assignment.
    void res;
    assigned++;
  }
  logger.info(
    { inserted, candidates: DEFAULTS.length },
    "dropi templates ensured",
  );
  return { inserted, assigned };
}
