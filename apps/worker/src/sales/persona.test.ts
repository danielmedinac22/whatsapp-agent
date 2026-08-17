import { describe, expect, it } from "vitest";
import { buildSalesPersonaPrompt, isSalesAgentConfigured } from "./persona";

const COMPLETA = {
  displayName: "Sebastián",
  greeting: "¡Hola! Soy Sebastián de Vorare 👋",
  closingPush: "¿Te lo despacho hoy mismo?",
  funnelMessage: "Tenemos envío a todo el país con pago contra entrega.",
  toneInstructions: "Tutea y sé breve.",
  discountLimitPct: 15,
};

describe("isSalesAgentConfigured · cuándo existe el vendedor", () => {
  it("sin fila de configuración no hay vendedor", () => {
    // El estado de producción hoy, y el que deja a Katherine atendiendo todo.
    expect(isSalesAgentConfigured(null)).toBe(false);
  });

  it("una fila recién creada, con el nombre vacío, todavía no es un vendedor", () => {
    // Los textos son NOT NULL default '': un INSERT a medio llenar no puede ser
    // el momento en que Guatemala deja de ser atendida por Katherine.
    expect(isSalesAgentConfigured({ displayName: "" })).toBe(false);
    expect(isSalesAgentConfigured({ displayName: "   " })).toBe(false);
  });

  it("con nombre visible, la operación tiene vendedor", () => {
    expect(isSalesAgentConfigured({ displayName: "Sebastián" })).toBe(true);
  });
});

describe("buildSalesPersonaPrompt · la persona configurada", () => {
  it("se presenta con el nombre configurado para esa operación", () => {
    expect(buildSalesPersonaPrompt(COMPLETA)).toContain("Eres Sebastián");
    expect(
      buildSalesPersonaPrompt({ ...COMPLETA, displayName: "Mateo" }),
    ).toContain("Eres Mateo");
  });

  it("lleva el tono libre tal como lo escribió el admin", () => {
    const prompt = buildSalesPersonaPrompt({
      ...COMPLETA,
      toneInstructions: "Habla de usted, sin emojis, y nunca uses signos de admiración.",
    });
    expect(prompt).toContain(
      "Habla de usted, sin emojis, y nunca uses signos de admiración.",
    );
  });

  it("los tres mensajes base van etiquetados por su momento", () => {
    const prompt = buildSalesPersonaPrompt(COMPLETA);
    expect(prompt).toContain(`Saludo inicial: «${COMPLETA.greeting}»`);
    expect(prompt).toContain(`Empuje al cierre: «${COMPLETA.closingPush}»`);
    expect(prompt).toContain(`Mensaje de embudo: «${COMPLETA.funnelMessage}»`);
  });

  it("prohíbe prometer tiempos de entrega y garantías que el negocio no ofrece", () => {
    // Historia 17 del spec, y la causa número uno de devolución en
    // contraentrega: una fecha prometida que no se cumple.
    const prompt = buildSalesPersonaPrompt(COMPLETA);
    expect(prompt).toContain("NUNCA prometas una fecha");
    expect(prompt).toContain("NUNCA ofrezcas garantías");
  });

  it("dice el límite de descuento, y que el precio lo valida el sistema", () => {
    // El prompt propone; la validación decide, y vive en el constructor de
    // orden. Aquí no hay clamp ni podría haberlo: esto devuelve un string.
    const prompt = buildSalesPersonaPrompt(COMPLETA);
    expect(prompt).toContain("hasta un 15% de descuento");
    expect(prompt).toContain("lo valida el sistema al crear el pedido");
  });
});
