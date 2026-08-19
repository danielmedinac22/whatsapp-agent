import { describe, expect, it } from "vitest";
import {
  buildSalesPersonaPrompt,
  isSalesAgentConfigured,
  type SalesPersona,
} from "./persona";

const COMPLETA: SalesPersona = {
  displayName: "Sebastián",
  greeting: "¡Hola! Soy Sebastián de Vorare 👋",
  closingPush: "¿Te lo despacho hoy mismo?",
  funnelMessage: "Tenemos envío a todo el país con pago contra entrega.",
  toneInstructions: "Tutea y sé breve.",
  discountLimitPct: 15,
  discountLimitBehavior: "consultar",
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

/**
 * El borde del límite (`discount_limit_behavior`, migración `0025`).
 *
 * Un límite sin consecuencia declarada no está definido: está numerado. Estas
 * pruebas sostienen que las tres consecuencias llegan al prompt diciendo cosas
 * distintas, y que **con el límite en cero la pregunta se reformula sola** —
 * prohibir descuentos no evita que se los pidan.
 */
describe("buildSalesPersonaPrompt · qué hace cuando le piden más de lo autorizado", () => {
  it("consultar: no niega ni concede, dice que lo consulta", () => {
    const prompt = buildSalesPersonaPrompt({
      ...COMPLETA,
      discountLimitBehavior: "consultar",
    });
    expect(prompt).toContain("Si el cliente pide más de ese 15%");
    expect(prompt).toContain("lo consultas con alguien del equipo");
  });

  it("consultar no le promete al cliente que lo pasan con un asesor", () => {
    // Escalar es un acto del sistema —`agent/escalation.ts`, con su cambio de
    // `agent_mode` y su alerta— y el modelo no lo puede disparar desde el
    // texto. Prometer un traspaso que nadie va a hacer es peor que no
    // ofrecerlo: el cliente se queda esperando a una persona que no viene.
    const prompt = buildSalesPersonaPrompt({
      ...COMPLETA,
      discountLimitBehavior: "consultar",
    });
    expect(prompt).not.toContain("te paso con un asesor");
    expect(prompt).toContain("No prometas que se lo van a dar ni digas cuándo");
  });

  it("ofrecer el máximo: da el límite completo y sigue al cierre, sin escalar", () => {
    const prompt = buildSalesPersonaPrompt({
      ...COMPLETA,
      discountLimitBehavior: "ofrecer_maximo",
    });
    expect(prompt).toContain("ofrécele el 15%");
    expect(prompt).toContain("No consultes con nadie");
  });

  it("no mencionar: no lo niega ni lo concede, vuelve al producto", () => {
    const prompt = buildSalesPersonaPrompt({
      ...COMPLETA,
      discountLimitBehavior: "no_mencionar",
    });
    expect(prompt).toContain("no sigas la conversación por ahí");
    expect(prompt).toContain("vuelve a lo que gana con el producto");
    // No es «dale el máximo»: es no seguir por ahí.
    expect(prompt).not.toContain("ofrécele el 15%");
  });

  it("con el límite en cero la pregunta pasa a ser «cuando insista»", () => {
    // Nadie pide «más del 0%»: pide un descuento y le dicen que no. La pregunta
    // sigue teniendo respuesta, así que el borde no desaparece con el límite
    // en cero — cambia de redacción.
    const prompt = buildSalesPersonaPrompt({
      ...COMPLETA,
      discountLimitPct: 0,
      discountLimitBehavior: "consultar",
    });
    expect(prompt).toContain("No puedes ofrecer descuentos");
    expect(prompt).toContain("Si el cliente insiste con un descuento");
    expect(prompt).not.toContain("más de ese 0%");
  });

  it("«ofrecer el máximo» con el máximo en cero no ofrece nada", () => {
    // Escrito como si hubiera algo que ofrecer, el modelo tendría que decidir
    // cuál es ese máximo — y ahí es donde inventa una rebaja que nadie autorizó.
    const prompt = buildSalesPersonaPrompt({
      ...COMPLETA,
      discountLimitPct: 0,
      discountLimitBehavior: "ofrecer_maximo",
    });
    expect(prompt).toContain("el precio es el que es");
    expect(prompt).not.toContain("ofrécele el 0%");
  });

  it("una fila recién creada por el panel ya trae el borde seguro", () => {
    // La tabla se llena de a poco: el default de la columna es `consultar`, y
    // es el único de los tres cuyo error lo ve una persona. Una fila a medio
    // llenar no puede llegar al prompt sin consecuencia declarada.
    const reciennacida = buildSalesPersonaPrompt({
      displayName: "Sebastián",
      greeting: "",
      closingPush: "",
      funnelMessage: "",
      toneInstructions: "",
      discountLimitPct: 0,
      discountLimitBehavior: "consultar",
    });
    expect(reciennacida).toContain("Si el cliente insiste con un descuento");
    expect(reciennacida).toContain("lo consultas con alguien del equipo");
  });
});
