import { describe, expect, it } from "vitest";
import { resolveSalesAgentSettings, type Operation } from "@wa/db";

// UUIDs inventados a propósito, como en el hermano: la operación se resuelve
// por su conexión o por su país, nunca por un identificador de producción
// escrito a mano.
const GUATEMALA_ID = "11111111-1111-4111-8111-111111111111";
const COLOMBIA_ID = "22222222-2222-4222-8222-222222222222";

function operacion(id: string, countryCode: string, currency: string): Operation {
  return {
    id,
    name: countryCode,
    countryCode,
    currency,
    status: "active",
    // Lo agregó la 0023: el destino de conversiones de la operación. Nulo en el
    // fixture porque nada de este módulo lo mira.
    capiDatasetId: null,
    // Columna de la `0029`, por lo mismo que la de arriba: la fila la tiene.
    metaAdAccountId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const GUATEMALA = operacion(GUATEMALA_ID, "GT", "GTQ");
const COLOMBIA = operacion(COLOMBIA_ID, "CO", "COP");

interface Fila {
  id: string;
  operationId: string;
  displayName: string;
  discountLimitPct: number;
  model: string;
}

function fila(over: Partial<Fila> & Pick<Fila, "id" | "operationId">): Fila {
  return {
    displayName: "Sebastián",
    discountLimitPct: 0,
    model: "openai/gpt-5.4-mini",
    ...over,
  };
}

/** La forma que tiene producción hoy: ninguna fila, ningún vendedor. */
const sinVendedores: Fila[] = [];

const soloGuatemala: Fila[] = [
  fila({ id: "gt", operationId: GUATEMALA_ID, discountLimitPct: 10 }),
];

const dosOperaciones: Fila[] = [
  ...soloGuatemala,
  fila({
    id: "co",
    operationId: COLOMBIA_ID,
    displayName: "Mateo",
    discountLimitPct: 0,
    model: "openai/gpt-5.4",
  }),
];

describe("resolveSalesAgentSettings · aislamiento entre operaciones", () => {
  it("le da a cada operación su propio vendedor", () => {
    expect(resolveSalesAgentSettings(dosOperaciones, GUATEMALA)?.displayName).toBe(
      "Sebastián",
    );
    expect(resolveSalesAgentSettings(dosOperaciones, COLOMBIA)?.displayName).toBe(
      "Mateo",
    );
  });

  it("nunca le aplica a una operación el límite de descuento de otra", () => {
    // El límite es plata: diez puntos de margen de Guatemala aplicados a
    // Colombia son descuentos que nadie autorizó, en una moneda distinta.
    expect(resolveSalesAgentSettings(dosOperaciones, GUATEMALA)?.discountLimitPct).toBe(10);
    expect(resolveSalesAgentSettings(dosOperaciones, COLOMBIA)?.discountLimitPct).toBe(0);
  });

  it("pedir el vendedor de una operación que no lo tiene no devuelve el de la vecina", () => {
    expect(resolveSalesAgentSettings(soloGuatemala, COLOMBIA)).toBeNull();
  });

  it("sin ninguna fila no hay vendedor para nadie", () => {
    // Es el estado de producción, y el que conserva el comportamiento actual:
    // sin vendedor configurado contesta el agente de confirmación de siempre.
    expect(resolveSalesAgentSettings(sinVendedores, GUATEMALA)).toBeNull();
    expect(resolveSalesAgentSettings(sinVendedores, COLOMBIA)).toBeNull();
  });
});
