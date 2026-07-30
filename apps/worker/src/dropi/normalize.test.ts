import { describe, expect, it } from "vitest";
import {
  deriveDropiState,
  extractLastMovement,
  normalizeDropiStatus,
} from "./normalize";

function payload(
  movements: Array<{ nom_mov: string; created_at?: string }>,
): Record<string, unknown> {
  return { servientrega_movements: movements };
}

describe("normalizeDropiStatus", () => {
  it("mapea los estados que antes caían en unknown", () => {
    // Estos 4 dejaban 128 pedidos como "—" en la vista de Pedidos.
    expect(normalizeDropiStatus("DEVOLUCION").status).toBe("devolucion");
    expect(normalizeDropiStatus("RECHAZADO").status).toBe("rechazado");
    expect(normalizeDropiStatus("PAQUETE RETORNADO PARA REPROCESO").status).toBe(
      "retornado",
    );
    expect(normalizeDropiStatus("NOVEDAD SOLUCIONADA").status).toBe(
      "novedad_solucionada",
    );
  });

  it("NO trata una novedad solucionada como novedad", () => {
    // Mapearla a `novedad` relanzaría recordatorios y escalación de un caso
    // que la transportadora ya cerró.
    expect(normalizeDropiStatus("NOVEDAD SOLUCIONADA").status).not.toBe(
      "novedad",
    );
    expect(normalizeDropiStatus("NOVEDAD").status).toBe("novedad");
  });

  it("conserva los mapeos previos", () => {
    expect(normalizeDropiStatus("ENTREGADO").status).toBe("entregado");
    expect(normalizeDropiStatus("INCIDENCIA EN RUTA").status).toBe("novedad");
    expect(normalizeDropiStatus("CANCELADO").status).toBe("anulada");
    expect(normalizeDropiStatus("PENDIENTE CONFIRMACION").status).toBe(
      "pendiente_confirmacion",
    );
    expect(normalizeDropiStatus(null).status).toBe("unknown");
    expect(normalizeDropiStatus("ALGO NUEVO DE DROPI").status).toBe("unknown");
  });
});

describe("extractLastMovement", () => {
  it("toma el más reciente por fecha, no el último del array", () => {
    const mv = extractLastMovement(
      payload([
        { nom_mov: "ENTREGADO EN EXPRESS CENTER", created_at: "2026-06-16T14:05:41" },
        { nom_mov: "RECOLECTADO", created_at: "2026-06-10T09:00:00" },
      ]),
    );
    expect(mv.name).toBe("ENTREGADO EN EXPRESS CENTER");
    expect(mv.at?.toISOString()).toContain("2026-06-16");
  });

  it("cae al orden del array cuando no hay fechas", () => {
    const mv = extractLastMovement(
      payload([{ nom_mov: "RECOLECTADO" }, { nom_mov: "EN REPARTO" }]),
    );
    expect(mv.name).toBe("EN REPARTO");
    expect(mv.at).toBeNull();
  });

  it("tolera payloads vacíos, ausentes o mal formados", () => {
    expect(extractLastMovement(null).name).toBeNull();
    expect(extractLastMovement({}).name).toBeNull();
    expect(extractLastMovement(payload([])).name).toBeNull();
    expect(
      extractLastMovement({ servientrega_movements: "no es un array" }).name,
    ).toBeNull();
    expect(extractLastMovement(payload([{ nom_mov: "   " }])).name).toBeNull();
  });
});

describe("deriveDropiState", () => {
  it("un paquete en el Express Center NO cuenta como entregado", () => {
    // Dropi manda status ENTREGADO y el cliente no tiene el paquete: es el bug
    // por el que 28 clientes recibieron "tu pedido fue entregado".
    const state = deriveDropiState(
      "ENTREGADO",
      payload([
        { nom_mov: "ENTREGADO EN EXPRESS CENTER", created_at: "2026-06-16T14:05:41" },
      ]),
    );
    expect(state.status).toBe("en_oficina");
    expect(state.lastMovement).toBe("ENTREGADO EN EXPRESS CENTER");
  });

  it("una entrega real sigue siendo entregado", () => {
    const state = deriveDropiState(
      "ENTREGADO",
      payload([{ nom_mov: "COD PAGADO", created_at: "2026-06-20T10:00:00" }]),
    );
    expect(state.status).toBe("entregado");
  });

  it("el cliente que ya reclamó sale del estado en oficina", () => {
    const state = deriveDropiState(
      "ENTREGADO",
      payload([
        { nom_mov: "ENTREGADO EN EXPRESS CENTER", created_at: "2026-06-16T14:05:41" },
        { nom_mov: "COD PAGADO", created_at: "2026-06-18T11:00:00" },
      ]),
    );
    expect(state.status).toBe("entregado");
  });

  it("una novedad activa manda sobre la corrección de oficina", () => {
    // De la novedad dependen recordatorios y escalación; no la pisamos.
    const state = deriveDropiState(
      "NOVEDAD",
      payload([
        { nom_mov: "ENTREGADO EN OFICINA", created_at: "2026-06-16T14:05:41" },
      ]),
    );
    expect(state.status).toBe("novedad");
    expect(state.lastMovement).toBe("ENTREGADO EN OFICINA");
  });

  it("no confunde un movimiento que solo menciona una oficina", () => {
    const state = deriveDropiState(
      "ENTREGADO",
      payload([
        { nom_mov: "EN TRÁNSITO HACIA OFICINA CENTRAL", created_at: "2026-06-16T00:00:00" },
      ]),
    );
    expect(state.status).toBe("entregado");
  });

  it("expone el movimiento aunque el estado no cambie", () => {
    const state = deriveDropiState(
      "INCIDENCIA EN RUTA",
      payload([
        {
          nom_mov: "DESTINATARIO NO CONTESTA LLAMADAS NI WHATSAPP",
          created_at: "2026-07-01T08:00:00",
        },
      ]),
    );
    expect(state.status).toBe("novedad");
    expect(state.lastMovement).toBe(
      "DESTINATARIO NO CONTESTA LLAMADAS NI WHATSAPP",
    );
    expect(state.lastMovementAt).not.toBeNull();
  });
});
