import { describe, expect, it } from "vitest";
import {
  formatProductPrice,
  MAX_PRODUCT_PRICE,
  parseProductPrice,
  productPriceFromColumn,
  productPriceRejectionText,
  productPriceToColumn,
} from "@wa/shared";

/**
 * La regla del precio de un producto nativo, que el navegador y la ruta
 * comparten. Vive en `@wa/shared` y se prueba desde acá porque la suite del
 * repo es la del worker.
 */

function valor(raw: string | number): number {
  const p = parseProductPrice(raw);
  if (!p.ok) throw new Error(`«${raw}» fue rechazado: ${p.reason}`);
  return p.value;
}

describe("parseProductPrice · lo que una persona teclea de verdad", () => {
  it("el punto de miles no divide el precio por mil", () => {
    // Es el error caro: `150.000` leído como ciento cincuenta se descubre con
    // el repartidor cobrando mil veces menos en la puerta del cliente.
    expect(valor("150.000")).toBe(150000);
    expect(valor("1.234.567")).toBe(1234567);
  });

  it("la coma es el decimal, como se escribe en los dos países", () => {
    expect(valor("1.234,50")).toBe(1234.5);
    expect(valor("399,90")).toBe(399.9);
  });

  it("un punto con dos dígitos detrás sí es decimal", () => {
    expect(valor("199.99")).toBe(199.99);
  });

  it("el símbolo de la moneda y los espacios no estorban", () => {
    expect(valor("Q 400")).toBe(400);
    expect(valor("  $150.000 ")).toBe(150000);
    expect(valor("400 GTQ")).toBe(400);
  });

  it("un número ya numérico pasa igual", () => {
    expect(valor(349)).toBe(349);
  });

  it("redondea a dos decimales en vez de rechazar", () => {
    expect(valor("33.333")).toBe(33333);
    expect(valor(10.006)).toBe(10.01);
  });
});

describe("parseProductPrice · lo que no se guarda", () => {
  it("lo que no es un número se rechaza", () => {
    for (const raw of ["", "   ", "gratis", "Q", "1,2,3"]) {
      expect(parseProductPrice(raw).ok).toBe(false);
    }
  });

  it("cero y negativo se rechazan: contraentrega se cobra al entregar", () => {
    expect(parseProductPrice("0")).toEqual({ ok: false, reason: "not_positive" });
    expect(parseProductPrice(-5)).toEqual({ ok: false, reason: "not_positive" });
  });

  it("por encima del techo de la columna se rechaza antes de llegar a Postgres", () => {
    expect(parseProductPrice(MAX_PRODUCT_PRICE + 1)).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(parseProductPrice(MAX_PRODUCT_PRICE).ok).toBe(true);
  });

  it("cada rechazo se le explica al admin en una frase", () => {
    for (const reason of ["not_a_number", "not_positive", "too_large"] as const) {
      expect(productPriceRejectionText({ reason }).length).toBeGreaterThan(10);
    }
  });
});

describe("el viaje a la columna y de vuelta", () => {
  it("lo que se escribe es lo que se lee", () => {
    expect(productPriceFromColumn(productPriceToColumn(valor("150.000")))).toBe(
      150000,
    );
  });

  it("la columna guarda siempre dos decimales", () => {
    expect(productPriceToColumn(349)).toBe("349.00");
  });

  it("vacío, ilegible y cero se leen igual: este producto no tiene precio", () => {
    // Los tres significan lo mismo para quien pregunta, y la respuesta segura
    // es la misma: no hay línea, escala a un asesor.
    expect(productPriceFromColumn(null)).toBeNull();
    expect(productPriceFromColumn(undefined)).toBeNull();
    expect(productPriceFromColumn("gratis")).toBeNull();
    expect(productPriceFromColumn("0.00")).toBeNull();
  });
});

describe("formatProductPrice", () => {
  it("lleva la moneda de la operación adelante", () => {
    expect(formatProductPrice(349, "GTQ")).toContain("GTQ");
    expect(formatProductPrice(150000, "COP")).toContain("COP");
  });

  it("un precio redondo se escribe redondo", () => {
    expect(formatProductPrice(399, "GTQ")).toBe("GTQ 399");
  });

  it("con centavos los muestra los dos, no uno", () => {
    // «449,5» se lee como un precio a medio escribir, y en la columna donde se
    // comparan importes eso es una duda que no tiene que haber.
    expect(formatProductPrice(449.5, "GTQ")).toBe("GTQ 449,50");
  });
});
