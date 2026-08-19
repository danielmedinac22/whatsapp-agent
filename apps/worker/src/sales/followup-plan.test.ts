import { describe, expect, it } from "vitest";
import { CONFIRMACION_PEDIDO_TEMPLATE } from "../kapso/templates";
import { SALES_ORDER_TAG } from "./order";
import {
  decideFollowupAction,
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

  it("la ventana decide el mecanismo dentro de un mismo origen", () => {
    expect(plan(DE_VENTAS, "open").mechanism).toBe("free_text");
    expect(plan(DE_VENTAS, "closed").mechanism).toBe("template");
  });

  it("el pedido directo sale por plantilla aunque la ventana esté abierta", () => {
    // Corrección del 18-ago-2026, al cablear el ticket 05. El spec suponía que
    // quien compra en la tienda no escribió nunca y por lo tanto tiene la
    // ventana cerrada. Es falso en un caso ordinario: un cliente que escribió
    // hace tres horas y no volvió a escribir después del pedido tiene la
    // ventana ABIERTA, y hoy recibe plantilla. Mandarle texto libre sería un
    // cambio de comportamiento sobre el camino que factura, y el criterio que
    // manda en el ticket es que un pedido no originado en ventas conserve
    // exactamente el flujo de hoy.
    for (const window of ["open", "closed", "unknown"] as const) {
      expect(plan(DIRECTO, window).mechanism).toBe("template");
    }
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

// ── El heurístico de «el cliente ya respondió» ──────────────────────────────
//
// Es el riesgo R1 de la no-regresión, y el criterio que más importa del ticket
// 05. La regla lleva 1.732 pedidos funcionando y NO se baja: se le pone una
// condición de origen delante.

describe("decideFollowupAction · el heurístico distingue el origen", () => {
  function decidir(
    tags: readonly string[],
    window: "open" | "closed" | "unknown",
    respondio: boolean,
  ) {
    return decideFollowupAction({
      tags,
      window,
      directDelayMs: DEMORA_ACTUAL,
      customerRepliedSinceOrder: respondio,
    });
  }

  it("un pedido web con respuesta reciente se sigue auto-confirmando", () => {
    // El comportamiento de hoy, intacto: si el cliente escribió después de que
    // llegó el pedido, no sale plantilla y el pedido queda confirmado.
    expect(decidir(DIRECTO, "open", true)).toEqual({ kind: "auto_confirm" });
    expect(decidir(DIRECTO, "closed", true)).toEqual({ kind: "auto_confirm" });
  });

  it("un pedido de ventas con mensajes recientes NO queda auto-confirmado", () => {
    // El fallo que esperaba a ocurrir. En una venta la conversación *es* el
    // origen: el cliente acaba de hablar con el vendedor, así que siempre habrá
    // un entrante reciente. Con el heurístico crudo, todo pedido de ventas
    // diría «confirmado» sin que nadie hubiera verificado la dirección — y en
    // contraentrega la dirección sin verificar es la causa número uno de
    // devolución.
    const accion = decidir(DE_VENTAS, "open", true);
    expect(accion.kind).toBe("send");
    if (accion.kind !== "send") throw new Error("se esperaba un envío");
    expect(accion.plan.content).toBe("sales_purchase_ack");
  });

  it("no se salta la confirmación: el pedido de ventas siempre recibe el toque", () => {
    // La verificación de dirección se conserva, que es donde se sostiene el
    // contraentrega. Con o sin respuesta reciente, sale mensaje.
    for (const respondio of [true, false]) {
      expect(decidir(DE_VENTAS, "open", respondio).kind).toBe("send");
      expect(decidir(DE_VENTAS, "closed", respondio).kind).toBe("send");
    }
  });

  it("sin respuesta reciente, los dos orígenes reciben su primer toque", () => {
    expect(decidir(DIRECTO, "closed", false).kind).toBe("send");
    expect(decidir(DE_VENTAS, "closed", false).kind).toBe("send");
  });

  it("las cuatro combinaciones de origen y ventana, con respuesta reciente", () => {
    // El cuadro completo que pide el ticket. La respuesta reciente es lo que
    // hace interesante el cruce: es el estado normal de una venta y el estado
    // que dispara el heurístico en un pedido web.
    const cuadro = (["open", "closed"] as const).flatMap((window) =>
      [DIRECTO, DE_VENTAS].map((tags) => ({
        window,
        origen: tags === DE_VENTAS ? "ventas" : "directo",
        accion: decidir(tags, window, true),
      })),
    );
    expect(
      cuadro.map((c) => [
        c.origen,
        c.window,
        c.accion.kind,
        c.accion.kind === "send" ? c.accion.plan.mechanism : "—",
      ]),
    ).toEqual([
      // El pedido web con respuesta reciente se auto-confirma, abierta o no.
      ["directo", "open", "auto_confirm", "—"],
      // El de ventas con la ventana abierta: texto libre, y nunca confirmado.
      ["ventas", "open", "send", "free_text"],
      ["directo", "closed", "auto_confirm", "—"],
      // El de ventas atascado más de 24 h: plantilla, no un fallo en silencio.
      ["ventas", "closed", "send", "template"],
    ]);
  });
});
