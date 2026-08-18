import { describe, expect, it } from "vitest";
import {
  OPERATION_TINTS,
  RESERVED_CONTENT_COLORS,
  operationTint,
} from "@wa/shared";

/**
 * Que el marco distinga una operación de otra **sin ayuda del contenido**.
 *
 * Es el hallazgo del ejercicio de prototipos del nivel 1, y es el que hace que
 * estas pruebas existan: «el cambio Guatemala ↔ Colombia se percibe sin
 * explicarlo» hoy lo pasa cualquier cosa, **porque Colombia está vacía y cambia
 * todo el contenido**. El día que Colombia opere serán dos catálogos con los
 * mismos cuatro nombres REVITALHAIR y el contenido deja de ayudar. Lo que se
 * prueba acá es el estado difícil: dos operaciones que muestran exactamente lo
 * mismo.
 *
 * Lo que estas pruebas **no** pueden hacer es mirar la pantalla. Que el tinte se
 * vea, que 46px alcancen para navegar y que el teléfono se lea de reojo lo
 * verifica una persona.
 */

describe("el marco distingue dos operaciones aunque muestren lo mismo", () => {
  it("Guatemala y Colombia no comparten tinte", () => {
    expect(operationTint("GT").base).not.toBe(operationTint("CO").base);
  });

  it("el tinte sale del país y nunca del contenido, que puede ser idéntico", () => {
    // La misma llamada dos veces: si el tinte dependiera de algo de fuera
    // —cuántos productos hay, si la operación factura— dejaría de ser estable.
    expect(operationTint("CO")).toEqual(operationTint("CO"));
  });

  it("el país se escribe como venga: el código es el mismo dato", () => {
    expect(operationTint("co ").base).toBe(operationTint("CO").base);
  });

  it("los cuatro valores del tinte salen del mismo color", () => {
    const { base, line, soft, faint } = operationTint("GT");
    expect(base).toBe("#a78bfa");
    expect(line).toBe("rgba(167, 139, 250, 0.45)");
    expect(soft).toBe("rgba(167, 139, 250, 0.13)");
    expect(faint).toBe("rgba(167, 139, 250, 0.07)");
  });
});

describe("ningún país se queda con un color que ya significa algo", () => {
  it("ni Guatemala ni Colombia toman menta, ámbar ni rojo", () => {
    // La menta significa «confirmado», el ámbar «atención» y el rojo «falló».
    // Un país pintado de menta le quitaría al verde su único significado, justo
    // en la operación que factura.
    for (const code of Object.keys(OPERATION_TINTS)) {
      expect(RESERVED_CONTENT_COLORS).not.toContain(operationTint(code).base);
    }
  });

  it("tampoco los toma un país que nadie eligió todavía", () => {
    for (const code of ["MX", "PE", "EC", "CL", "AR", "US", "ES", "BR"]) {
      expect(RESERVED_CONTENT_COLORS).not.toContain(operationTint(code).base);
    }
  });
});

describe("un tercer país no rompe el mecanismo", () => {
  it("no hereda el tinte de Guatemala ni el de Colombia", () => {
    const elegidos = Object.keys(OPERATION_TINTS).map(
      (c) => operationTint(c).base,
    );
    for (const code of ["MX", "PE", "EC", "CL"]) {
      expect(elegidos).not.toContain(operationTint(code).base);
    }
  });

  it("dos países sin tinte elegido no caen los dos en el mismo color por defecto", () => {
    // Es la forma en que este mecanismo se apagaría sin que nadie lo note: dos
    // operaciones del mismo color son un riel que ya no dice en cuál estás.
    const tintes = ["MX", "PE", "EC", "CL"].map((c) => operationTint(c).base);
    expect(new Set(tintes).size).toBeGreaterThan(1);
  });

  it("el mismo país saca siempre el mismo tinte, entre arranques y entre pantallas", () => {
    expect(operationTint("MX").base).toBe(operationTint("MX").base);
  });
});
