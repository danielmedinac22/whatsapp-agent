import { describe, expect, it } from "vitest";
import {
  type InboxFacts,
  type OrderFacts,
  type OrderLogisticsStatus,
  type OrderPhase,
  type OrderPipelineStatus,
  resolveInbox,
  resolveInboxAsOf,
  resolveOrderPhase,
  type SalesCutoff,
} from "@wa/db";

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

/** La línea de corte de una operación con el vendedor encendido el día `d`. */
const encendidoEl = (d: number, nacidaEl: number): SalesCutoff => ({
  activatedAt: dia(d),
  bornAt: dia(nacidaEl),
});

describe("resolveInbox · las cinco reglas", () => {
  it("un lead que llegó por un anuncio y no tiene pedido es de ventas", () => {
    // Sin ningún pedido, la regla 1 no llega a dispararse: no hay contra qué
    // comparar el clic. Lo decide la regla 4 —nació después del corte—.
    expect(
      resolveInbox({ lastAdClickAt: dia(10), orders: [] }, encendidoEl(5, 10)),
    ).toEqual({
      inbox: "ventas",
      rule: "born_after_activation",
    });
  });

  it("un contacto sin pedido y sin vendedor encendido es de operaciones", () => {
    // **Producción hoy.** `sales_agent_settings` tiene una fila con el nombre
    // vacío, así que no hay línea de corte: las 110 conversaciones sin pedido
    // de Guatemala son de Katherine, y la bandeja de ventas queda vacía.
    expect(resolveInbox(sinNada)).toEqual({
      inbox: "operaciones",
      rule: "no_order",
    });
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

describe("resolveInbox · la línea de corte del vendedor", () => {
  // La regla que este ticket vino a acotar. Antes, «sin pedido» significaba
  // «de ventas» y punto: 110 conversaciones de Katherine presentadas como
  // pendientes de un vendedor apagado. Ahora la bandeja de ventas se define en
  // positivo —hay un motivo para creer que es suya— y el motivo es haber
  // nacido después de que alguien lo encendiera.
  //
  // El corte compara **nacimientos** y no actividad, así que da igual mirar la
  // conversación o su contacto: en producción hay una conversación por contacto
  // (1.760 y 1.760, medido el 19-ago-2026) y las dos filas se crean en el mismo
  // `handleInbound` —menos de medio segundo de diferencia en las 54 filas donde
  // los dos instantes no coinciden al segundo—. Se eligió la conversación
  // porque es lo que se rutea.

  it("sin vendedor encendido, una conversación sin pedido es de Katherine", () => {
    // El estado de producción, escrito de las dos formas en que un llamador
    // puede expresarlo: omitiendo el corte, o pasándolo con la fecha en `null`.
    expect(resolveInbox(sinNada)).toEqual({
      inbox: "operaciones",
      rule: "no_order",
    });
    expect(
      resolveInbox(sinNada, { activatedAt: null, bornAt: dia(20) }),
    ).toEqual({ inbox: "operaciones", rule: "no_order" });
  });

  it("una conversación nacida antes del encendido se queda en operaciones", () => {
    // Lo histórico es de Katherine **para siempre**: encender al vendedor no
    // le mueve de bandeja una sola conversación de las que ya existían.
    expect(resolveInbox(sinNada, encendidoEl(10, 3))).toEqual({
      inbox: "operaciones",
      rule: "no_order",
    });
  });

  it("una conversación nacida después del encendido es del vendedor", () => {
    expect(resolveInbox(sinNada, encendidoEl(10, 11))).toEqual({
      inbox: "ventas",
      rule: "born_after_activation",
    });
  });

  it("nacer en el mismo instante del encendido no alcanza: el borde es estricto", () => {
    // Del lado conservador, igual que el clic del recomprador: la conversación
    // que ya existía cuando se encendió el vendedor no la trajo él.
    expect(resolveInbox(sinNada, encendidoEl(10, 10))).toEqual({
      inbox: "operaciones",
      rule: "no_order",
    });
  });

  it("el corte solo alcanza a la regla 4: con pedido decide el pedido", () => {
    // Un cliente que compró después de encendido el vendedor sigue siendo
    // postventa. La línea de corte no es una fecha a partir de la cual todo es
    // de ventas: es lo que hace falta para que **la ausencia de pedido**
    // signifique algo.
    const cutoff = encendidoEl(10, 11);
    expect(
      resolveInbox({ lastAdClickAt: null, orders: [pedido(dia(12), "en_transito")] }, cutoff),
    ).toEqual({ inbox: "operaciones", rule: "order_in_progress" });
    expect(
      resolveInbox({ lastAdClickAt: null, orders: [pedido(dia(12), "entregado")] }, cutoff),
    ).toEqual({ inbox: "operaciones", rule: "order_finished" });
  });

  it("el recomprador vuelve a ventas aunque haya nacido antes del corte", () => {
    // La regla 1 no se tocó, y es la que va a traer a los recompradores el día
    // que haya anuncios. Por eso la línea de corte puede mirar solo el
    // nacimiento sin perder ese caso.
    expect(
      resolveInbox(
        { lastAdClickAt: dia(20), orders: [pedido(dia(5), "entregado")] },
        encendidoEl(15, 1),
      ),
    ).toEqual({ inbox: "ventas", rule: "ad_click_after_last_order" });
  });

  it("el que nunca compró y hace clic después del corte también es del vendedor", () => {
    // **El agujero que el ticket no vio.** La regla del recomprador compara el
    // clic contra el último pedido; a quien no tiene ninguno no lo alcanza. En
    // Guatemala son 110 conversaciones sin ninguna fila de pedido, y sin esta
    // regla el día que lleguen anuncios sus clics caerían en la bandeja de
    // Katherine — que es justo la mentira al revés de la que este ticket
    // vino a sacar.
    expect(
      resolveInbox({ lastAdClickAt: dia(20), orders: [] }, encendidoEl(10, 3)),
    ).toEqual({ inbox: "ventas", rule: "ad_click_after_activation" });
  });

  it("un clic anterior al corte es historia, y la historia no cambia de bandeja", () => {
    expect(
      resolveInbox({ lastAdClickAt: dia(8), orders: [] }, encendidoEl(10, 3)),
    ).toEqual({ inbox: "operaciones", rule: "no_order" });
  });

  it("sin vendedor encendido, ni el clic manda nada a ventas", () => {
    // Producción hoy: `ad_referral_at` es `null` en las 1.760 conversaciones,
    // así que este caso ni siquiera existe todavía. Vale igual como guardia:
    // el corte manda sobre las dos formas de entrar a la bandeja.
    expect(
      resolveInbox({ lastAdClickAt: dia(20), orders: [] }),
    ).toEqual({ inbox: "operaciones", rule: "no_order" });
  });

  it("con vendedor encendido y sin corte pasado, `resolveInboxAsOf` responde con lo de entonces", () => {
    // El vendedor se encendió el día 10; al día 5 no existía, así que a esa
    // fecha la conversación era de Katherine aunque hoy sea de ventas.
    const cutoff = encendidoEl(10, 11);
    expect(resolveInbox(sinNada, cutoff)).toEqual({
      inbox: "ventas",
      rule: "born_after_activation",
    });
    expect(resolveInboxAsOf(sinNada, dia(5), cutoff)).toEqual({
      inbox: "operaciones",
      rule: "no_order",
    });
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
