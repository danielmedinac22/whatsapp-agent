import { describe, expect, it } from "vitest";
import { normalizeReasoningEffort, salesReasoningOptions } from "./model";

describe("normalizeReasoningEffort · el esfuerzo con el que contesta el vendedor", () => {
  it("respeta los tres valores del proveedor", () => {
    // Es un campo, no una constante: subirlo es cambiar un valor en el panel.
    expect(normalizeReasoningEffort("low")).toBe("low");
    expect(normalizeReasoningEffort("medium")).toBe("medium");
    expect(normalizeReasoningEffort("high")).toBe("high");
  });

  it("tolera el espacio de más y la mayúscula del panel", () => {
    expect(normalizeReasoningEffort(" High ")).toBe("high");
  });

  it("lo que no reconoce cae en bajo, no hacia arriba", () => {
    // La columna es `text` a propósito —vocabulario del proveedor, cambia sin
    // migración—, así que puede llegar cualquier cosa. Adivinar hacia arriba
    // encarecería y demoraría cada turno por un error de tecleo.
    expect(normalizeReasoningEffort("altísimo")).toBe("low");
    expect(normalizeReasoningEffort("")).toBe("low");
    expect(normalizeReasoningEffort(null)).toBe("low");
  });
});

describe("salesReasoningOptions · lo que se le manda al proveedor", () => {
  it("viaja como opción de OpenRouter, con el valor de la configuración", () => {
    expect(salesReasoningOptions({ reasoningEffort: "medium" })).toEqual({
      providerOptions: { openrouter: { reasoning: { effort: "medium" } } },
    });
  });
});
