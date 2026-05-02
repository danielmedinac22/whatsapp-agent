type DropiStatusEnum =
  | "unknown"
  | "pendiente_confirmacion"
  | "pendiente"
  | "guia_generada"
  | "preparado_transportadora"
  | "recolectado"
  | "en_transito"
  | "con_mensajero"
  | "entregado"
  | "novedad"
  | "anulada";

const STATUS_MAP: Record<string, DropiStatusEnum> = {
  // confirmation pipeline
  "pendiente confirmacion": "pendiente_confirmacion",
  "pendiente confirmación": "pendiente_confirmacion",
  pendiente: "pendiente",
  "guia generada": "guia_generada",
  "guía generada": "guia_generada",

  // pre-pickup
  "preparado para transportadora": "preparado_transportadora",
  "pendiente por recoleccion": "preparado_transportadora",
  "pendiente por recolección": "preparado_transportadora",

  // shipping pipeline
  recolectado: "recolectado",
  "en transito": "en_transito",
  "en tránsito": "en_transito",
  "con mensajero": "con_mensajero",
  entregado: "entregado",

  // exceptions
  novedad: "novedad",
  anulada: "anulada",
  anulado: "anulada",
  cancelado: "anulada",
  cancelada: "anulada",
};

export function normalizeDropiStatus(raw: string | null | undefined): {
  status: DropiStatusEnum;
  raw: string | null;
} {
  if (!raw) return { status: "unknown", raw: null };
  const key = raw.trim().toLowerCase();
  return { status: STATUS_MAP[key] ?? "unknown", raw };
}
