import { describe, expect, it } from "vitest";
import { salesAgentIsConfigured, salesAgentSettings } from "@wa/db";
import {
  activeSalesTonePreset,
  normalizeSalesAgentSettings,
  salesAgentSettingsInput,
  salesDiscountState,
  SALES_AGENT_DEFAULTS,
  SALES_TONE_PRESETS,
  type SalesAgentSettingsInput,
} from "@wa/shared";

/**
 * Las reglas de la pantalla de configuración del vendedor, ejercidas sin panel
 * y sin base: son funciones puras y fixtures, como el resto del módulo.
 *
 * Lo que están cuidando no es el formulario sino la operación que factura: con
 * `sales_agent_settings` vacía, Guatemala la atiende el agente de confirmación,
 * y el único acto capaz de cambiar eso es **encender el interruptor** de esta
 * pantalla (`0033`). Todo lo demás —guardar el nombre, el tono, el límite, el
 * modelo— tiene que poder hacerse sin encender a nadie.
 */

/** Lo que manda la pantalla recién abierta contra la tabla vacía de hoy. */
const EN_BLANCO: SalesAgentSettingsInput = {
  enabled: false,
  displayName: "",
  greeting: "",
  closingPush: "",
  funnelMessage: "",
  toneInstructions: "",
  discountLimitPct: 0,
  discountLimitBehavior: "consultar",
  model: "openai/gpt-5.4-mini",
  reasoningEffort: "low",
};

const COMPLETA: SalesAgentSettingsInput = {
  enabled: true,
  displayName: "Sebastián",
  greeting: "¡Hola! Soy Sebastián de Vorare 👋",
  closingPush: "¿Te lo aparto? Pagas cuando lo recibes.",
  funnelMessage: "Te dejo el enlace por si quieres verlo con calma.",
  toneInstructions: "Cercano y directo, sin tratar de usted.",
  discountLimitPct: 10,
  discountLimitBehavior: "consultar",
  model: "openai/gpt-5.4-mini",
  reasoningEffort: "low",
};

describe("qué acepta guardar la pantalla del vendedor", () => {
  it("deja guardar la pantalla a medio llenar, sin exigir el nombre", () => {
    // Es la mitad del mecanismo de la no-regresión: si el nombre fuera
    // obligatorio, guardar un borrador del tono sería el acto que enciende al
    // vendedor sobre la operación que factura.
    expect(salesAgentSettingsInput.safeParse(EN_BLANCO).success).toBe(true);
  });

  it("guardar la pantalla a medio llenar deja al vendedor apagado", () => {
    // El listón es el del worker, no uno propio del panel: el mismo que decide
    // en cada mensaje entrante quién contesta.
    const guardado = normalizeSalesAgentSettings(EN_BLANCO);
    expect(salesAgentIsConfigured(guardado)).toBe(false);
  });

  it("un nombre de puros espacios no enciende al vendedor", () => {
    // Escribir «   » y guardar no puede ser la forma accidental de sacar a
    // Katherine de la conversación.
    const guardado = normalizeSalesAgentSettings({
      ...COMPLETA,
      displayName: "   ",
    });
    expect(guardado.displayName).toBe("");
    expect(salesAgentIsConfigured(guardado)).toBe(false);
  });

  it("escribir un nombre es lo que enciende al vendedor", () => {
    expect(salesAgentIsConfigured(normalizeSalesAgentSettings(COMPLETA))).toBe(
      true,
    );
  });

  it("acepta cero en el límite de descuento", () => {
    const r = salesAgentSettingsInput.safeParse({
      ...COMPLETA,
      discountLimitPct: 0,
    });
    expect(r.success).toBe(true);
  });

  it("no acepta un límite que la tabla rechazaría", () => {
    // El `check` de la tabla es `between 0 and 100`. Repetirlo acá es que el
    // error vuelva como un mensaje del formulario y no como un 500 de la base.
    for (const pct of [-1, 101, 250]) {
      expect(
        salesAgentSettingsInput.safeParse({ ...COMPLETA, discountLimitPct: pct })
          .success,
      ).toBe(false);
    }
  });

  it("no acepta un límite con decimales", () => {
    expect(
      salesAgentSettingsInput.safeParse({ ...COMPLETA, discountLimitPct: 7.5 })
        .success,
    ).toBe(false);
  });

  it("no deja quedarse sin modelo", () => {
    // Un modelo vacío no es una configuración a medio llenar: es el turno de
    // venta fallando contra el proveedor.
    expect(
      salesAgentSettingsInput.safeParse({ ...COMPLETA, model: "" }).success,
    ).toBe(false);
  });

  it("no deja elegir un esfuerzo que el proveedor no conoce", () => {
    expect(
      salesAgentSettingsInput.safeParse({ ...COMPLETA, reasoningEffort: "máximo" })
        .success,
    ).toBe(false);
  });
});

describe("lo que queda escrito en la fila", () => {
  it("recorta los textos para que la fila diga lo que se va a usar", () => {
    // El worker recorta al leer —para el listón y para componer el prompt—, así
    // que guardar los espacios dejaría una fila que se lee distinta de como se
    // ve en la pantalla.
    const guardado = normalizeSalesAgentSettings({
      ...COMPLETA,
      displayName: "  Sebastián  ",
      greeting: "  ¡Hola!  ",
      toneInstructions: "\n Cercano. \n",
    });
    expect(guardado.displayName).toBe("Sebastián");
    expect(guardado.greeting).toBe("¡Hola!");
    expect(guardado.toneInstructions).toBe("Cercano.");
  });

  it("no toca el límite de descuento", () => {
    expect(normalizeSalesAgentSettings(COMPLETA).discountLimitPct).toBe(10);
    expect(normalizeSalesAgentSettings(EN_BLANCO).discountLimitPct).toBe(0);
  });
});

describe("cuándo el límite es alarma y cuándo es el estado seguro", () => {
  it("cero es el estado seguro, no una alarma", () => {
    // Prohibir descuentos no es una advertencia: es el default de la columna y
    // el estado en el que nadie regala margen. Por eso va en verde.
    expect(salesDiscountState(0)).toBe("prohibido");
  });

  it("autorizar a bajar el precio es lo que se marca", () => {
    expect(salesDiscountState(1)).toBe("autorizado");
    expect(salesDiscountState(10)).toBe("autorizado");
    expect(salesDiscountState(100)).toBe("autorizado");
  });
});

describe("el preset de tono es un punto de partida, no una opción cerrada", () => {
  it("elegir un preset deja su tarjeta marcada", () => {
    const cercano = SALES_TONE_PRESETS[0];
    expect(cercano).toBeDefined();
    expect(activeSalesTonePreset(cercano!.text)).toBe(cercano!.key);
  });

  it("editar el texto lo vuelve propio y ninguna tarjeta queda marcada", () => {
    const cercano = SALES_TONE_PRESETS[0];
    expect(activeSalesTonePreset(`${cercano!.text} Y usa «vos».`)).toBeNull();
  });

  it("el campo vacío no marca ninguna", () => {
    expect(activeSalesTonePreset("")).toBeNull();
    expect(activeSalesTonePreset("   ")).toBeNull();
  });

  it("ningún preset escribe el país de nadie", () => {
    // Un preset que rellena «guatemalteco neutro» dentro de la configuración
    // del vendedor colombiano es la fuga entre operaciones de siempre, escrita
    // por un clic. Lo del país lo escribe quien configura.
    for (const preset of SALES_TONE_PRESETS) {
      expect(preset.text).not.toMatch(/guatemal|colombi|quetzal|GTQ|COP/i);
    }
  });
});

describe("la pantalla en blanco muestra lo que la base usaría", () => {
  // No es una comodidad: con la tabla vacía, lo que se ve en los campos es lo
  // que el vendedor usaría si alguien lo encendiera. Si la pantalla inventara
  // sus propios valores por defecto, mostraría una configuración que no existe.
  it("los valores por defecto son los de la tabla, no los de la pantalla", () => {
    expect(SALES_AGENT_DEFAULTS.displayName).toBe(
      salesAgentSettings.displayName.default,
    );
    expect(SALES_AGENT_DEFAULTS.discountLimitPct).toBe(
      salesAgentSettings.discountLimitPct.default,
    );
    expect(SALES_AGENT_DEFAULTS.model).toBe(salesAgentSettings.model.default);
    expect(SALES_AGENT_DEFAULTS.reasoningEffort).toBe(
      salesAgentSettings.reasoningEffort.default,
    );
  });

  it("la pantalla en blanco prohíbe descuentos", () => {
    expect(salesDiscountState(SALES_AGENT_DEFAULTS.discountLimitPct)).toBe(
      "prohibido",
    );
  });
});
