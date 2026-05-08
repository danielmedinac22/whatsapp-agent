/**
 * Extracts the carrier-reported reason for a Dropi novedad from the raw payload.
 *
 * Primary signal: `novedad_servientrega` (string in CAPS, e.g.
 *   "DESTINATARIO NO CONTESTA LLAMADAS NI WHATSAPP").
 * Fallback: last non-generic entry of `servientrega_movements[].nom_mov`.
 *
 * Returns null when no concrete reason is available (e.g. raw status
 * "INCIDENCIA EN RUTA" with empty novedad_servientrega and last movement
 * still generic). In that case the caller should wait for a more specific
 * carrier update before reaching out to the customer.
 */
const GENERIC_MOVEMENTS = new Set([
  "INCIDENCIA EN RUTA",
  "EN TRÁNSITO",
  "EN TRANSITO",
  "EN REPARTO",
  "EN RUTA",
  "RECOLECTADO",
  "PREPARADO PARA TRANSPORTADORA",
]);

export function extractNovedadReason(
  rawPayload: unknown,
): string | null {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const raw = rawPayload as Record<string, unknown>;

  const direct = raw.novedad_servientrega;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const moves = raw.servientrega_movements;
  if (Array.isArray(moves) && moves.length > 0) {
    for (let i = moves.length - 1; i >= 0; i--) {
      const m = moves[i];
      if (m && typeof m === "object") {
        const nom = (m as Record<string, unknown>).nom_mov;
        if (typeof nom === "string" && nom.trim()) {
          const trimmed = nom.trim();
          if (!GENERIC_MOVEMENTS.has(trimmed.toUpperCase())) {
            return trimmed;
          }
        }
      }
    }
  }

  return null;
}
