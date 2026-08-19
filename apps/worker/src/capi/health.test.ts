import { describe, expect, it } from "vitest";
import { reportingVerdict, type SweepCounts } from "./health";
import type { ConversionTally } from "./conversion-record";
import type { CapiDispatchSetting } from "./send-mode";

const ENCENDIDO: CapiDispatchSetting = {
  mode: "live",
  token: "SYSUSR",
  graphVersion: "v26.0",
};
const EN_PRUEBA: CapiDispatchSetting = {
  mode: "test",
  token: "SYSUSR",
  testEventCode: "TEST123",
  graphVersion: "v26.0",
};

const NADA: ConversionTally = { sent: 0, failed: 0, unconfirmed: 0, pending: 0 };
const SIN_PENDIENTES: SweepCounts = { report: 0, wait: {}, skip: {} };

function veredicto(over: {
  setting?: CapiDispatchSetting;
  tally?: Partial<ConversionTally>;
  sweep?: SweepCounts;
  stalePending?: number;
}) {
  return reportingVerdict({
    setting: over.setting ?? ENCENDIDO,
    tally: { ...NADA, ...over.tally },
    sweep: over.sweep ?? SIN_PENDIENTES,
    stalePending: over.stalePending ?? 0,
  });
}

describe("reportingVerdict · apagado se dice, no se disfraza de calma", () => {
  it("con el interruptor apagado el veredicto lo dice y explica el motivo", () => {
    const v = veredicto({
      setting: { mode: "off", reason: "no-token" },
    });
    expect(v.state).toBe("blocked");
    expect(v.detail).toContain("whatsapp_business_manage_events");
    expect(v.detail).toContain("ninguna venta se está atribuyendo");
  });

  it("apagado manda sobre todo lo demás", () => {
    // Aunque haya conversiones viejas mandadas, si hoy está apagado lo que el
    // admin necesita saber es que no se está reportando.
    const v = veredicto({
      setting: { mode: "off", reason: "switch-off" },
      tally: { sent: 12 },
    });
    expect(v.state).toBe("blocked");
  });
});

describe("reportingVerdict · lo que falta configurar se ve antes que nada", () => {
  it("ventas esperando dataset son configuración, no avería", () => {
    // Es el estado que sigue al encender: el interruptor puesto y
    // `capi_dataset_id` todavía en NULL.
    const v = veredicto({
      sweep: { report: 0, wait: { "operation-has-no-dataset": 3 }, skip: {} },
    });
    expect(v.state).toBe("blocked");
    expect(v.detail).toContain("dataset");
    expect(v.detail).toContain("3 ventas");
    expect(v.detail).toContain("se reportan solas");
  });

  it("la falta de conexión de WhatsApp también bloquea, y se nombra distinto", () => {
    const v = veredicto({
      sweep: {
        report: 0,
        wait: { "operation-has-no-whatsapp-account": 1 },
        skip: {},
      },
    });
    expect(v.state).toBe("blocked");
    expect(v.detail).toContain("conexión de WhatsApp");
    expect(v.detail).toContain("1 venta");
  });
});

describe("reportingVerdict · una falla se ve como falla", () => {
  it("una conversión rechazada por Meta se reporta como fallando", () => {
    const v = veredicto({ tally: { failed: 2, sent: 5 } });
    expect(v.state).toBe("failing");
    expect(v.detail).toContain("2 ventas fueron rechazadas");
    expect(v.detail).toContain("5 ventas han quedado");
  });

  it("una conversión en duda se explica sin pedir que se reintente", () => {
    // El punto del estado: nadie de este lado sabe si llegó, y reintentarla
    // contaría la venta dos veces. El texto tiene que decir las dos cosas.
    const v = veredicto({ tally: { unconfirmed: 1 } });
    expect(v.state).toBe("failing");
    expect(v.detail).toContain("en duda");
    expect(v.detail).toContain("no se reintenta");
  });

  it("una conversión que quedó pidiendo turno y nunca se resolvió se ve", () => {
    // Es el precio conocido de escribir la fila antes de llamar: un worker que
    // se reinicia en el medio deja un `pending` que el barrido nunca vuelve a
    // mirar. Si no sale acá, no sale en ningún lado.
    const v = veredicto({ stalePending: 4 });
    expect(v.state).toBe("failing");
    expect(v.detail).toContain("4 quedaron pidiendo turno");
  });
});

describe("reportingVerdict · el modo de prueba no se confunde con estar funcionando", () => {
  it("las conversiones de prueba no cuentan, y el texto lo dice", () => {
    // Si el tablero dijera «funcionando» en modo prueba, alguien daría el
    // ensayo por terminado y la pauta nunca recibiría una sola conversión.
    const v = veredicto({ setting: EN_PRUEBA, tally: { sent: 3 } });
    expect(v.state).toBe("working");
    expect(v.headline).toContain("prueba");
    expect(v.detail).toContain("No cuentan como conversión");
  });

  it("en modo real, conversiones mandadas es funcionando", () => {
    const v = veredicto({ tally: { sent: 7 } });
    expect(v.state).toBe("working");
    expect(v.detail).toContain("7 ventas");
  });
});

describe("reportingVerdict · el silencio no aprueba por la razón equivocada", () => {
  // Es el hallazgo registrado del proyecto —«el estado vacío aprueba por la
  // razón equivocada»— aplicado a un tablero. Cero eventos mandados se ve igual
  // cuando todo funciona sin ventas por anuncio que cuando el reporte está roto.

  it("encendido y sin nada que reportar NO dice «funcionando»", () => {
    const v = veredicto({});
    expect(v.state).toBe("idle");
    expect(v.state).not.toBe("working");
  });

  it("el silencio explica qué se miró: ventas esperando su confirmación", () => {
    const v = veredicto({
      sweep: {
        report: 0,
        wait: { "awaiting-customer-confirmation": 2 },
        skip: {},
      },
    });
    expect(v.state).toBe("idle");
    expect(v.detail).toContain("confirmación al cliente");
  });

  it("el silencio explica que hubo ventas y ninguna vino de un anuncio", () => {
    const v = veredicto({
      sweep: { report: 0, wait: {}, skip: { "no-click-id": 5 } },
    });
    expect(v.state).toBe("idle");
    expect(v.detail).toContain("5 ventas");
    expect(v.detail).toContain("ninguna vino de un anuncio");
  });

  it("el silencio explica que ningún pedido lo tomó el vendedor", () => {
    // El estado de hoy en Guatemala: 1.735 pedidos, todos del formulario web.
    const v = veredicto({
      sweep: { report: 0, wait: {}, skip: { "not-a-sales-order": 1735 } },
    });
    expect(v.state).toBe("idle");
    expect(v.detail).toContain("1735 pedidos");
    expect(v.detail).toContain("ninguno lo tomó el vendedor");
  });

  it("sin pedidos en el período lo dice, en vez de callarse", () => {
    expect(veredicto({}).detail).toContain("No hubo pedidos");
  });
});
