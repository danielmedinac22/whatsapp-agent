import { and, eq, isNull } from "@wa/db";
import {
  agentSettings,
  getAgentSettings,
  templates,
  type Operation,
} from "@wa/db";
import type { TemplateType } from "@wa/shared";
import { db } from "../db";
import { logger } from "../lib/logger";

type DropiSettingsField =
  | "dropiTemplateGuiaId"
  | "dropiTemplateRecolectadoId"
  | "dropiTemplateEnTransitoId"
  | "dropiTemplateConMensajeroId"
  | "dropiTemplateEntregadoId"
  | "dropiTemplateEnOficinaId";

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
  {
    name: "dropi_en_oficina",
    type: "dropi_en_oficina",
    agentSettingsField: "dropiTemplateEnOficinaId",
    body: "Hola {{nombre}}, tu pedido con guía {{guia}} quedó en la oficina de {{transportadora}} en {{ciudad}} y te espera ahí para que lo reclames. Responde este mensaje si necesitas la dirección exacta o si prefieres que intentemos entregarlo de nuevo.",
  },
];

function extractVars(body: string): string[] {
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) set.add(m[1]!);
  return [...set];
}

/**
 * Crea las plantillas de logística que falten y las asigna a la configuración
 * **de una sola operación**.
 *
 * Las seis FK a `templates` son por operación: cada operación elige qué
 * plantilla usa para «guía generada» y para «entregado». El seed asigna las
 * suyas y no toca las de las demás — una plantilla guatemalteca en la fila
 * colombiana es la fuga que este spec existe para impedir. Por eso la operación
 * es un parámetro obligatorio y no un `id = 1` implícito.
 */
export async function ensureDropiTemplates(op: Operation): Promise<{
  inserted: number;
  assigned: number;
}> {
  const settings = await getAgentSettings(op);
  let inserted = 0;
  let assigned = 0;
  for (const t of DEFAULTS) {
    // La plantilla es de la operación desde la `0024`: el único pasó a ser
    // (operación, nombre), así que la colombiana ya no choca con la
    // guatemalteca del mismo nombre — antes se quedaba sin plantilla.
    const [ins] = await db
      .insert(templates)
      .values({
        operationId: op.id,
        name: t.name,
        body: t.body,
        type: t.type,
        variables: extractVars(t.body),
      })
      .onConflictDoNothing({ target: [templates.operationId, templates.name] })
      .returning({ id: templates.id });

    let templateId = ins?.id;
    if (ins) inserted++;
    if (!templateId) {
      const [existing] = await db
        .select({ id: templates.id })
        .from(templates)
        .where(
          and(eq(templates.operationId, op.id), eq(templates.name, t.name)),
        )
        .limit(1);
      templateId = existing?.id;
    }
    if (!templateId) continue;

    // Auto-assign only when the corresponding agent_settings field is null
    // (don't override an operator's manual choice), y solo sobre la fila del
    // ámbito pedido: sin fila no hay a quién asignarle nada.
    if (!settings) continue;
    const col = agentSettings[t.agentSettingsField];
    const res = await db
      .update(agentSettings)
      .set({ [t.agentSettingsField]: templateId, updatedAt: new Date() })
      .where(and(eq(agentSettings.id, settings.id), isNull(col)));
    // pg-postgres doesn't return rowCount uniformly; treat any update as a
    // best-effort assignment.
    void res;
    assigned++;
  }
  logger.info(
    { inserted, assigned, candidates: DEFAULTS.length },
    "dropi templates ensured",
  );
  return { inserted, assigned };
}
