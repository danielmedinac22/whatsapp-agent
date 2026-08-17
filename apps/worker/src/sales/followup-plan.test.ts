import { describe, expect, it } from "vitest";
import { CONFIRMACION_PEDIDO_TEMPLATE } from "../kapso/templates";
import { SALES_ORDER_TAG } from "./order";
import {
  followupOriginFromTags,
  resolveFollowupPlan,
  SALES_FOLLOWUP_DELAY_MS,
  type FollowupPlan,
} from "./followup-plan";

/**
 * La demora que Guatemala tiene configurada hoy para el pedido web: 120.000 ms,
 * verificado en producción. No son los cinco minutos del spec —ese es el valor
 * por defecto del esquema— y por eso el plan la **recibe** en vez de suponerla.
 */
const DEMORA_ACTUAL = 120_000;

/** Las etiquetas con las que el constructor de orden marca una venta. */
const DE_VENTAS = [SALES_ORDER_TAG, "vendedor:Sebastián"];
/** Un pedido de la tienda: llega sin etiquetas nuestras. */
const DIRECTO: string[] = [];

function plan(
  tags: readonly string[],
  window: "open" | "closed" | "unknown",
): FollowupPlan {
  return resolveFollowupPlan({ tags, window, directDelayMs: DEMORA_ACTUAL });
}

describe("followupOriginFromTags · el origen lo dice la etiqueta", () => {
  it("con la etiqueta de ventas el pedido es de ventas", () => {
    expect(followupOriginFromTags(DE_VENTAS)).toBe("sales");
  });

  it("sin la etiqueta el pedido es directo", () => {
    expect(followupOriginFromTags(DIRECTO)).toBe("direct");
    expect(followupOriginFromTags(["vendedor:Sebastián"])).toBe("direct");
  });

  it("la etiqueta se reconoce aunque pase por manos humanas en el panel", () => {
    expect(followupOriginFromTags([" Origen-Ventas "])).toBe("sales");
  });
});

describe("resolveFollowupPlan · el origen decide el contenido y la demora", () => {
  it("un pedido de ventas reconoce la compra y espera diez minutos", () => {
    expect(plan(DE_VENTAS, "open")).toEqual({
      origin: "sales",
      content: "sales_purchase_ack",
      mechanism: "free_text",
      delayMs: SALES_FOLLOWUP_DELAY_MS,
      template: CONFIRMACION_PEDIDO_TEMPLATE,
    });
    expect(SALES_FOLLOWUP_DELAY_MS).toBe(10 * 60_000);
  });

  it("un pedido sin la etiqueta conserva el comportamiento de hoy, idéntico", () => {
    // El camino que factura: plantilla, contenido de siempre y la demora que
    // tenga configurada la operación. Este módulo no lo toca.
    expect(plan(DIRECTO, "closed")).toEqual({
      origin: "direct",
      content: "order_data_confirmation",
      mechanism: "template",
      delayMs: DEMORA_ACTUAL,
      template: CONFIRMACION_PEDIDO_TEMPLATE,
    });
  });

  it("el pedido directo de quien nunca escribió también sale por plantilla", () => {
    // Ventana `unknown` = no hay ningún entrante registrado, que es el caso
    // normal de quien compra en la web sin haber escrito nunca al número.
    expect(plan(DIRECTO, "unknown").mechanism).toBe("template");
    expect(plan(DIRECTO, "unknown").delayMs).toBe(DEMORA_ACTUAL);
  });

  it("la demora del pedido directo es la que reciba, no una constante", () => {
    const otra = resolveFollowupPlan({
      tags: DIRECTO,
      window: "closed",
      directDelayMs: 15 * 60_000,
    });
    expect(otra.delayMs).toBe(15 * 60_000);
  });
});

describe("resolveFollowupPlan · la ventana decide el mecanismo", () => {
  it("un pedido de ventas con la ventana cerrada sale por plantilla", () => {
    // El borde que obliga a separar las dos dimensiones: si el pedido se
    // atrasó más de 24 horas en la cola de reintentos, su ventana se cerró.
    // Atar el mecanismo al origen mandaría texto libre y fallaría en silencio,
    // justo en el caso donde ya hubo un problema.
    const salesCerrado = plan(DE_VENTAS, "closed");
    expect(salesCerrado.mechanism).toBe("template");
    expect(salesCerrado.origin).toBe("sales");
    expect(salesCerrado.content).toBe("sales_purchase_ack");
    expect(salesCerrado.delayMs).toBe(SALES_FOLLOWUP_DELAY_MS);
  });

  it("un pedido de ventas con la ventana en duda también sale por plantilla", () => {
    expect(plan(DE_VENTAS, "unknown").mechanism).toBe("template");
  });

  it("el mecanismo no depende del origen: mismo origen, ventanas distintas", () => {
    expect(plan(DE_VENTAS, "open").mechanism).toBe("free_text");
    expect(plan(DE_VENTAS, "closed").mechanism).toBe("template");
    // Y al revés: mismo estado de ventana, orígenes distintos, mismo mecanismo.
    expect(plan(DIRECTO, "open").mechanism).toBe("free_text");
  });

  it("el contenido no depende de la ventana: misma ventana, orígenes distintos", () => {
    expect(plan(DE_VENTAS, "closed").content).toBe("sales_purchase_ack");
    expect(plan(DIRECTO, "closed").content).toBe("order_data_confirmation");
  });

  it("la plantilla de respaldo existe siempre, incluso en texto libre", () => {
    // Un plan sin plantilla es un mensaje que puede quedarse sin forma de salir.
    for (const window of ["open", "closed", "unknown"] as const) {
      for (const tags of [DE_VENTAS, DIRECTO]) {
        expect(plan(tags, window).template).toBe(CONFIRMACION_PEDIDO_TEMPLATE);
      }
    }
  });
});
