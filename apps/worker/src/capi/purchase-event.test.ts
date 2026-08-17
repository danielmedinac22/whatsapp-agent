import { describe, expect, it } from "vitest";
import {
  type AdAttribution,
  type ClosedOrder,
  type OperationCapiFacts,
  buildPurchaseEvent,
  capiRequestBody,
  operationCapiFacts,
} from "./purchase-event";

// Las dos operaciones son las de verdad: Guatemala factura hoy en quetzales y
// Colombia es la que se abre. Que los tres identificadores sean distintos entre
// ellas es lo que hace visible cuándo algo salió de una constante.
const GUATEMALA: OperationCapiFacts = {
  id: "63937b3d-6312-446d-8bb8-1b9468afdd87",
  currency: "GTQ",
  capiDatasetId: "dataset-guatemala",
  whatsappBusinessAccountId: "1676368750161510",
};

const COLOMBIA: OperationCapiFacts = {
  id: "0d9ec2d9-4c2a-4a4a-9f6f-2b1f0f0e5a11",
  currency: "COP",
  capiDatasetId: "dataset-colombia",
  whatsappBusinessAccountId: "9900112233445566",
};

/** El instante de cierre. El evento lo lleva en segundos, no en milisegundos. */
const CERRADO_EL = new Date("2026-08-17T15:04:05.000Z");
const CERRADO_EL_EN_SEGUNDOS = 1786979045;

const conClic: AdAttribution = { ctwaClid: "ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFD" };
const sinClic: AdAttribution = { ctwaClid: null };

function pedido(overrides: Partial<ClosedOrder> = {}): ClosedOrder {
  return { id: "942698", totalPrice: "199.00", closedAt: CERRADO_EL, ...overrides };
}

function construir(
  order: ClosedOrder,
  attribution: AdAttribution,
  operation: OperationCapiFacts,
) {
  return buildPurchaseEvent({ order, attribution, operation });
}

describe("buildPurchaseEvent · el pedido con identificador de clic", () => {
  it("arma el evento de compra con la forma que Meta documenta para business messaging", () => {
    expect(construir(pedido(), conClic, GUATEMALA)).toEqual({
      kind: "event",
      datasetId: "dataset-guatemala",
      deduplicationKey: `purchase:${GUATEMALA.id}:942698`,
      event: {
        event_name: "Purchase",
        event_time: CERRADO_EL_EN_SEGUNDOS,
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        user_data: {
          whatsapp_business_account_id: "1676368750161510",
          ctwa_clid: conClic.ctwaClid,
        },
        custom_data: { currency: "GTQ", value: 199 },
      },
    });
  });

  it("manda el identificador de clic tal cual, sin hashear ni recortar", () => {
    const build = construir(pedido(), conClic, GUATEMALA);
    expect(build.kind === "event" && build.event.user_data.ctwa_clid).toBe(
      conClic.ctwaClid,
    );
  });

  it("el origen de la acción no es 'website': una conversión de WhatsApp mandada como evento web no se atribuye al anuncio", () => {
    const build = construir(pedido(), conClic, GUATEMALA);
    expect(build.kind === "event" && build.event.action_source).toBe(
      "business_messaging",
    );
    expect(build.kind === "event" && build.event.messaging_channel).toBe("whatsapp");
  });

  it("el momento del evento es el del cierre del pedido, en segundos", () => {
    const build = construir(
      pedido({ closedAt: new Date("2026-01-02T03:04:05.678Z") }),
      conClic,
      GUATEMALA,
    );
    expect(build.kind === "event" && build.event.event_time).toBe(1767323045);
  });
});

describe("buildPurchaseEvent · un pedido sin identificador de clic no genera evento", () => {
  it("no genera evento cuando la conversación nunca trajo identificador de clic", () => {
    expect(construir(pedido(), sinClic, GUATEMALA)).toEqual({
      kind: "no-event",
      reason: "no-click-id",
    });
  });

  it("tampoco lo genera con un identificador vacío o de puros espacios", () => {
    expect(construir(pedido(), { ctwaClid: "" }, GUATEMALA)).toEqual({
      kind: "no-event",
      reason: "no-click-id",
    });
    expect(construir(pedido(), { ctwaClid: "   " }, GUATEMALA)).toEqual({
      kind: "no-event",
      reason: "no-click-id",
    });
  });

  it("la ausencia de evento es un resultado del tipo, no un null ni una excepción", () => {
    const build = construir(pedido(), sinClic, GUATEMALA);
    expect(build).not.toBeNull();
    expect(build.kind).toBe("no-event");
  });

  it("un pedido sin clic no reporta la falta de configuración: primero hay que tener algo que reportar", () => {
    const sinDataset = { ...GUATEMALA, capiDatasetId: null };
    expect(construir(pedido(), sinClic, sinDataset)).toEqual({
      kind: "no-event",
      reason: "no-click-id",
    });
  });
});

describe("buildPurchaseEvent · la moneda y el valor salen de la operación y del pedido", () => {
  it("el evento de Guatemala va en quetzales y el de Colombia en pesos, con el mismo pedido", () => {
    const gt = construir(pedido(), conClic, GUATEMALA);
    const co = construir(pedido(), conClic, COLOMBIA);
    expect(gt.kind === "event" && gt.event.custom_data.currency).toBe("GTQ");
    expect(co.kind === "event" && co.event.custom_data.currency).toBe("COP");
  });

  it("no hay moneda por defecto: una operación sin moneda no produce evento", () => {
    expect(construir(pedido(), conClic, { ...GUATEMALA, currency: "  " })).toEqual({
      kind: "no-event",
      reason: "operation-has-no-currency",
    });
  });

  it("lleva el total del pedido, que es lo que hace que Meta optimice hacia ingreso y no hacia cantidad", () => {
    const build = construir(pedido({ totalPrice: "1250.50" }), conClic, GUATEMALA);
    expect(build.kind === "event" && build.event.custom_data.value).toBe(1250.5);
  });

  it("acepta el total como número, que es como lo calcula el cierre de ventas", () => {
    const build = construir(pedido({ totalPrice: 349.9 }), conClic, GUATEMALA);
    expect(build.kind === "event" && build.event.custom_data.value).toBe(349.9);
  });

  it("redondea a dos decimales para que un total en coma flotante no viaje con cola", () => {
    const build = construir(pedido({ totalPrice: 0.1 + 0.2 }), conClic, GUATEMALA);
    expect(build.kind === "event" && build.event.custom_data.value).toBe(0.3);
  });

  it("un total con separador de miles no se interpreta: las dos lecturas se diferencian en cien veces el valor", () => {
    expect(construir(pedido({ totalPrice: "1,199.00" }), conClic, GUATEMALA)).toEqual({
      kind: "no-event",
      reason: "order-has-no-value",
    });
    expect(construir(pedido({ totalPrice: "199,00" }), conClic, GUATEMALA)).toEqual({
      kind: "no-event",
      reason: "order-has-no-value",
    });
  });

  it("un total vacío, ilegible o cero no produce un evento de valor cero", () => {
    for (const totalPrice of ["", "  ", "gratis", "0", "0.00", 0, -50, Number.NaN]) {
      expect(construir(pedido({ totalPrice }), conClic, GUATEMALA)).toEqual({
        kind: "no-event",
        reason: "order-has-no-value",
      });
    }
  });

  it("un pedido sin fecha de cierre válida no produce evento", () => {
    expect(
      construir(pedido({ closedAt: new Date("no es una fecha") }), conClic, GUATEMALA),
    ).toEqual({ kind: "no-event", reason: "order-has-no-close-time" });
  });
});

describe("buildPurchaseEvent · la llave de deduplicación se deriva del pedido", () => {
  it("dos construcciones del mismo pedido dan la misma llave", () => {
    const primera = construir(pedido(), conClic, GUATEMALA);
    const segunda = construir(pedido(), conClic, GUATEMALA);
    expect(primera.kind === "event" && primera.deduplicationKey).toBe(
      segunda.kind === "event" ? segunda.deduplicationKey : "distinta",
    );
  });

  it("la llave no depende del momento: el mismo pedido reconstruido más tarde la conserva", () => {
    const ahora = construir(pedido(), conClic, GUATEMALA);
    const unaSemanaDespues = construir(
      pedido({ closedAt: CERRADO_EL }),
      { ctwaClid: "otro-clic-de-la-misma-conversacion" },
      GUATEMALA,
    );
    expect(ahora.kind === "event" && ahora.deduplicationKey).toBe(
      unaSemanaDespues.kind === "event" ? unaSemanaDespues.deduplicationKey : "distinta",
    );
  });

  it("dos pedidos distintos de la misma operación dan llaves distintas", () => {
    const uno = construir(pedido({ id: "942698" }), conClic, GUATEMALA);
    const otro = construir(pedido({ id: "942699" }), conClic, GUATEMALA);
    expect(uno.kind === "event" && uno.deduplicationKey).not.toBe(
      otro.kind === "event" ? otro.deduplicationKey : "misma",
    );
  });

  it("el mismo número de pedido en dos operaciones da llaves distintas: el id de logística solo es único dentro de una cuenta", () => {
    const gt = construir(pedido({ id: "942698" }), conClic, GUATEMALA);
    const co = construir(pedido({ id: "942698" }), conClic, COLOMBIA);
    expect(gt.kind === "event" && gt.deduplicationKey).not.toBe(
      co.kind === "event" ? co.deduplicationKey : "misma",
    );
  });

  it("la llave viaja al lado del evento y no dentro: Meta no deduplica este flujo", () => {
    const build = construir(pedido(), conClic, GUATEMALA);
    expect(build.kind === "event" && "event_id" in build.event).toBe(false);
  });
});

describe("buildPurchaseEvent · el destino sale de la operación, no de una constante", () => {
  it("cada operación reporta a su propio dataset con el mismo pedido", () => {
    const gt = construir(pedido(), conClic, GUATEMALA);
    const co = construir(pedido(), conClic, COLOMBIA);
    expect(gt.kind === "event" && gt.datasetId).toBe("dataset-guatemala");
    expect(co.kind === "event" && co.datasetId).toBe("dataset-colombia");
  });

  it("cada operación manda su propia cuenta de WhatsApp en el user_data", () => {
    const gt = construir(pedido(), conClic, GUATEMALA);
    const co = construir(pedido(), conClic, COLOMBIA);
    expect(
      gt.kind === "event" && gt.event.user_data.whatsapp_business_account_id,
    ).toBe("1676368750161510");
    expect(
      co.kind === "event" && co.event.user_data.whatsapp_business_account_id,
    ).toBe("9900112233445566");
  });

  it("una operación sin dataset configurado no reporta a ninguno: no hay destino por defecto", () => {
    expect(
      construir(pedido(), conClic, { ...GUATEMALA, capiDatasetId: null }),
    ).toEqual({ kind: "no-event", reason: "operation-has-no-dataset" });
  });

  it("una operación sin conexión de WhatsApp tampoco reporta", () => {
    expect(
      construir(pedido(), conClic, { ...GUATEMALA, whatsappBusinessAccountId: null }),
    ).toEqual({ kind: "no-event", reason: "operation-has-no-whatsapp-account" });
  });

  it("un pedido sin identificador propio no produce evento, porque no habría llave estable", () => {
    expect(construir(pedido({ id: "  " }), conClic, GUATEMALA)).toEqual({
      kind: "no-event",
      reason: "order-has-no-id",
    });
  });
});

describe("operationCapiFacts · aparear la operación con su conexión", () => {
  const operacion = {
    id: GUATEMALA.id,
    currency: "GTQ",
    capiDatasetId: "dataset-guatemala",
  };

  it("junta la moneda y el dataset de la operación con la cuenta de WhatsApp de su conexión", () => {
    expect(
      operationCapiFacts(operacion, {
        operationId: GUATEMALA.id,
        businessAccountId: "1676368750161510",
      }),
    ).toEqual(GUATEMALA);
  });

  it("una operación sin conexión todavía es un estado normal: queda sin cuenta de WhatsApp", () => {
    expect(operationCapiFacts(operacion, null)).toEqual({
      ...GUATEMALA,
      whatsappBusinessAccountId: null,
    });
  });

  it("lanza si la conexión es de otra operación: reportar al dataset del país equivocado no se arregla después", () => {
    expect(() =>
      operationCapiFacts(operacion, {
        operationId: COLOMBIA.id,
        businessAccountId: "9900112233445566",
      }),
    ).toThrow(/no es de|no es de la operación|operación/);
  });
});

describe("capiRequestBody · el sobre del POST", () => {
  it("envuelve los eventos en `data`", () => {
    const build = construir(pedido(), conClic, GUATEMALA);
    const evento = build.kind === "event" ? build.event : null;
    expect(evento).not.toBeNull();
    expect(capiRequestBody(evento ? [evento] : [])).toEqual({ data: [evento] });
  });

  it("solo lleva el código de prueba cuando quien envía lo pasa", () => {
    expect(capiRequestBody([])).not.toHaveProperty("test_event_code");
    expect(capiRequestBody([], "TEST12345")).toEqual({
      data: [],
      test_event_code: "TEST12345",
    });
  });
});
