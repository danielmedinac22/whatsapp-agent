import { describe, expect, it } from "vitest";
import { salesAgentIsConfigured } from "./settings";

describe("salesAgentIsConfigured", () => {
  it("una operación sin fila no tiene vendedor", () => {
    expect(salesAgentIsConfigured(null)).toBe(false);
  });

  it("la fila sola no basta: la `0022` la crea con todo en blanco", () => {
    // Es el estado en el que el panel deja la configuración antes de que nadie
    // la llene. Contarla como vendedor activaría la lógica nueva sobre el
    // número que hoy factura — el riesgo R8 — sin que exista vendedor alguno.
    expect(salesAgentIsConfigured({ displayName: "" })).toBe(false);
    expect(salesAgentIsConfigured({ displayName: "   " })).toBe(false);
  });

  it("con nombre visible sí hay vendedor", () => {
    expect(salesAgentIsConfigured({ displayName: "Sebastián" })).toBe(true);
  });
});
