/**
 * Vorare's Meta WhatsApp template catalog (source of truth in code, waichat
 * pattern). Meta doesn't allow editing an approved template, so changes ship
 * as a new `_v2` name and a one-constant swap of the ACTIVE_* export; old
 * versions stay registered so historical sends keep rendering.
 *
 * Rules: POSITIONAL params ({{1}}, {{2}}, …), `example.body_text` required
 * when the body has variables, param VALUES must be single-line (no \n/tabs).
 */

export interface WaTemplateDefinition {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  bodyText: string;
  bodyExample: string[];
  /** QUICK_REPLY button labels, in order. */
  buttons: string[];
}

// --- Customer-facing ---------------------------------------------------------

const CONFIRMACION_PEDIDO_V1: WaTemplateDefinition = {
  name: "vorare_confirmacion_pedido_v1",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{1}} 👋 ¡Gracias por tu compra!\n\nRecibimos tu pedido {{2}} por {{3}}.\n\n¿Nos confirmas que tus datos de entrega son correctos para despacharlo?",
  bodyExample: ["Ana", "#1234", "$120.000"],
  // Meta rejects emoji in QUICK_REPLY button text ("Invalid parameter").
  buttons: ["Confirmar pedido", "Tengo una duda"],
};

const RECORDATORIO_PEDIDO_V1: WaTemplateDefinition = {
  name: "vorare_recordatorio_pedido_v1",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{1}}, aún tenemos pendiente la confirmación de tu pedido {{2}} 📦\n\n¿Quieres que lo despachemos? Respóndenos por aquí y lo dejamos listo.",
  bodyExample: ["Ana", "#1234"],
  buttons: ["Confirmar pedido", "Cancelar pedido"],
};

const GUIA_GENERADA_V1: WaTemplateDefinition = {
  name: "vorare_guia_generada_v1",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{1}} 👋\n\nTu pedido fue confirmado. Aquí los detalles de envío:\n\n📦 Guía: {{2}}\n🚚 Transportadora: {{3}}\n📎 PDF: {{4}}\n\nPronto te avisaremos cuando salga a entrega.",
  bodyExample: [
    "Ana",
    "240012345678",
    "Interrapidísimo",
    "https://ejemplo.com/guia.pdf",
  ],
  buttons: [],
};

// Meta no permite que el body termine en variable (el "." final no cuenta) —
// por eso estas plantillas cierran con texto después del último parámetro.
const RECOLECTADO_V1: WaTemplateDefinition = {
  name: "vorare_recolectado_v1",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{1}}, tu pedido acaba de ser recolectado por {{2}}. Guía: {{3}} — pronto estará en camino.",
  bodyExample: ["Ana", "Interrapidísimo", "240012345678"],
  buttons: [],
};

const EN_TRANSITO_V1: WaTemplateDefinition = {
  name: "vorare_en_transito_v1",
  language: "es",
  category: "UTILITY",
  bodyText: "Hola {{1}}, tu pedido está en tránsito. Guía: {{2}} ({{3}}).",
  bodyExample: ["Ana", "240012345678", "Interrapidísimo"],
  buttons: [],
};

const CON_MENSAJERO_V1: WaTemplateDefinition = {
  name: "vorare_con_mensajero_v1",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{1}}, ¡tu pedido ya está con el mensajero! Pronto lo recibirás. Guía: {{2}} por si necesitas consultarla.",
  bodyExample: ["Ana", "240012345678"],
  buttons: [],
};

const ENTREGADO_V1: WaTemplateDefinition = {
  name: "vorare_entregado_v1",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{1}}, muchísimas gracias por tu compra 🙌\n\nTu pedido ya fue entregado. ¡Esperamos verte de nuevo pronto!",
  bodyExample: ["Ana"],
  buttons: [],
};

const NOVEDAD_V1: WaTemplateDefinition = {
  name: "vorare_novedad_v1",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{1}}, tu pedido con guía {{2}} tiene una novedad en la entrega:\n\n⚠️ {{3}}\n\n¿Nos ayudas respondiendo este mensaje para solucionarla y que tu pedido llegue pronto? 🙏",
  bodyExample: ["Ana", "240012345678", "Dirección incompleta"],
  buttons: [],
};

// --- Admin-facing (notifications to the operator's own WhatsApp) -------------

const ADMIN_ALERTA_V1: WaTemplateDefinition = {
  name: "vorare_admin_alerta_v1",
  language: "es",
  category: "UTILITY",
  bodyText:
    "🚨 Escalación a humano\n\nCliente: {{1}}\nMotivo: {{2}}\nTeléfono: +{{3}}\n\nEl agente quedó apagado para esta conversación. Responde desde el inbox.",
  bodyExample: ["Ana Pérez", "el cliente envió un audio", "573001234567"],
  buttons: [],
};

const ADMIN_AVISO_V1: WaTemplateDefinition = {
  name: "vorare_admin_aviso_v1",
  language: "es",
  category: "UTILITY",
  bodyText:
    "🔔 Aviso del agente Vorare: {{1}}\n\nRevisa el inbox para ver el detalle.",
  bodyExample: ["hay novedades de Dropi pendientes por revisar"],
  buttons: [],
};

// NOTA: no hay plantilla dedicada para el 2FA de Dropi — Meta auto-rechaza
// UTILITY con lenguaje de códigos/OTP (vorare_admin_codigo_v1 quedó REJECTED
// en el WABA). El fallback usa ADMIN_AVISO; el parámetro sí puede mencionar el
// código porque Meta solo revisa el texto estático de la plantilla.

// --- Catalog + active pointers ----------------------------------------------

export const VORARE_TEMPLATES: WaTemplateDefinition[] = [
  CONFIRMACION_PEDIDO_V1,
  RECORDATORIO_PEDIDO_V1,
  GUIA_GENERADA_V1,
  RECOLECTADO_V1,
  EN_TRANSITO_V1,
  CON_MENSAJERO_V1,
  ENTREGADO_V1,
  NOVEDAD_V1,
  ADMIN_ALERTA_V1,
  ADMIN_AVISO_V1,
];

// Swap these constants to roll a new version (the old one stays registered).
export const CONFIRMACION_PEDIDO_TEMPLATE: string = CONFIRMACION_PEDIDO_V1.name;
export const RECORDATORIO_PEDIDO_TEMPLATE: string = RECORDATORIO_PEDIDO_V1.name;
export const GUIA_GENERADA_TEMPLATE: string = GUIA_GENERADA_V1.name;
export const RECOLECTADO_TEMPLATE: string = RECOLECTADO_V1.name;
export const EN_TRANSITO_TEMPLATE: string = EN_TRANSITO_V1.name;
export const CON_MENSAJERO_TEMPLATE: string = CON_MENSAJERO_V1.name;
export const ENTREGADO_TEMPLATE: string = ENTREGADO_V1.name;
export const NOVEDAD_TEMPLATE: string = NOVEDAD_V1.name;
export const ADMIN_ALERTA_TEMPLATE: string = ADMIN_ALERTA_V1.name;
export const ADMIN_AVISO_TEMPLATE: string = ADMIN_AVISO_V1.name;

export function templateByName(name: string): WaTemplateDefinition | null {
  return VORARE_TEMPLATES.find((t) => t.name === name) ?? null;
}

/**
 * Meta template params must be single-line and reasonably short; collapse
 * whitespace so LLM-generated or user data can't break a send.
 */
export function sanitizeParam(value: string, maxLen = 200): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/**
 * Render the template body locally by filling {{n}} placeholders — the exact
 * text the customer reads, stored in `messages` so the inbox history never
 * diverges from what Meta approved.
 */
export function renderTemplateBody(name: string, params: string[]): string {
  const def = templateByName(name);
  if (!def) return params.join(" ");
  return def.bodyText.replace(/\{\{(\d+)\}\}/g, (_, i) => {
    return params[Number(i) - 1] ?? `{{${i}}}`;
  });
}

/** The Meta creation payload for a catalog definition. */
export function toMetaDefinition(
  def: WaTemplateDefinition,
): Record<string, unknown> {
  const components: Record<string, unknown>[] = [
    {
      type: "BODY",
      text: def.bodyText,
      ...(def.bodyExample.length > 0
        ? { example: { body_text: [def.bodyExample] } }
        : {}),
    },
  ];
  if (def.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: def.buttons.map((text) => ({ type: "QUICK_REPLY", text })),
    });
  }
  return {
    name: def.name,
    language: def.language,
    category: def.category,
    parameter_format: "POSITIONAL",
    components,
  };
}
