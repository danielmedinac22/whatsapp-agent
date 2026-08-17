import { describe, expect, it } from "vitest";
import {
  agentSettingsScope,
  GLOBAL_AGENT_SETTINGS,
  GLOBAL_AGENT_SETTINGS_ID,
  resolveAgentSettings,
} from "@wa/db";

// UUIDs inventados a propósito: la operación se resuelve por su conexión o por
// su país, nunca por un identificador de producción escrito a mano.
const GUATEMALA = "11111111-1111-4111-8111-111111111111";
const COLOMBIA = "22222222-2222-4222-8222-222222222222";

interface Fila {
  id: number;
  operationId: string | null;
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
  fila({
    id: GLOBAL_AGENT_SETTINGS_ID,
    operationId: GUATEMALA,
    dropiTemplateGuiaId: "tpl-guia-gt",
  }),
];

/** La forma que tendrá cuando Colombia entre a operar. */
const dosOperaciones: Fila[] = [
  ...soloGuatemala,
  fila({
    id: 2,
    operationId: COLOMBIA,
    model: "openai/gpt-5.4",
    followupDelayMs: 900_000,
    dropiTemplateGuiaId: "tpl-guia-co",
  }),
];

describe("resolveAgentSettings · aislamiento entre operaciones", () => {
  it("le da a cada operación su propia configuración", () => {
    expect(
      resolveAgentSettings(dosOperaciones, {
        kind: "operation",
        operationId: GUATEMALA,
      })?.id,
    ).toBe(GLOBAL_AGENT_SETTINGS_ID);
    expect(
      resolveAgentSettings(dosOperaciones, {
        kind: "operation",
        operationId: COLOMBIA,
      })?.id,
    ).toBe(2);
  });

  it("nunca le aplica a una operación la configuración de otra", () => {
    const co = resolveAgentSettings(dosOperaciones, {
      kind: "operation",
      operationId: COLOMBIA,
    });
    expect(co?.model).toBe("openai/gpt-5.4");
    expect(co?.model).not.toBe("openai/gpt-5.4-mini");
  });

  it("las plantillas de logística y los tiempos son los de la operación que se pidió", () => {
    const gt = resolveAgentSettings(dosOperaciones, {
      kind: "operation",
      operationId: GUATEMALA,
    });
    const co = resolveAgentSettings(dosOperaciones, {
      kind: "operation",
      operationId: COLOMBIA,
    });
    expect(gt?.dropiTemplateGuiaId).toBe("tpl-guia-gt");
    expect(co?.dropiTemplateGuiaId).toBe("tpl-guia-co");
    expect(gt?.followupDelayMs).toBe(120_000);
    expect(co?.followupDelayMs).toBe(900_000);
  });

  it("pedir la de una operación que no tiene fila no devuelve la de la vecina", () => {
    // Colombia existe como operación pero todavía no tiene configuración: sin
    // configuración el agente no responde y se nota; con la de Guatemala
    // respondería en quetzales a un cliente colombiano y no se notaría.
    expect(
      resolveAgentSettings(soloGuatemala, {
        kind: "operation",
        operationId: COLOMBIA,
      }),
    ).toBeNull();
  });

  it("sin ninguna fila no hay configuración, en cualquier ámbito", () => {
    expect(resolveAgentSettings([], GLOBAL_AGENT_SETTINGS)).toBeNull();
    expect(
      resolveAgentSettings([], { kind: "operation", operationId: GUATEMALA }),
    ).toBeNull();
  });
});

describe("resolveAgentSettings · el ámbito global del expand", () => {
  it("con la forma de producción, la operación y el ámbito global dan la misma fila", () => {
    // Es la comprobación de no-regresión: mientras exista una sola fila y sea
    // la de Guatemala, un llamador que resuelve por operación y otro que
    // todavía lee la global leen exactamente lo mismo.
    const porOperacion = resolveAgentSettings(soloGuatemala, {
      kind: "operation",
      operationId: GUATEMALA,
    });
    const global = resolveAgentSettings(soloGuatemala, GLOBAL_AGENT_SETTINGS);
    expect(porOperacion).not.toBeNull();
    expect(global).toBe(porOperacion);
  });

  it("el ámbito global es la fila singleton, no la primera que aparezca", () => {
    const soloColombia: Fila[] = [fila({ id: 2, operationId: COLOMBIA })];
    expect(resolveAgentSettings(soloColombia, GLOBAL_AGENT_SETTINGS)).toBeNull();
    expect(
      resolveAgentSettings(dosOperaciones, GLOBAL_AGENT_SETTINGS)?.id,
    ).toBe(GLOBAL_AGENT_SETTINGS_ID);
  });
});

describe("agentSettingsScope · operación nullable hasta el contract", () => {
  it("con operación en la mano pide la de esa operación", () => {
    expect(agentSettingsScope(COLOMBIA)).toEqual({
      kind: "operation",
      operationId: COLOMBIA,
    });
  });

  it("una conversación sin operación todavía cae al ámbito global", () => {
    expect(agentSettingsScope(null)).toBe(GLOBAL_AGENT_SETTINGS);
    expect(agentSettingsScope(undefined)).toBe(GLOBAL_AGENT_SETTINGS);
  });

  it("una conversación sin operación no se cuela en la fila de otra operación", () => {
    expect(
      resolveAgentSettings(dosOperaciones, agentSettingsScope(null))?.id,
    ).toBe(GLOBAL_AGENT_SETTINGS_ID);
  });
});
