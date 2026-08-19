import { describe, expect, it } from "vitest";
import { MAX_EVENT_AGE_MS, SALES_ORDER_TAG, planConversion } from "./plan";
import { ledgerKey } from "./conversion-record";
import type { OperationCapiFacts } from "./purchase-event";

const AHORA = new Date("2026-08-19T12:00:00.000Z");
const HACE_UNA_HORA = new Date("2026-08-19T11:00:00.000Z");

/** Guatemala con todo configurado, tal como quedaría el día que se encienda. */
const GUATEMALA: OperationCapiFacts = {
  id: "63937b3d-6312-446d-8bb8-1b9468afdd87",
  currency: "GTQ",
  capiDatasetId: "9988776655",
  whatsappBusinessAccountId: "1676368750161510",
};

/** Un pedido del vendedor, llegado por anuncio y ya confirmado al cliente. */
function pedido(over: Partial<Parameters<typeof planConversion>[0]["order"]> = {}) {
  return {
    orderId: "7414396223783",
    totalPrice: "165.00",
    receivedAt: HACE_UNA_HORA,
    tags: [SALES_ORDER_TAG, "vendedor:Sebastián", "ventas-a1b2c3d4e5f60718293a4b5c"],
    ctwaClid: "ARBcdEF123",
    confirmedToCustomerAt: HACE_UNA_HORA,
    ...over,
  };
}

function plan(
  over: Partial<Parameters<typeof planConversion>[0]["order"]> = {},
  operation: OperationCapiFacts = GUATEMALA,
) {
  return planConversion({ order: pedido(over), operation, now: AHORA });
}

describe("planConversion · la venta del vendedor con clic se reporta", () => {
  it("un pedido de ventas, con clic y ya confirmado al cliente, se reporta", () => {
    const r = plan();
    expect(r.kind).toBe("report");
    if (r.kind !== "report") return;
    expect(r.datasetId).toBe("9988776655");
    expect(r.event.custom_data).toEqual({ currency: "GTQ", value: 165 });
    expect(r.event.user_data.ctwa_clid).toBe("ARBcdEF123");
  });

  it("el evento va con la moneda de la operación, no con una por defecto", () => {
    // Sin el valor y su moneda, Meta optimiza hacia CANTIDAD de ventas en vez
    // de hacia ingreso — que con un catálogo de combos no es lo mismo.
    const r = plan({ totalPrice: "1250.50" });
    expect(r.kind === "report" && r.event.custom_data).toEqual({
      currency: "GTQ",
      value: 1250.5,
    });
  });
});

describe("planConversion · el evento va DESPUÉS de que el cliente supo que compró", () => {
  it("sin confirmación al cliente, la venta espera", () => {
    // Criterio del ticket, y el orden que tiene sentido: primero la persona,
    // después la telemetría. Es «esperar» y no «saltar» porque el mensaje
    // todavía puede salir.
    const r = plan({ confirmedToCustomerAt: null });
    expect(r).toEqual({ kind: "wait", reason: "awaiting-customer-confirmation" });
  });
});

describe("planConversion · lo que nunca se va a reportar se salta, y consta por qué", () => {
  it("un pedido que no tomó el vendedor no se reporta", () => {
    // Es el caso de los 1.735 pedidos de Guatemala: todos traen
    // `releasit_cod_form` y ninguno la etiqueta de ventas.
    const r = plan({ tags: ["releasit_cod_form"] });
    expect(r).toEqual({ kind: "skip", reason: "not-a-sales-order" });
  });

  it("una venta que no vino de un anuncio no genera un evento anónimo", () => {
    // No es un error: es la mayoría. Y devolverlo con nombre impide que alguien
    // «arregle» el hueco mandando un evento sin clic, que Meta aceptaría y no
    // podría atribuir a nada.
    expect(plan({ ctwaClid: null })).toEqual({
      kind: "skip",
      reason: "no-click-id",
    });
    expect(plan({ ctwaClid: "   " })).toEqual({
      kind: "skip",
      reason: "no-click-id",
    });
  });

  it("una venta más vieja que la ventana de Meta no se manda", () => {
    // Meta rechaza eventos de más de siete días. Mandarlo igual sería un
    // evento descartado y reintentado seis veces. Además pone techo al día que
    // alguien enciende el interruptor tras un mes apagado.
    const justo = new Date(AHORA.getTime() - MAX_EVENT_AGE_MS);
    const pasado = new Date(AHORA.getTime() - MAX_EVENT_AGE_MS - 1000);
    expect(plan({ receivedAt: justo }).kind).toBe("report");
    expect(plan({ receivedAt: pasado })).toEqual({
      kind: "skip",
      reason: "too-old",
    });
  });

  it("un total que no se puede leer con certeza no se inventa", () => {
    // "1,199.00" y "199,00" se diferencian en cien veces el valor, y
    // equivocarse le enseña al algoritmo un ticket promedio falso. Un cero
    // tampoco pasa: sería una compra de valor cero, y eso Meta sí lo aprende.
    for (const total of ["1,199.00", "199,00", "", null, "0.00", "-5"]) {
      expect(plan({ totalPrice: total }), String(total)).toEqual({
        kind: "skip",
        reason: "order-has-no-value",
      });
    }
  });
});

describe("planConversion · lo que le falta a la operación se espera, no se salta", () => {
  // La distinción no es cosmética: lo que le falta a la OPERACIÓN lo puede
  // poner un humano mañana y entonces la venta se reporta sola. Lo que le falta
  // al PEDIDO no se arregla nunca. Colapsarlos es cómo un tablero se ve
  // tranquilo mientras hace un mes que falta un dato de configuración.

  it("sin dataset configurado la venta espera al panel", () => {
    // Es el estado de hoy: `operations.capi_dataset_id` sigue en NULL.
    expect(plan({}, { ...GUATEMALA, capiDatasetId: null })).toEqual({
      kind: "wait",
      reason: "operation-has-no-dataset",
    });
  });

  it("sin cuenta de WhatsApp la venta espera", () => {
    expect(plan({}, { ...GUATEMALA, whatsappBusinessAccountId: null })).toEqual({
      kind: "wait",
      reason: "operation-has-no-whatsapp-account",
    });
  });

  it("sin moneda la venta espera, y no sale con una inventada", () => {
    expect(plan({}, { ...GUATEMALA, currency: "  " })).toEqual({
      kind: "wait",
      reason: "operation-has-no-currency",
    });
  });

  it("sin clic no importa lo que falte de configuración", () => {
    // Si no hay nada que reportar, la configuración que falte no es un
    // problema todavía y no tiene por qué encender ninguna alarma.
    expect(
      plan({ ctwaClid: null }, { ...GUATEMALA, capiDatasetId: null }),
    ).toEqual({ kind: "skip", reason: "no-click-id" });
  });
});

describe("planConversion · la llave de deduplicación no depende del momento", () => {
  it("dos planes del mismo pedido dan la misma llave", () => {
    // Es lo que hace que un reintento se reconozca. Si la llave llevara la hora,
    // cada intento parecería una venta nueva.
    const a = planConversion({
      order: pedido(),
      operation: GUATEMALA,
      now: AHORA,
    });
    const b = planConversion({
      order: pedido(),
      operation: GUATEMALA,
      now: new Date(AHORA.getTime() + 6 * 3_600_000),
    });
    expect(a.kind === "report" && a.deduplicationKey).toBe(
      b.kind === "report" && b.deduplicationKey,
    );
  });

  it("dos pedidos distintos dan llaves distintas", () => {
    const a = plan();
    const b = plan({ orderId: "7414388392231" });
    expect(a.kind === "report" && a.deduplicationKey).not.toBe(
      b.kind === "report" && b.deduplicationKey,
    );
  });

  it("la llave lleva la operación: el mismo número de pedido en dos países no colisiona", () => {
    const gt = plan();
    const co = plan({}, { ...GUATEMALA, id: "otra-operacion", currency: "COP" });
    expect(gt.kind === "report" && gt.deduplicationKey).not.toBe(
      co.kind === "report" && co.deduplicationKey,
    );
  });
});

describe("ledgerKey · un ensayo no consume el turno del envío real", () => {
  it("el modo de prueba y el real no comparten llave", () => {
    // Si la compartieran, el ensayo del ticket 04 dejaría marcadas como
    // reportadas las primeras ventas reales —justo las que alguien está
    // mirando— y nunca llegarían al dataset de verdad.
    const r = plan();
    if (r.kind !== "report") throw new Error("debería reportarse");
    expect(ledgerKey("test", r.deduplicationKey)).not.toBe(
      ledgerKey("live", r.deduplicationKey),
    );
    expect(ledgerKey("live", r.deduplicationKey)).toBe(r.deduplicationKey);
    expect(ledgerKey("test", r.deduplicationKey)).toBe(
      `test:${r.deduplicationKey}`,
    );
  });

  it("la llave del envío real no cambia por haber ensayado antes", () => {
    const r = plan();
    if (r.kind !== "report") throw new Error("debería reportarse");
    expect(ledgerKey("live", r.deduplicationKey)).toBe(
      `purchase:${GUATEMALA.id}:7414396223783`,
    );
  });
});

describe("planConversion · las etiquetas llegan en dos formatos y los dos valen", () => {
  it("la etiqueta se reconoce con espacios y en mayúsculas", () => {
    // El webhook manda una cadena separada por comas y la API de administración
    // un arreglo. Leerla mal acá significa no reportar una venta que sí se hizo.
    expect(plan({ tags: ["  ORIGEN-VENTAS  "] }).kind).toBe("report");
  });

  it("un pedido sin etiquetas no se reporta y no rompe nada", () => {
    expect(plan({ tags: [] })).toEqual({
      kind: "skip",
      reason: "not-a-sales-order",
    });
  });
});
