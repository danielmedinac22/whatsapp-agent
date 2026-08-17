import { describe, expect, it } from "vitest";
import { resolveAgentSettings, type Operation } from "@wa/db";

// UUIDs inventados a propósito: la operación se resuelve por su conexión o por
// su país, nunca por un identificador de producción escrito a mano.
const GUATEMALA_ID = "11111111-1111-4111-8111-111111111111";
const COLOMBIA_ID = "22222222-2222-4222-8222-222222222222";

function operacion(id: string, countryCode: string, currency: string): Operation {
  return {
    id,
    name: countryCode,
    countryCode,
    currency,
    status: "active",
    // Columna de la `0023`. Nada de este archivo la mira: está porque una fila
    // de `operations` ahora la tiene, y el tipado estricto no deja fingir que no.
    capiDatasetId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const GUATEMALA = operacion(GUATEMALA_ID, "GT", "GTQ");
const COLOMBIA = operacion(COLOMBIA_ID, "CO", "COP");

interface Fila {
  id: number;
  operationId: string;
  model: string;
  followupDelayMs: number;
  dropiTemplateGuiaId: string | null;
}

function fila(over: Partial<Fila> & Pick<Fila, "id" | "operationId">): Fila {
  return {
    model: "openai/gpt-5.4-mini",
    followupDelayMs: 120_000,
    dropiTemplateGuiaId: null,
    ...over,
  };
}

/** La forma que tiene producción hoy: una sola fila, la de Guatemala. */
const soloGuatemala: Fila[] = [
  fila({ id: 1, operationId: GUATEMALA_ID, dropiTemplateGuiaId: "tpl-guia-gt" }),
];

/** La forma que tendrá cuando Colombia entre a operar. */
const dosOperaciones: Fila[] = [
  ...soloGuatemala,
  fila({
    id: 2,
    operationId: COLOMBIA_ID,
    model: "openai/gpt-5.4",
    followupDelayMs: 900_000,
    dropiTemplateGuiaId: "tpl-guia-co",
  }),
];

describe("resolveAgentSettings · aislamiento entre operaciones", () => {
  it("le da a cada operación su propia configuración", () => {
    expect(resolveAgentSettings(dosOperaciones, GUATEMALA)?.id).toBe(1);
    expect(resolveAgentSettings(dosOperaciones, COLOMBIA)?.id).toBe(2);
  });

  it("nunca le aplica a una operación la configuración de otra", () => {
    const co = resolveAgentSettings(dosOperaciones, COLOMBIA);
    expect(co?.model).toBe("openai/gpt-5.4");
    expect(co?.model).not.toBe("openai/gpt-5.4-mini");
  });

  it("las plantillas de logística y los tiempos son los de la operación que se pidió", () => {
    const gt = resolveAgentSettings(dosOperaciones, GUATEMALA);
    const co = resolveAgentSettings(dosOperaciones, COLOMBIA);
    expect(gt?.dropiTemplateGuiaId).toBe("tpl-guia-gt");
    expect(co?.dropiTemplateGuiaId).toBe("tpl-guia-co");
    expect(gt?.followupDelayMs).toBe(120_000);
    expect(co?.followupDelayMs).toBe(900_000);
  });

  it("pedir la de una operación que no tiene fila no devuelve la de la vecina", () => {
    // Colombia existe como operación pero todavía no tiene configuración: sin
    // configuración el agente no responde y se nota; con la de Guatemala
    // respondería en quetzales a un cliente colombiano y no se notaría.
    expect(resolveAgentSettings(soloGuatemala, COLOMBIA)).toBeNull();
  });

  it("sin ninguna fila no hay configuración", () => {
    expect(resolveAgentSettings([], GUATEMALA)).toBeNull();
    expect(resolveAgentSettings([], COLOMBIA)).toBeNull();
  });
});

describe("resolveAgentSettings · lo que el contract borró", () => {
  it("la fila `id = 1` no es la respuesta de nadie salvo de su propia operación", () => {
    // El lote 05 dejó un ámbito `global` que resolvía a la fila `id = 1`.
    // Mientras solo existiera Guatemala esa fila *era* la de Guatemala, así que
    // parecía inofensivo. Con Colombia en la tabla, un llamador global habría
    // recibido la fila guatemalteca sin decirlo — el mecanismo exacto por el
    // que un cliente colombiano recibe el prompt y las plantillas de Guatemala.
    // Hoy ese llamador no existe: la única pregunta que se puede hacer es
    // «la de esta operación», y la fila `id = 1` solo responde a Guatemala.
    const gt = resolveAgentSettings(dosOperaciones, GUATEMALA);
    expect(gt?.id).toBe(1);
    expect(resolveAgentSettings(dosOperaciones, COLOMBIA)?.id).not.toBe(1);
  });

  it("una operación cuya fila no es la `id = 1` recibe la suya, no la primera", () => {
    // Antes, el ámbito global buscaba `id === 1` y devolvía `null` si no estaba.
    // Ahora la resolución es por operación y el `id` entero no participa.
    const soloColombia: Fila[] = [fila({ id: 2, operationId: COLOMBIA_ID })];
    expect(resolveAgentSettings(soloColombia, COLOMBIA)?.id).toBe(2);
    expect(resolveAgentSettings(soloColombia, GUATEMALA)).toBeNull();
  });
});
