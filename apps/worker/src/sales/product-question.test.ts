import { describe, expect, it } from "vitest";
import {
  MAX_LISTA_CORTA,
  renderProductQuestionBlock,
} from "./product-question";

// Los cuatro de nombre casi idéntico: el caso que motivó la cascada entera y,
// ahora, la pregunta. Es la lista que el lead tiene que poder desempatar.
const FAMILIA = [
  "REVITALHAIR - DHT ANTICALVICIE",
  "REVITALHAIR - DHT BLOCKER ANTICALVICIE",
  "REVITALHAIR COMBO DHT + SERUM ANTICALVICIE 360",
  "Hair Recovery 3X - COMBO RECUPERACION CAPILAR TOTAL",
];

describe("la pregunta al lead con lista corta", () => {
  it("ofrece exactamente los candidatos registrados, uno por línea", () => {
    const bloque = renderProductQuestionBlock(FAMILIA);
    for (const nombre of FAMILIA) expect(bloque).toContain(`- ${nombre}`);
  });

  it("no ofrece el catálogo entero: lo que no era candidato no aparece", () => {
    // Es el criterio del ticket 05 y la razón de que el 06 fuera primero: sin
    // los candidatos registrados, lo único que se podía ofrecer era todo.
    const bloque = renderProductQuestionBlock(FAMILIA);
    expect(bloque).not.toContain("RELOJ ELEGANCE");
    expect(bloque).not.toContain("DEOS");
  });

  it("le prohíbe elegir por el cliente, aunque uno le parezca el más probable", () => {
    const bloque = renderProductQuestionBlock(FAMILIA);
    expect(bloque).toContain("no elijas tú por él");
  });

  it("dos candidatos ya son una lista", () => {
    const bloque = renderProductQuestionBlock(FAMILIA.slice(0, 2));
    expect(bloque).toContain(`- ${FAMILIA[0]}`);
    expect(bloque).toContain(`- ${FAMILIA[1]}`);
  });
});

describe("cuándo la pregunta sale abierta en vez de con lista", () => {
  const esAbierta = (bloque: string) => !bloque.includes("\n- ");

  it("sin candidatos —un lead sin anuncio— se pregunta y no se propone nada", () => {
    // «Un mensaje sin referencia de anuncio entra directo a la pregunta».
    const bloque = renderProductQuestionBlock([]);
    expect(esAbierta(bloque)).toBe(true);
    expect(bloque).toContain("No le propongas productos");
  });

  it("con un solo candidato tampoco hay lista: un candidato no es una duda", () => {
    expect(esAbierta(renderProductQuestionBlock([FAMILIA[0]!]))).toBe(true);
  });

  it("si uno de los candidatos no se puede nombrar, no se ofrece la lista a medias", () => {
    // Ofrecerle al lead tres de los cuatro es empujarlo a elegir entre esos
    // tres: es elegir por él con pasos de más, que es lo único que la cascada
    // existe para no hacer.
    const bloque = renderProductQuestionBlock([
      FAMILIA[0]!,
      null,
      FAMILIA[2]!,
      FAMILIA[3]!,
    ]);
    expect(esAbierta(bloque)).toBe(true);
    expect(bloque).not.toContain("REVITALHAIR");
  });

  it("un anuncio apuntando a más productos de los que caben tampoco es lista corta", () => {
    const demasiados = Array.from(
      { length: MAX_LISTA_CORTA + 1 },
      (_, i) => `Producto ${i + 1}`,
    );
    expect(esAbierta(renderProductQuestionBlock(demasiados))).toBe(true);
  });

  it("justo en el borde todavía se lista", () => {
    const enElBorde = Array.from(
      { length: MAX_LISTA_CORTA },
      (_, i) => `Producto ${i + 1}`,
    );
    expect(esAbierta(renderProductQuestionBlock(enElBorde))).toBe(false);
  });

  it("un nombre en blanco cuenta como no nombrable, no como un nombre vacío", () => {
    expect(esAbierta(renderProductQuestionBlock([FAMILIA[0]!, "   "]))).toBe(true);
  });
});

describe("lo que la pregunta no hace", () => {
  it("no da precios ni características mientras no sepa de qué producto hablan", () => {
    for (const bloque of [
      renderProductQuestionBlock(FAMILIA),
      renderProductQuestionBlock([]),
    ]) {
      expect(bloque).toContain("Antes de hablar de precio");
      expect(bloque).toContain("no describas ningún producto");
    }
  });

  it("no deja al vendedor mudo: puede saludar y seguir la conversación", () => {
    // Un vendedor que no puede decir nada hasta saber el producto es un lead
    // que se va. Lo que se prohíbe es hablar del producto, no conversar.
    expect(renderProductQuestionBlock([])).toContain(
      "Lo que sí puedes hacer es saludar",
    );
  });
});
