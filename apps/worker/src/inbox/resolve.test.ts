import { describe, expect, it } from "vitest";
import {
  type InboxFacts,
  type OrderFacts,
  type OrderLogisticsStatus,
  type OrderPhase,
  type OrderPipelineStatus,
  resolveInbox,
  resolveOrderPhase,
} from "./resolve";

// Las fechas son días distintos de un mismo mes para que el orden se lea a ojo:
// lo único que el ruteo compara es «¿el clic es posterior al último pedido?».
const dia = (d: number) => new Date(Date.UTC(2026, 6, d, 12, 0, 0));

/** Un pedido de tienda con la logística que se le indique (o sin ella). */
function pedido(
  createdAt: Date,
  logisticsStatus: OrderLogisticsStatus | null,
  pipelineStatus: OrderPipelineStatus = "confirmed",
): OrderFacts {
  return { createdAt, pipelineStatus, logisticsStatus };
}

const sinNada: InboxFacts = { lastAdClickAt: null, orders: [] };

describe("resolveInbox · las cuatro reglas", () => {
  it("un lead que llegó por un anuncio y no tiene pedido es de ventas", () => {
    expect(resolveInbox({ lastAdClickAt: dia(10), orders: [] })).toEqual({
      inbox: "ventas",
      rule: "no_order",
    });
  });

  it("un contacto sin pedido ni atribución es de ventas: un mensaje sin pedido es un lead", () => {
    expect(resolveInbox(sinNada)).toEqual({ inbox: "ventas", rule: "no_order" });
  });

  it("un pedido recién creado, todavía sin logística, es de operaciones", () => {
    expect(
      resolveInbox({
        lastAdClickAt: null,
        orders: [pedido(dia(10), null, "received")],
      }),
    ).toEqual({ inbox: "operaciones", rule: "order_in_progress" });
  });

  it("un pedido en tránsito es de operaciones", () => {
    expect(
      resolveInbox({ lastAdClickAt: null, orders: [pedido(dia(10), "en_transito")] }),
    ).toEqual({ inbox: "operaciones", rule: "order_in_progress" });
  });

  it("un pedido entregado sin clic posterior sigue en operaciones", () => {
    expect(
      resolveInbox({ lastAdClickAt: null, orders: [pedido(dia(10), "entregado")] }),
    ).toEqual({ inbox: "operaciones", rule: "order_finished" });
  });

  it("un pedido cancelado en la tienda sin clic posterior sigue en operaciones", () => {
    expect(
      resolveInbox({
        lastAdClickAt: null,
        orders: [pedido(dia(10), null, "cancelled")],
      }),
    ).toEqual({ inbox: "operaciones", rule: "order_finished" });
  });

  it("un pedido anulado en logística sin clic posterior sigue en operaciones", () => {
    expect(
      resolveInbox({ lastAdClickAt: null, orders: [pedido(dia(10), "anulada")] }),
    ).toEqual({ inbox: "operaciones", rule: "order_finished" });
  });
});

describe("resolveInbox · el recomprador", () => {
  it("un pedido entregado en el pasado más un clic de anuncio posterior vuelve a ventas", () => {
    // El caso que rompe los diseños ingenuos: «¿tiene pedido? → operaciones»
    // se lo comería. Un clic nuevo es intención de compra nueva.
    expect(
      resolveInbox({
        lastAdClickAt: dia(20),
        orders: [pedido(dia(1), "entregado")],
      }),
    ).toEqual({ inbox: "ventas", rule: "ad_click_after_last_order" });
  });

  it("un clic anterior al pedido no devuelve la conversación a ventas: esa venta ya cerró", () => {
    // Es el lead que Sebastián convirtió: el clic trajo la venta, la venta
    // creó el pedido, y la conversación pasa a operaciones sola.
    expect(
      resolveInbox({
        lastAdClickAt: dia(1),
        orders: [pedido(dia(3), null, "received")],
      }),
    ).toEqual({ inbox: "operaciones", rule: "order_in_progress" });
  });

  it("un clic en el mismo instante que el pedido no cuenta como posterior", () => {
    expect(
      resolveInbox({
        lastAdClickAt: dia(3),
        orders: [pedido(dia(3), "entregado")],
      }),
    ).toEqual({ inbox: "operaciones", rule: "order_finished" });
  });

  it("con varios pedidos, el clic se compara contra el más reciente y no contra el primero", () => {
    const pedidos = [pedido(dia(1), "entregado"), pedido(dia(15), "en_transito")];
    // El clic cayó entre los dos: fue el que produjo el segundo pedido.
    expect(resolveInbox({ lastAdClickAt: dia(10), orders: pedidos })).toEqual({
      inbox: "operaciones",
      rule: "order_in_progress",
    });
    // Un clic después del segundo sí es intención nueva.
    expect(resolveInbox({ lastAdClickAt: dia(20), orders: pedidos })).toEqual({
      inbox: "ventas",
      rule: "ad_click_after_last_order",
    });
  });

  it("los pedidos se pueden pasar en cualquier orden", () => {
    const desordenados = [pedido(dia(15), "en_transito"), pedido(dia(1), "entregado")];
    expect(resolveInbox({ lastAdClickAt: dia(10), orders: desordenados })).toEqual({
      inbox: "operaciones",
      rule: "order_in_progress",
    });
  });

  it("un clic posterior gana aunque el pedido anterior siga en camino", () => {
    // Regla 1 antes que regla 2, como está escrito el spec: la venta nueva la
    // toma ventas; las notificaciones del envío en curso no dependen de la
    // bandeja y siguen saliendo.
    expect(
      resolveInbox({
        lastAdClickAt: dia(12),
        orders: [pedido(dia(10), "en_transito")],
      }),
    ).toEqual({ inbox: "ventas", rule: "ad_click_after_last_order" });
  });
});

describe("resolveInbox · varios pedidos", () => {
  it("basta un pedido en curso para que la conversación cuente como en curso", () => {
    expect(
      resolveInbox({
        lastAdClickAt: null,
        orders: [pedido(dia(1), "pendiente_confirmacion"), pedido(dia(15), "entregado")],
      }),
    ).toEqual({ inbox: "operaciones", rule: "order_in_progress" });
  });

  it("con todos los pedidos terminados la conversación cuenta como terminada", () => {
    expect(
      resolveInbox({
        lastAdClickAt: null,
        orders: [pedido(dia(1), "entregado"), pedido(dia(15), "devolucion")],
      }),
    ).toEqual({ inbox: "operaciones", rule: "order_finished" });
  });
});

describe("resolveOrderPhase · cada estado logístico tiene fase decidida", () => {
  // `Record` sobre el tipo del enum: si el esquema gana un estado, este
  // fixture deja de compilar hasta que alguien decida su fase aquí también.
  const fase: Record<OrderLogisticsStatus, OrderPhase | "pipeline"> = {
    unknown: "pipeline",
    pendiente_confirmacion: "in_progress",
    pendiente: "in_progress",
    guia_generada: "in_progress",
    preparado_transportadora: "in_progress",
    recolectado: "in_progress",
    en_transito: "in_progress",
    con_mensajero: "in_progress",
    en_oficina: "in_progress",
    entregado: "finished",
    novedad: "in_progress",
    novedad_solucionada: "in_progress",
    devolucion: "finished",
    rechazado: "finished",
    retornado: "finished",
    anulada: "finished",
  };

  for (const [status, esperado] of Object.entries(fase) as [
    OrderLogisticsStatus,
    OrderPhase | "pipeline",
  ][]) {
    if (esperado === "pipeline") continue;
    it(`${status} → ${esperado}`, () => {
      expect(resolveOrderPhase(pedido(dia(1), status))).toBe(esperado);
    });
  }

  it("en_oficina no es entregado: el paquete espera a que el cliente lo reclame", () => {
    expect(resolveOrderPhase(pedido(dia(1), "en_oficina"))).toBe("in_progress");
  });

  it("novedad_solucionada no es entregado: la novedad se resolvió, la entrega sigue", () => {
    expect(resolveOrderPhase(pedido(dia(1), "novedad_solucionada"))).toBe("in_progress");
  });

  it("devolución, rechazado y retornado son terminales: la entrega no se dio y el paquete volvió", () => {
    for (const status of ["devolucion", "rechazado", "retornado"] as const) {
      expect(resolveOrderPhase(pedido(dia(1), status))).toBe("finished");
    }
  });
});

describe("resolveOrderPhase · cuando la logística sabe, la logística manda", () => {
  it("un pedido que la tienda nunca confirmó pero la logística entregó está terminado", () => {
    // Existe en producción: el pipeline se quedó en `followup_sent` y Dropi lo
    // confirmó y entregó por su cuenta.
    expect(resolveOrderPhase(pedido(dia(1), "entregado", "followup_sent"))).toBe(
      "finished",
    );
  });

  it("un pedido cancelado en la tienda que la logística sigue moviendo está en curso", () => {
    // A operaciones le queda anularlo en Dropi antes de que salga.
    expect(resolveOrderPhase(pedido(dia(1), "en_transito", "cancelled"))).toBe(
      "in_progress",
    );
  });

  it("con logística en unknown decide el pipeline de tienda", () => {
    expect(resolveOrderPhase(pedido(dia(1), "unknown", "cancelled"))).toBe("finished");
    expect(resolveOrderPhase(pedido(dia(1), "unknown", "confirmed"))).toBe("in_progress");
  });

  it("un pedido que solo existe en logística se clasifica por su estado logístico", () => {
    expect(
      resolveOrderPhase({ createdAt: dia(1), pipelineStatus: null, logisticsStatus: "recolectado" }),
    ).toBe("in_progress");
    expect(
      resolveOrderPhase({ createdAt: dia(1), pipelineStatus: null, logisticsStatus: "rechazado" }),
    ).toBe("finished");
  });

  it("un pedido del que no se sabe nada cuenta como en curso: existe, y nadie dijo que terminó", () => {
    expect(
      resolveOrderPhase({ createdAt: dia(1), pipelineStatus: null, logisticsStatus: null }),
    ).toBe("in_progress");
    expect(
      resolveOrderPhase({ createdAt: dia(1), pipelineStatus: null, logisticsStatus: "unknown" }),
    ).toBe("in_progress");
  });
});

describe("resolveOrderPhase · cada estado del pipeline de tienda tiene fase decidida", () => {
  const fase: Record<OrderPipelineStatus, OrderPhase> = {
    received: "in_progress",
    followup_scheduled: "in_progress",
    followup_sent: "in_progress",
    confirmed: "in_progress",
    no_response: "in_progress",
    cancelled: "finished",
  };

  for (const [status, esperado] of Object.entries(fase) as [
    OrderPipelineStatus,
    OrderPhase,
  ][]) {
    it(`${status} sin logística → ${esperado}`, () => {
      expect(resolveOrderPhase(pedido(dia(1), null, status))).toBe(esperado);
    });
  }

  it("no_response no es cancelado: el pedido sigue sin confirmar ni anular", () => {
    expect(resolveOrderPhase(pedido(dia(1), null, "no_response"))).toBe("in_progress");
  });
});
