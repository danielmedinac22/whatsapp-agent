import { describe, expect, it } from "vitest";
import {
  CAPI_GRAPH_VERSION_ENV,
  CAPI_MODE_ENV,
  CAPI_TEST_CODE_ENV,
  CAPI_TOKEN_ENV,
  DEFAULT_GRAPH_VERSION,
  capiDispatch,
  offReasonText,
  resolveCapiDispatch,
} from "./send-mode";
import { datasetEventsUrl } from "./send";

const CON_TODO = {
  mode: "live",
  token: "SYSUSR-token",
  testEventCode: "TEST12345",
  graphVersion: null,
};

describe("resolveCapiDispatch · el reporte a Meta arranca apagado", () => {
  it("sin variable no se reporta nada", () => {
    expect(resolveCapiDispatch({ ...CON_TODO, mode: undefined })).toEqual({
      mode: "off",
      reason: "switch-off",
    });
    expect(resolveCapiDispatch({ ...CON_TODO, mode: null })).toEqual({
      mode: "off",
      reason: "switch-off",
    });
    expect(resolveCapiDispatch({ ...CON_TODO, mode: "   " })).toEqual({
      mode: "off",
      reason: "switch-off",
    });
  });

  it("un valor que no entendemos NO enciende el reporte", () => {
    // Es al revés de lo que suele hacerse, y es deliberado: `true` y `1`
    // parecen «encendido» y no lo son. La dirección segura del error es no
    // reportar — un evento mal mandado envenena el aprendizaje de la pauta y
    // eso no se revierte borrando datos.
    for (const raro of ["true", "1", "on", "si", "yes", "prod", "liv", "real"]) {
      expect(resolveCapiDispatch({ ...CON_TODO, mode: raro })).toEqual({
        mode: "off",
        reason: "unknown-value",
      });
    }
  });

  it("solo `test` y `live` encienden, con espacios y mayúsculas", () => {
    expect(resolveCapiDispatch({ ...CON_TODO, mode: "  LIVE " }).mode).toBe("live");
    expect(resolveCapiDispatch({ ...CON_TODO, mode: "Test" }).mode).toBe("test");
  });
});

describe("resolveCapiDispatch · sin credencial no se ejecuta, diga lo que diga el interruptor", () => {
  it("el interruptor encendido sin token queda apagado", () => {
    // Es la condición de hoy: no hay ninguna variable de Meta en el entorno y
    // el permiso `whatsapp_business_manage_events` todavía no existe. Que la
    // ausencia del token apague el camino por sí sola es lo que hace verdadera
    // la frase «sin credencial esto no se ejecuta» sin depender de que alguien
    // se acuerde de apagarlo.
    for (const mode of ["live", "test"]) {
      expect(resolveCapiDispatch({ ...CON_TODO, mode, token: null })).toEqual({
        mode: "off",
        reason: "no-token",
      });
      expect(resolveCapiDispatch({ ...CON_TODO, mode, token: "   " })).toEqual({
        mode: "off",
        reason: "no-token",
      });
    }
  });

  it("el modo de prueba sin código de prueba queda apagado", () => {
    // Postear en «modo prueba» sin el código NO es una prueba: es un evento
    // real que cuenta como conversión. Un modo que miente sobre lo que hace es
    // peor que un modo que no arranca.
    expect(
      resolveCapiDispatch({ ...CON_TODO, mode: "test", testEventCode: null }),
    ).toEqual({ mode: "off", reason: "no-test-code" });
  });

  it("el modo real no necesita código de prueba", () => {
    const r = resolveCapiDispatch({
      ...CON_TODO,
      mode: "live",
      testEventCode: null,
    });
    expect(r).toEqual({
      mode: "live",
      token: "SYSUSR-token",
      graphVersion: DEFAULT_GRAPH_VERSION,
    });
  });

  it("apagado nunca lleva token: no hay forma de mandar con él", () => {
    // El tipo lo garantiza, y esto lo fija: la unión `off` no tiene campo
    // `token`, así que un envío que se olvide de comprobar el modo no compila.
    const r = resolveCapiDispatch({ ...CON_TODO, mode: "nada-de-esto" });
    expect(r).not.toHaveProperty("token");
  });
});

describe("resolveCapiDispatch · la versión de la Graph API se fija, no se hereda", () => {
  it("sin variable usa la vigente y no la que Meta tenga por defecto", () => {
    // Heredar la de Meta significa que el día que ellos cambien su default, el
    // evento empieza a viajar distinto sin que nadie toque nada — y la forma de
    // este flujo cambia entre versiones.
    expect(resolveCapiDispatch(CON_TODO)).toMatchObject({
      graphVersion: DEFAULT_GRAPH_VERSION,
    });
  });

  it("se puede fijar otra sin tocar código", () => {
    expect(
      resolveCapiDispatch({ ...CON_TODO, graphVersion: " v27.0 " }),
    ).toMatchObject({ graphVersion: "v27.0" });
  });
});

describe("capiDispatch · el proceso arranca sin reportar", () => {
  it("mientras nadie ponga las variables, no hay reporte", () => {
    const antes = {
      mode: process.env[CAPI_MODE_ENV],
      token: process.env[CAPI_TOKEN_ENV],
      code: process.env[CAPI_TEST_CODE_ENV],
      version: process.env[CAPI_GRAPH_VERSION_ENV],
    };
    delete process.env[CAPI_MODE_ENV];
    delete process.env[CAPI_TOKEN_ENV];
    delete process.env[CAPI_TEST_CODE_ENV];
    delete process.env[CAPI_GRAPH_VERSION_ENV];
    try {
      expect(capiDispatch()).toEqual({ mode: "off", reason: "switch-off" });
    } finally {
      if (antes.mode !== undefined) process.env[CAPI_MODE_ENV] = antes.mode;
      if (antes.token !== undefined) process.env[CAPI_TOKEN_ENV] = antes.token;
      if (antes.code !== undefined) process.env[CAPI_TEST_CODE_ENV] = antes.code;
      if (antes.version !== undefined) {
        process.env[CAPI_GRAPH_VERSION_ENV] = antes.version;
      }
    }
  });
});

describe("offReasonText · el motivo se lee sin abrir el código", () => {
  it("cada motivo nombra la variable que lo destraba", () => {
    expect(offReasonText("switch-off")).toContain(CAPI_MODE_ENV);
    expect(offReasonText("unknown-value")).toContain(CAPI_MODE_ENV);
    expect(offReasonText("no-token")).toContain(CAPI_TOKEN_ENV);
    expect(offReasonText("no-token")).toContain("whatsapp_business_manage_events");
    expect(offReasonText("no-test-code")).toContain(CAPI_TEST_CODE_ENV);
  });
});

describe("datasetEventsUrl · el destino es un dataset, no el píxel", () => {
  it("postea a /{version}/{dataset}/events", () => {
    // La trampa más cara del proyecto: el píxel es un destino REAL y
    // EQUIVOCADO. Mandar ahí no da error ni alarma, y nadie se entera hasta
    // preguntarse por qué la pauta no aprende.
    expect(datasetEventsUrl("v26.0", "1234567890")).toBe(
      "https://graph.facebook.com/v26.0/1234567890/events",
    );
  });

  it("un identificador con una barra no puede cambiar la ruta del POST", () => {
    // Un valor mal cargado desde el panel no puede convertirse en otra ruta:
    // un evento mandado a otro endpoint es el fallo silencioso otra vez.
    expect(datasetEventsUrl("v26.0", "123/../me")).toBe(
      "https://graph.facebook.com/v26.0/123%2F..%2Fme/events",
    );
  });
});
