import { describe, expect, it } from "vitest";
import { composeEffectivePrompt } from "./effective-prompt";
import type { SalesPersona } from "../sales/persona";

/**
 * El prompt de Katherine tal como vive hoy en `agent_settings.system_prompt`,
 * recortado. Las frases son distintivas a propósito: si aparecieran en el
 * prompt del vendedor se verían.
 */
const PROMPT_KATHERINE =
  "Eres Katherine, del equipo de logística. Confirmas pedidos ya realizados y verificas la dirección de entrega.";

const BLOQUE_SHOPIFY =
  "## Contexto del cliente (Shopify)\nEl cliente realizó un pedido el 02 de agosto de 2026.";

const BLOQUE_DROPI =
  "## Estado de pedidos en Dropi\n- Pedido Dropi #942698: en tránsito · guía 77001";

/** La configuración de ventas de una operación, con todos los campos llenos. */
const SEBASTIAN: SalesPersona = {
  displayName: "Sebastián",
  greeting: "¡Hola! Soy Sebastián de Vorare 👋",
  closingPush: "¿Te lo despacho hoy mismo?",
  funnelMessage: "Tenemos envío a todo el país con pago contra entrega.",
  toneInstructions: "Tutea, usa emojis con moderación y nunca escribas párrafos largos.",
  discountLimitPct: 10,
  discountLimitBehavior: "consultar",
};

const BLOQUE_PRODUCTO =
  "## Producto del que te escriben\nProducto: REVITALHAIR Serum Capilar\nPrecio: 199 GTQ";

/** La pregunta al lead cuando la cascada dudó, con su lista corta. */
const BLOQUE_PREGUNTA =
  "## Todavía no sabes de qué producto te escriben\n- REVITALHAIR - DHT ANTICALVICIE\n- REVITALHAIR - DHT BLOCKER ANTICALVICIE";

describe("composeEffectivePrompt · el prompt del agente de confirmación", () => {
  it("es el prompt configurado más sus bloques, en orden y separados por una línea en blanco", () => {
    // Carácter por carácter lo que el runner enviaba antes de que existiera un
    // segundo agente: es la no-regresión de Katherine, que factura hoy.
    const prompt = composeEffectivePrompt({
      agent: "confirmation",
      basePrompt: PROMPT_KATHERINE,
      blocks: [BLOQUE_SHOPIFY, BLOQUE_DROPI],
    });
    expect(prompt).toBe(
      `${PROMPT_KATHERINE}\n\n${BLOQUE_SHOPIFY}\n\n${BLOQUE_DROPI}`,
    );
  });

  it("un bloque que no aplica no deja hueco ni línea de más", () => {
    const prompt = composeEffectivePrompt({
      agent: "confirmation",
      basePrompt: PROMPT_KATHERINE,
      blocks: [null, BLOQUE_DROPI],
    });
    expect(prompt).toBe(`${PROMPT_KATHERINE}\n\n${BLOQUE_DROPI}`);
  });

  it("sin ningún bloque es exactamente el prompt configurado", () => {
    expect(
      composeEffectivePrompt({
        agent: "confirmation",
        basePrompt: PROMPT_KATHERINE,
        blocks: [null, null],
      }),
    ).toBe(PROMPT_KATHERINE);
  });
});

describe("composeEffectivePrompt · el prompt del vendedor", () => {
  it("lleva su nombre, su tono y los tres mensajes base", () => {
    const prompt = composeEffectivePrompt({
      agent: "sales",
      persona: SEBASTIAN,
      productBlock: null,
    });
    expect(prompt).toContain("Sebastián");
    expect(prompt).toContain(SEBASTIAN.toneInstructions);
    expect(prompt).toContain(SEBASTIAN.greeting);
    expect(prompt).toContain(SEBASTIAN.closingPush);
    expect(prompt).toContain(SEBASTIAN.funnelMessage);
  });

  it("sin producto identificado va la pregunta, acotada a los candidatos que la cascada registró", () => {
    // La otra mitad de `ingesta/05`: la lista corta sale de
    // `conversations.product_candidate_ids`, que la 0026 registra. Antes no
    // había de dónde sacarla y lo único ofrecible era el catálogo entero.
    const prompt = composeEffectivePrompt({
      agent: "sales",
      persona: SEBASTIAN,
      productBlock: null,
      questionBlock: BLOQUE_PREGUNTA,
    });
    expect(prompt).toContain("REVITALHAIR - DHT ANTICALVICIE");
    expect(prompt.endsWith(`\n\n${BLOQUE_PREGUNTA}`)).toBe(true);
  });

  it("con producto identificado hay ficha y no hay pregunta: son excluyentes", () => {
    // Preguntarle al lead de qué producto habla cuando ya se sabe es pedirle
    // al modelo que pregunte por lo que tiene escrito arriba.
    const prompt = composeEffectivePrompt({
      agent: "sales",
      persona: SEBASTIAN,
      productBlock: BLOQUE_PRODUCTO,
      questionBlock: null,
    });
    expect(prompt).toContain("## Producto del que te escriben");
    expect(prompt).not.toContain("Todavía no sabes de qué producto");
  });

  it("con producto identificado, la ficha va pegada al final", () => {
    const prompt = composeEffectivePrompt({
      agent: "sales",
      persona: SEBASTIAN,
      productBlock: BLOQUE_PRODUCTO,
    });
    expect(prompt).toContain("REVITALHAIR Serum Capilar");
    expect(prompt.endsWith(`\n\n${BLOQUE_PRODUCTO}`)).toBe(true);
  });

  it("sin producto identificado no hay ficha, y la instrucción de no inventarla sigue", () => {
    // El borde del ticket: mientras el producto no esté identificado, Sebastián
    // conversa sin contexto de producto y **sin inventarlo**.
    const prompt = composeEffectivePrompt({
      agent: "sales",
      persona: SEBASTIAN,
      productBlock: null,
    });
    expect(prompt).not.toContain("## Producto del que te escriben");
    expect(prompt).not.toContain("REVITALHAIR");
    expect(prompt).toContain("NUNCA inventes características");
  });

  it("menciona el límite de descuento para que negocie con criterio", () => {
    const prompt = composeEffectivePrompt({
      agent: "sales",
      persona: SEBASTIAN,
      productBlock: null,
    });
    expect(prompt).toContain("10%");
  });

  it("con límite cero prohíbe descuentos en vez de ofrecer un cero por ciento", () => {
    const prompt = composeEffectivePrompt({
      agent: "sales",
      persona: { ...SEBASTIAN, discountLimitPct: 0 },
      productBlock: null,
    });
    expect(prompt).toContain("No puedes ofrecer descuentos");
    expect(prompt).not.toContain("hasta un 0%");
  });

  it("los campos que el panel todavía no llenó no dejan secciones vacías", () => {
    // La fila puede existir con solo `operation_id`: los textos son NOT NULL
    // default ''. Un «Saludo:» sin saludo es ruido que el modelo interpreta.
    const prompt = composeEffectivePrompt({
      agent: "sales",
      persona: {
        displayName: "Sebastián",
        greeting: "",
        closingPush: "",
        funnelMessage: "",
        toneInstructions: "",
        discountLimitPct: 0,
        discountLimitBehavior: "consultar",
      },
      productBlock: null,
    });
    expect(prompt).not.toContain("# Mensajes base");
    expect(prompt).not.toContain("# Tu tono");
    expect(prompt).toContain("Eres Sebastián");
  });
});

describe("composeEffectivePrompt · la configuración no se filtra entre agentes", () => {
  it("el prompt de Katherine no incorpora ningún campo de la configuración de ventas", () => {
    // El borde duro del ticket. Es el mismo aislamiento que la migración
    // multi-operación exigió entre países, ahora entre agentes: Katherine
    // confirma pedidos y no negocia — un límite de descuento en su prompt es
    // una rebaja que alguien va a pedirle a la persona equivocada.
    const prompt = composeEffectivePrompt({
      agent: "confirmation",
      basePrompt: PROMPT_KATHERINE,
      blocks: [BLOQUE_SHOPIFY, BLOQUE_DROPI],
    });
    expect(prompt).not.toContain(SEBASTIAN.displayName);
    expect(prompt).not.toContain(SEBASTIAN.greeting);
    expect(prompt).not.toContain(SEBASTIAN.closingPush);
    expect(prompt).not.toContain(SEBASTIAN.funnelMessage);
    expect(prompt).not.toContain(SEBASTIAN.toneInstructions);
    expect(prompt).not.toContain("descuento");
    expect(prompt).not.toContain("10%");
  });

  it("el prompt del vendedor no incorpora nada de la configuración de confirmación", () => {
    const prompt = composeEffectivePrompt({
      agent: "sales",
      persona: SEBASTIAN,
      productBlock: BLOQUE_PRODUCTO,
    });
    expect(prompt).not.toContain(PROMPT_KATHERINE);
    expect(prompt).not.toContain("Katherine");
    expect(prompt).not.toContain(BLOQUE_SHOPIFY);
    expect(prompt).not.toContain(BLOQUE_DROPI);
  });

  it("ninguno de los dos puede recibir las piezas del otro: no hay dónde escribirlas", () => {
    // Esta prueba es del compilador, no del runtime, y por eso el cuerpo es
    // trivial: el tipo de entrada es una unión discriminada, así que la rama de
    // confirmación no tiene campo `persona` y la de ventas no tiene
    // `basePrompt`. Se deja escrita porque el que venga puede ensanchar el tipo
    // sin ver qué estaba sosteniendo.
    // @ts-expect-error — el agente de confirmación no tiene persona de ventas.
    composeEffectivePrompt({ agent: "confirmation", basePrompt: "x", blocks: [], persona: SEBASTIAN });
    // @ts-expect-error — el vendedor no tiene prompt base que sobrescribir.
    composeEffectivePrompt({ agent: "sales", persona: SEBASTIAN, productBlock: null, basePrompt: PROMPT_KATHERINE });
    expect(true).toBe(true);
  });
});
