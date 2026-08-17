import { describe, expect, it } from "vitest";
import {
  belongsToOperation,
  pickShopifyMatch,
  type MatchOperation,
  type ShopifyMatchCandidate,
} from "./match-shopify";

const GUATEMALA: MatchOperation = {
  id: "op-gt",
  countryCode: "GT",
  currency: "GTQ",
};

const COLOMBIA: MatchOperation = {
  id: "op-co",
  countryCode: "CO",
  currency: "COP",
};

function candidate(
  over: Partial<ShopifyMatchCandidate> & { id: string },
): ShopifyMatchCandidate {
  return {
    customerName: "Ana López",
    contactId: `contacto-${over.id}`,
    currency: "GTQ",
    ...over,
  };
}

describe("belongsToOperation", () => {
  it("compara la moneda sin castigar mayúsculas ni espacios", () => {
    expect(belongsToOperation({ currency: " gtq " }, GUATEMALA)).toBe(true);
    expect(belongsToOperation({ currency: "GTQ" }, GUATEMALA)).toBe(true);
  });

  it("un pedido en otra moneda no es de esta operación", () => {
    expect(belongsToOperation({ currency: "COP" }, GUATEMALA)).toBe(false);
    expect(belongsToOperation({ currency: "GTQ" }, COLOMBIA)).toBe(false);
  });

  it("un pedido sin moneda no se atribuye a ninguna operación", () => {
    // Dirección segura del error: un cruce que no ocurre queda visible en
    // /pedidos; uno al país equivocado no lo nota nadie.
    expect(belongsToOperation({ currency: null }, GUATEMALA)).toBe(false);
    expect(belongsToOperation({ currency: "" }, GUATEMALA)).toBe(false);
  });
});

describe("pickShopifyMatch", () => {
  it("un pedido de la logística guatemalteca no se cruza contra un pedido colombiano", () => {
    // El error que este lote existe para hacer imposible.
    const out = pickShopifyMatch({
      operation: GUATEMALA,
      customerName: "Ana López",
      candidates: [candidate({ id: "co-1", currency: "COP" })],
    });
    expect(out.match).toBeNull();
    expect(out.rejected).toBe(1);
  });

  it("un candidato de otra operación no compite contra los de la propia", () => {
    // Sin el filtro por operación ganaría el colombiano: tiene el nombre
    // exacto y el guatemalteco no.
    const out = pickShopifyMatch({
      operation: GUATEMALA,
      customerName: "Ana López",
      candidates: [
        candidate({ id: "co-1", customerName: "Ana López", currency: "COP" }),
        candidate({ id: "gt-1", customerName: "Ana Lopez Ruiz" }),
      ],
    });
    expect(out.match?.shopifyOrderRowId).toBe("gt-1");
    expect(out.rejected).toBe(1);
  });

  it("el cruce de Guatemala elige lo mismo que hoy con un solo candidato", () => {
    const out = pickShopifyMatch({
      operation: GUATEMALA,
      customerName: "Ana López",
      candidates: [candidate({ id: "gt-1", customerName: "ana lopez" })],
    });
    expect(out.match).toEqual({
      shopifyOrderRowId: "gt-1",
      contactId: "contacto-gt-1",
      confidence: "high",
    });
    expect(out.rejected).toBe(0);
  });

  it("un solo candidato con nombre distinto queda en confianza baja", () => {
    const out = pickShopifyMatch({
      operation: GUATEMALA,
      customerName: "Ana López",
      candidates: [candidate({ id: "gt-1", customerName: "Pedro Ramírez" })],
    });
    expect(out.match?.shopifyOrderRowId).toBe("gt-1");
    expect(out.match?.confidence).toBe("low");
  });

  it("sin nombre del cliente, el único candidato de la operación es de confianza alta", () => {
    const out = pickShopifyMatch({
      operation: GUATEMALA,
      customerName: null,
      candidates: [candidate({ id: "gt-1", customerName: "Quien Sea" })],
    });
    expect(out.match?.confidence).toBe("high");
  });

  it("entre dos candidatos parecidos entre sí, la confianza baja", () => {
    // Dos pedidos del mismo teléfono y nombres casi iguales: elegir uno con
    // confianza alta sería adivinar.
    const out = pickShopifyMatch({
      operation: GUATEMALA,
      customerName: "Ana López",
      candidates: [
        candidate({ id: "gt-1", customerName: "Ana López" }),
        candidate({ id: "gt-2", customerName: "Ana Lópex" }),
      ],
    });
    expect(out.match?.shopifyOrderRowId).toBe("gt-1");
    expect(out.match?.confidence).toBe("low");
  });

  it("entre varios candidatos gana el nombre más parecido cuando le saca ventaja", () => {
    const out = pickShopifyMatch({
      operation: GUATEMALA,
      customerName: "Ana López",
      candidates: [
        candidate({ id: "gt-1", customerName: "Pedro Ramírez" }),
        candidate({ id: "gt-2", customerName: "Ana López" }),
      ],
    });
    expect(out.match).toEqual({
      shopifyOrderRowId: "gt-2",
      contactId: "contacto-gt-2",
      confidence: "high",
    });
  });

  it("sin candidatos no hay cruce", () => {
    const out = pickShopifyMatch({
      operation: GUATEMALA,
      customerName: "Ana López",
      candidates: [],
    });
    expect(out.match).toBeNull();
    expect(out.rejected).toBe(0);
  });
});
