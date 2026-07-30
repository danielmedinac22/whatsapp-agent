type DropiStatusEnum =
  | "unknown"
  | "pendiente_confirmacion"
  | "pendiente"
  | "guia_generada"
  | "preparado_transportadora"
  | "recolectado"
  | "en_transito"
  | "con_mensajero"
  | "en_oficina"
  | "entregado"
  | "novedad"
  | "novedad_solucionada"
  | "devolucion"
  | "rechazado"
  | "retornado"
  | "anulada";

const STATUS_MAP: Record<string, DropiStatusEnum> = {
  // confirmation pipeline
  "pendiente confirmacion": "pendiente_confirmacion",
  "pendiente confirmación": "pendiente_confirmacion",
  pendiente: "pendiente",
  "guia generada": "guia_generada",
  "guía generada": "guia_generada",
  guia_generada: "guia_generada",

  // pre-pickup / warehouse
  "preparado para transportadora": "preparado_transportadora",
  "pendiente por recoleccion": "preparado_transportadora",
  "pendiente por recolección": "preparado_transportadora",
  "en bodega origen": "preparado_transportadora",
  "en bodega": "preparado_transportadora",

  // shipping pipeline
  recolectado: "recolectado",
  "en transito": "en_transito",
  "en tránsito": "en_transito",
  "en ruta": "en_transito",
  "con mensajero": "con_mensajero",
  "en reparto": "con_mensajero",
  "en entrega": "con_mensajero",
  entregado: "entregado",

  // exceptions
  novedad: "novedad",
  "incidencia en ruta": "novedad",
  incidencia: "novedad",
  // Ya resuelta: estado propio, NO `novedad` — mapearla a novedad relanzaría
  // la escalación de un caso que ya se cerró.
  "novedad solucionada": "novedad_solucionada",
  "incidencia validada": "novedad_solucionada",
  "solucion aprobada": "novedad_solucionada",
  "solución aprobada": "novedad_solucionada",

  // terminales de devolución
  devolucion: "devolucion",
  devolución: "devolucion",
  devuelto: "devolucion",
  rechazado: "rechazado",
  rechazada: "rechazado",
  "paquete retornado para reproceso": "retornado",
  retornado: "retornado",

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

/**
 * Movimientos que significan "el paquete está en la oficina de la
 * transportadora esperando a que el cliente lo reclame". Dropi los reporta con
 * status de pedido ENTREGADO: cierto para la transportadora, falso para el
 * cliente. El patrón exige "ENTREGADO EN" para no capturar un movimiento de
 * tránsito que solo mencione una oficina de paso.
 */
const OFFICE_MOVEMENT = /^ENTREGADO EN (EXPRESS CENTER|OFICINA|AGENCIA)/;

export interface LastMovement {
  name: string | null;
  at: Date | null;
}

/**
 * Último movimiento reportado por la transportadora. El array llega ordenado
 * ascendente en la práctica, pero se ordena por fecha para no depender de eso.
 */
export function extractLastMovement(rawPayload: unknown): LastMovement {
  const none: LastMovement = { name: null, at: null };
  if (!rawPayload || typeof rawPayload !== "object") return none;
  const moves = (rawPayload as Record<string, unknown>).servientrega_movements;
  if (!Array.isArray(moves) || moves.length === 0) return none;

  let best: LastMovement = none;
  let bestKey = "";
  for (const entry of moves) {
    if (!entry || typeof entry !== "object") continue;
    const m = entry as Record<string, unknown>;
    const name = typeof m.nom_mov === "string" ? m.nom_mov.trim() : "";
    if (!name) continue;
    const createdAt = typeof m.created_at === "string" ? m.created_at : "";
    // Sin fecha, el orden del array es el único criterio disponible.
    if (!bestKey || createdAt >= bestKey) {
      const parsed = createdAt ? Date.parse(createdAt) : NaN;
      best = { name, at: Number.isNaN(parsed) ? null : new Date(parsed) };
      bestKey = createdAt;
    }
  }
  return best;
}

export interface DropiState {
  status: DropiStatusEnum;
  raw: string | null;
  lastMovement: string | null;
  lastMovementAt: Date | null;
}

/**
 * Estado real del pedido: el status de Dropi corregido con la situación
 * logística de la transportadora. Fuente única para el sync y el poll, para
 * que no puedan discrepar.
 */
export function deriveDropiState(
  rawStatus: string | null | undefined,
  rawPayload: unknown,
): DropiState {
  const { status, raw } = normalizeDropiStatus(rawStatus);
  const movement = extractLastMovement(rawPayload);
  const inOffice =
    movement.name !== null && OFFICE_MOVEMENT.test(movement.name.toUpperCase());
  return {
    // Solo corregimos el caso ambiguo (entregado). Si hay una novedad activa
    // manda la novedad: de ella dependen los recordatorios y la escalación.
    status: inOffice && status === "entregado" ? "en_oficina" : status,
    raw,
    lastMovement: movement.name,
    lastMovementAt: movement.at,
  };
}
