/**
 * Vorare's Meta WhatsApp template catalog — the single source of truth, shared
 * by the worker (submission/sending) and the web app (reopen flow, previews).
 * Copys según el documento de feedback "plantillas_meta_waichat_vorare.md"
 * (parámetros con nombre + footer "Tienda Vorare" + categorías por costo).
 *
 * Meta doesn't allow editing an approved template, so changes ship as a new
 * name/version and a one-constant swap of the ACTIVE_* export.
 *
 * Reglas aprendidas empíricamente contra la API de Meta (vía Kapso):
 * - NAMED params: minúsculas + guion bajo; cada una con ejemplo.
 * - El body no puede empezar NI terminar en una variable (el "." final no
 *   cuenta como texto — rechaza con "Invalid parameter").
 * - Sin emoji en el texto de los botones QUICK_REPLY (mismo rechazo).
 * - Los VALORES de los parámetros van en una sola línea (sin \n/tabs).
 */

export interface WaTemplateParam {
  /** lowercase_snake_case — Meta lo exige para named params. */
  name: string;
  /** Valor de ejemplo, obligatorio para la aprobación. */
  example: string;
}

export interface WaTemplateDefinition {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  /** Body con placeholders {{nombre_de_variable}}. */
  bodyText: string;
  /** Parámetros EN ORDEN — el orden define el array de valores al enviar. */
  params: WaTemplateParam[];
  /** QUICK_REPLY button labels, in order (sin emoji). */
  buttons: string[];
  footer: string | null;
}

const FOOTER = "Tienda Vorare";

// --- Flujo de confirmación (inicio del pedido) --------------------------------

const CONFIRMACION_DATOS_COD: WaTemplateDefinition = {
  name: "confirmacion_datos_cod",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{nombre}} 👋\nTe escribimos desde Tienda Vorare para confirmar que tu pedido de {{producto}} ya quedó reservado en nuestro sistema ✅\n\nPara enviarlo hoy mismo necesitamos validar estos datos:\n📍 Dirección: {{direccion}}\n🏙️ Ciudad / Barrio: {{ciudad}}\n📞 Contacto: {{telefono}}\n💵 Pago contra entrega: Q{{total}}\n\nConfírmanos que todo está correcto para despacharlo en ruta 🚚📦",
  params: [
    { name: "nombre", example: "María" },
    { name: "producto", example: "Colágeno Hidrolizado" },
    { name: "direccion", example: "Cra 45 #12-30, Apto 201" },
    { name: "ciudad", example: "Zona 10, Ciudad de Guatemala" },
    { name: "telefono", example: "5555 1234" },
    { name: "total", example: "295" },
  ],
  buttons: ["Confirmar pedido", "Corregir datos"],
  footer: FOOTER,
};

const RECUPERACION_PEDIDO_SIN_CONFIRMAR: WaTemplateDefinition = {
  name: "recuperacion_pedido_sin_confirmar",
  language: "es",
  // Borderline UTILITY: versión neutra sin lenguaje promocional para no caer
  // en MARKETING. Si Meta la reclasifica, se acepta (sobrecosto mínimo).
  category: "UTILITY",
  bodyText:
    "Hola {{nombre}} 👋\nRegistramos un pedido tuyo de {{producto}} en nuestra web que aún no ha sido confirmado.\nPara despacharlo necesitamos tu confirmación. ¿Deseas que procedamos con el envío?",
  params: [
    { name: "nombre", example: "María" },
    { name: "producto", example: "Colágeno Hidrolizado" },
  ],
  buttons: ["Sí, confírmalo", "Cancelar"],
  footer: FOOTER,
};

const PEDIDO_CONFIRMADO_PROGRAMADO: WaTemplateDefinition = {
  name: "pedido_confirmado_programado",
  language: "es",
  category: "UTILITY",
  bodyText:
    "¡Listo {{nombre}}! 🙌 Tu pedido de {{producto}} quedó confirmado y programado con éxito ✅\nSerá despachado lo antes posible a la transportadora 🚚📦\n\nMantente atento a llamadas y WhatsApp: se comunicarán contigo por esos medios para coordinar la entrega.\nCualquier duda, aquí estamos. ¡Gracias por tu compra! 💙",
  params: [
    { name: "nombre", example: "María" },
    { name: "producto", example: "Colágeno Hidrolizado" },
  ],
  buttons: [],
  footer: FOOTER,
};

// --- Flujo de tracking (estados de guía) --------------------------------------

// El doc cierra estos dos con "Guía: {{guia}}" a secas, pero Meta rechaza un
// body que termina en variable — se añade un cierre corto después de la guía.
const GUIA_RECOLECTADA: WaTemplateDefinition = {
  name: "guia_recolectada",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{nombre}} 📦 Tu pedido acaba de ser recolectado por {{transportadora}}.\nGuía: {{guia}} — te avisaremos en cada avance.",
  params: [
    { name: "nombre", example: "María" },
    { name: "transportadora", example: "Interrapidísimo" },
    { name: "guia", example: "240012345678" },
  ],
  buttons: [],
  footer: FOOTER,
};

const GUIA_EN_TRANSITO: WaTemplateDefinition = {
  name: "guia_en_transito",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{nombre}} 🚚 Tu pedido ya va viajando a tu ciudad de destino.\nGuía: {{guia}} ({{transportadora}})",
  params: [
    { name: "nombre", example: "María" },
    { name: "guia", example: "240012345678" },
    { name: "transportadora", example: "Interrapidísimo" },
  ],
  buttons: [],
  footer: FOOTER,
};

const GUIA_EN_REPARTO: WaTemplateDefinition = {
  name: "guia_en_reparto",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{nombre}} 🛵 ¡Tu pedido ya está con el mensajero! Pronto lo recibirás.\nGuía: {{guia}} por si necesitas consultarla.",
  params: [
    { name: "nombre", example: "María" },
    { name: "guia", example: "240012345678" },
  ],
  buttons: [],
  footer: FOOTER,
};

const GUIA_ENTREGADA: WaTemplateDefinition = {
  name: "guia_entregada",
  language: "es",
  // Meta la recategorizó a MARKETING ("esperamos verte de nuevo" = re-engagement).
  category: "MARKETING",
  bodyText:
    "Hola {{nombre}} 🙌 ¡Muchísimas gracias por tu compra! Tu pedido ya fue entregado.\nEsperamos verte de nuevo pronto 💙",
  params: [{ name: "nombre", example: "María" }],
  buttons: [],
  footer: FOOTER,
};

// v2: la v1 se estaba cobrando como MARKETING (~US$0,07/envío, ~US$20/mes) por
// tres señales — la invitación a volver, el agradecimiento como línea principal
// y cero datos de la transacción. Es la única del flujo de tracking sin
// {{guia}}, y es justo la única que Meta reclasificó.
// Esta versión es puramente transaccional (confirmación + identificadores +
// soporte post-entrega), que es lo que Meta lee como UTILITY — y una UTILITY
// dentro de la ventana de 24h abierta no se cobra.
// El "gracias / vuelve pronto" no se pierde: cualquiera de los dos botones
// reabre la ventana y se responde en texto libre, gratis. La recompra ya la
// cubre REMARKETING_RECOMPRA_MES, segmentada y al mes.
// Bonus COD: detecta paquetes marcados como entregados que el cliente nunca
// recibió, y "Recibí todo bien" deja constancia útil ante la transportadora.
const GUIA_ENTREGADA_V2: WaTemplateDefinition = {
  name: "guia_entregada_v2",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{nombre}} ✅ Tu pedido con guía {{guia}} figura como entregado por {{transportadora}}.\nSi no lo recibiste, llegó incompleto o presenta algún daño, responde este mensaje y lo revisamos hoy mismo 🙌",
  params: [
    { name: "nombre", example: "María" },
    { name: "guia", example: "240012345678" },
    { name: "transportadora", example: "Interrapidísimo" },
  ],
  buttons: ["Recibí todo bien", "Tengo un problema"],
  footer: FOOTER,
};

// El paquete quedó en la oficina de la transportadora. Dropi no dice CUÁL
// oficina (el movimiento solo trae nombre y fecha), así que el copy se queda en
// transportadora + ciudad e invita a responder: dos tercios de estos clientes
// esperaban entrega a domicilio, y su respuesta reabre la ventana de 24h para
// que el asesor o el agente resuelva el caso concreto.
const GUIA_EN_OFICINA: WaTemplateDefinition = {
  name: "guia_en_oficina",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{nombre}} 📦 Tu pedido con guía {{guia}} quedó en la oficina de {{transportadora}} en {{ciudad}} y te espera ahí para que lo reclames.\nLleva tu documento de identidad. Si necesitas la dirección exacta o prefieres que intentemos entregarlo de nuevo, responde este mensaje y lo coordinamos 🙌",
  params: [
    { name: "nombre", example: "María" },
    { name: "guia", example: "240012345678" },
    { name: "transportadora", example: "Forza" },
    { name: "ciudad", example: "Quetzaltenango" },
  ],
  buttons: ["Necesito la dirección", "Reintentar entrega"],
  footer: FOOTER,
};

const NOVEDAD_ENTREGA: WaTemplateDefinition = {
  name: "novedad_entrega",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{nombre}}, tu pedido con guía {{guia}} tiene una novedad en la entrega:\n⚠️ {{novedad}}\n¿Nos ayudas respondiendo este mensaje para solucionarla y que tu pedido llegue pronto? 🙏",
  params: [
    { name: "nombre", example: "María" },
    { name: "guia", example: "240012345678" },
    { name: "novedad", example: "Dirección incompleta" },
  ],
  buttons: ["Actualizar mis datos"],
  footer: FOOTER,
};

// Guía generada (con PDF) — no está en el doc pero el flujo Dropi la usa como
// primer aviso tras la confirmación; restyle con named params + footer.
const GUIA_GENERADA_V2: WaTemplateDefinition = {
  name: "vorare_guia_generada_v2",
  language: "es",
  category: "UTILITY",
  bodyText:
    "Hola {{nombre}} 👋\n\nTu pedido fue confirmado. Aquí los detalles de envío:\n\n📦 Guía: {{guia}}\n🚚 Transportadora: {{transportadora}}\n📎 PDF: {{pdf_guia}}\n\nPronto te avisaremos cuando salga a entrega.",
  params: [
    { name: "nombre", example: "María" },
    { name: "guia", example: "240012345678" },
    { name: "transportadora", example: "Interrapidísimo" },
    { name: "pdf_guia", example: "https://ejemplo.com/guia.pdf" },
  ],
  buttons: [],
  footer: FOOTER,
};

// --- Re-enganche y recompra ----------------------------------------------------

const REMARKETING_RECOMPRA_MES: WaTemplateDefinition = {
  name: "remarketing_recompra_mes",
  language: "es",
  // MARKETING: se cobra siempre (~25x utility) — enviar segmentada.
  category: "MARKETING",
  bodyText:
    "¡Hola {{nombre}}! 😊✨\nHace casi un mes te llevaste nuestro {{producto}} y no queríamos dejar pasar más tiempo sin saber de ti 💛\n\nCuéntanos… ¿cómo te ha ido? ¿Cómo te has sentido? ¿Notaste resultados? 🙌 Nos encanta saber cómo va tu proceso.\n\nY ojo 👀 si ya te está quedando poquito, este es el momento ideal para reponerlo y seguir completando tu tratamiento mes a mes 📆💪 La constancia es la que hace la magia ✨\n\n¿Te preparo tu nuevo pedido? Aquí estamos para ti 🫶",
  params: [
    { name: "nombre", example: "María" },
    { name: "producto", example: "Colágeno Hidrolizado" },
  ],
  buttons: ["Quiero recomprar", "Tengo una duda"],
  footer: FOOTER,
};

const REABRIR_V2: WaTemplateDefinition = {
  name: "vorare_reabrir_v2",
  language: "es",
  // Meta la recategorizó a MARKETING (reapertura = re-engagement).
  category: "MARKETING",
  bodyText:
    "Hola {{nombre}} 👋 Te escribimos de Tienda Vorare para retomar tu pedido pendiente. ¿Seguimos por aquí?",
  params: [{ name: "nombre", example: "María" }],
  buttons: ["Sí, continuar", "No, gracias"],
  footer: FOOTER,
};

// --- Admin (avisos al operador en su propio WhatsApp) --------------------------

const ADMIN_ALERTA_V2: WaTemplateDefinition = {
  name: "vorare_admin_alerta_v2",
  language: "es",
  category: "UTILITY",
  bodyText:
    "🚨 Escalación a humano\n\nCliente: {{cliente}}\nMotivo: {{motivo}}\nTeléfono: +{{telefono}}\n\nEl agente quedó apagado para esta conversación. Responde desde el inbox.",
  params: [
    { name: "cliente", example: "Ana Pérez" },
    { name: "motivo", example: "el cliente envió un audio" },
    { name: "telefono", example: "573001234567" },
  ],
  buttons: [],
  footer: null,
};

const ADMIN_AVISO_V2: WaTemplateDefinition = {
  name: "vorare_admin_aviso_v2",
  language: "es",
  category: "UTILITY",
  bodyText:
    "🔔 Aviso del agente Vorare: {{aviso}}\n\nRevisa el inbox para ver el detalle.",
  params: [
    { name: "aviso", example: "hay novedades de Dropi pendientes por revisar" },
  ],
  buttons: [],
  footer: null,
};

// NOTA: sigue sin haber plantilla dedicada al 2FA de Dropi — Meta auto-rechaza
// UTILITY con lenguaje de códigos/OTP. El fallback usa ADMIN_AVISO y el texto
// del código viaja en el parámetro (Meta no revisa los params de envío).

// --- Catalog + active pointers ----------------------------------------------

export const VORARE_TEMPLATES: WaTemplateDefinition[] = [
  CONFIRMACION_DATOS_COD,
  RECUPERACION_PEDIDO_SIN_CONFIRMAR,
  PEDIDO_CONFIRMADO_PROGRAMADO,
  GUIA_RECOLECTADA,
  GUIA_EN_TRANSITO,
  GUIA_EN_REPARTO,
  GUIA_ENTREGADA,
  GUIA_ENTREGADA_V2,
  GUIA_EN_OFICINA,
  NOVEDAD_ENTREGA,
  GUIA_GENERADA_V2,
  REMARKETING_RECOMPRA_MES,
  REABRIR_V2,
  ADMIN_ALERTA_V2,
  ADMIN_AVISO_V2,
];

// Swap these constants to roll a new version (the old one stays registered).
export const CONFIRMACION_PEDIDO_TEMPLATE: string = CONFIRMACION_DATOS_COD.name;
export const RECORDATORIO_PEDIDO_TEMPLATE: string =
  RECUPERACION_PEDIDO_SIN_CONFIRMAR.name;
export const PEDIDO_CONFIRMADO_TEMPLATE: string =
  PEDIDO_CONFIRMADO_PROGRAMADO.name;
export const GUIA_GENERADA_TEMPLATE: string = GUIA_GENERADA_V2.name;
export const RECOLECTADO_TEMPLATE: string = GUIA_RECOLECTADA.name;
export const EN_TRANSITO_TEMPLATE: string = GUIA_EN_TRANSITO.name;
export const CON_MENSAJERO_TEMPLATE: string = GUIA_EN_REPARTO.name;
export const ENTREGADO_TEMPLATE: string = GUIA_ENTREGADA.name;
export const EN_OFICINA_TEMPLATE: string = GUIA_EN_OFICINA.name;
export const NOVEDAD_TEMPLATE: string = NOVEDAD_ENTREGA.name;
export const RECOMPRA_TEMPLATE: string = REMARKETING_RECOMPRA_MES.name;
export const REABRIR_TEMPLATE: string = REABRIR_V2.name;
export const ADMIN_ALERTA_TEMPLATE: string = ADMIN_ALERTA_V2.name;
export const ADMIN_AVISO_TEMPLATE: string = ADMIN_AVISO_V2.name;

/** Nombres retirados del WABA cuando se rediseñó el catálogo (feedback doc). */
export const RETIRED_TEMPLATE_NAMES: string[] = [
  "vorare_confirmacion_pedido_v1",
  "vorare_recordatorio_pedido_v1",
  "vorare_guia_generada_v1",
  "vorare_recolectado_v1",
  "vorare_en_transito_v1",
  "vorare_con_mensajero_v1",
  "vorare_entregado_v1",
  "vorare_novedad_v1",
  "vorare_reabrir_v1",
  "vorare_admin_alerta_v1",
  "vorare_admin_aviso_v1",
  "vorare_admin_codigo_v1",
];

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
 * Render the template body locally by filling {{param}} placeholders with the
 * ORDERED params array — the exact text the customer reads, stored in
 * `messages` so the inbox history never diverges from what Meta approved.
 * El footer no se incluye: WhatsApp lo muestra aparte, en gris.
 */
export function renderTemplateBody(name: string, params: string[]): string {
  const def = templateByName(name);
  if (!def) return params.join(" ");
  let body = def.bodyText;
  def.params.forEach((p, i) => {
    body = body.replaceAll(`{{${p.name}}}`, params[i] ?? `{{${p.name}}}`);
  });
  return body;
}

/** The Meta creation payload for a catalog definition (NAMED params). */
export function toMetaDefinition(
  def: WaTemplateDefinition,
): Record<string, unknown> {
  const components: Record<string, unknown>[] = [
    {
      type: "BODY",
      text: def.bodyText,
      ...(def.params.length > 0
        ? {
            example: {
              body_text_named_params: def.params.map((p) => ({
                param_name: p.name,
                example: p.example,
              })),
            },
          }
        : {}),
    },
  ];
  if (def.footer) {
    components.push({ type: "FOOTER", text: def.footer });
  }
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
    parameter_format: "NAMED",
    components,
  };
}
