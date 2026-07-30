import { describe, expect, it } from "vitest";
import { LOGISTIC_SITUATIONS, situationOfMovement } from "@wa/shared";

/**
 * Los grupos se comparan contra `upper(last_movement_raw)` en SQL. Si un valor
 * del catálogo tuviera minúsculas o espacios de más, el filtro no fallaría:
 * devolvería cero pedidos en silencio, que es peor.
 */
describe("catálogo de situaciones logísticas", () => {
  it("todos los movimientos están normalizados en mayúsculas", () => {
    for (const s of LOGISTIC_SITUATIONS) {
      for (const m of s.movements) {
        expect(m).toBe(m.toUpperCase().trim());
      }
    }
  });

  it("ningún movimiento cae en dos grupos", () => {
    const seen = new Map<string, string>();
    for (const s of LOGISTIC_SITUATIONS) {
      for (const m of s.movements) {
        expect(seen.get(m), `"${m}" duplicado`).toBeUndefined();
        seen.set(m, s.key);
      }
    }
  });

  it("las claves de grupo son únicas", () => {
    const keys = LOGISTIC_SITUATIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("situationOfMovement", () => {
  it("clasifica los movimientos reales que reporta la transportadora", () => {
    expect(situationOfMovement("ENTREGADO EN EXPRESS CENTER")?.key).toBe(
      "en_oficina",
    );
    expect(situationOfMovement("COD PAGADO")?.key).toBe("entregado");
    expect(situationOfMovement("DEVUELTO")?.key).toBe("devuelto");
    expect(situationOfMovement("NÚMERO TELEFÓNICO INCORRECTO")?.key).toBe(
      "telefono_malo",
    );
    expect(
      situationOfMovement("DESTINATARIO RE-PROGRAMA FECHA DE ENTREGA")?.key,
    ).toBe("reprogramado");
  });

  it("tolera espacios y minúsculas del payload", () => {
    expect(situationOfMovement("  entregado en express center ")?.key).toBe(
      "en_oficina",
    );
  });

  it("un movimiento nuevo no cae en ningún grupo (se muestra crudo)", () => {
    expect(situationOfMovement("MOVIMIENTO QUE DROPI INVENTE MAÑANA")).toBeNull();
    expect(situationOfMovement(null)).toBeNull();
    expect(situationOfMovement("")).toBeNull();
  });
});
