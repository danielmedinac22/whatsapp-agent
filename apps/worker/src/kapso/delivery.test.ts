import { describe, expect, it } from "vitest";
import {
  formatDeliveryError,
  humanDeliveryError,
  isStatusAdvance,
  metaErrorReason,
} from "./delivery";
import type { ParsedStatusEvent } from "./inbound";

function statusEvent(
  overrides: Partial<ParsedStatusEvent> = {},
): ParsedStatusEvent {
  return {
    waMessageId: "wamid.TEST",
    status: "failed",
    errorCode: null,
    errorTitle: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("isStatusAdvance", () => {
  it("avanza sent → delivered → read", () => {
    expect(isStatusAdvance("sent", "delivered")).toBe(true);
    expect(isStatusAdvance("delivered", "read")).toBe(true);
    expect(isStatusAdvance("sent", "read")).toBe(true);
  });

  it("nunca retrocede — los webhooks llegan desordenados", () => {
    expect(isStatusAdvance("read", "delivered")).toBe(false);
    expect(isStatusAdvance("delivered", "sent")).toBe(false);
    expect(isStatusAdvance("read", "sent")).toBe(false);
  });

  it("es idempotente ante el mismo estado repetido", () => {
    expect(isStatusAdvance("delivered", "delivered")).toBe(false);
    expect(isStatusAdvance("read", "read")).toBe(false);
  });

  it("acepta el primer estado cuando no hay nada guardado", () => {
    expect(isStatusAdvance(null, "sent")).toBe(true);
    expect(isStatusAdvance(null, "delivered")).toBe(true);
    expect(isStatusAdvance(null, "failed")).toBe(true);
  });

  it("solo permite fallar antes de la entrega", () => {
    expect(isStatusAdvance("pending", "failed")).toBe(true);
    expect(isStatusAdvance("sent", "failed")).toBe(true);
    // Un mensaje ya entregado o leído no puede "fallar" después.
    expect(isStatusAdvance("delivered", "failed")).toBe(false);
    expect(isStatusAdvance("read", "failed")).toBe(false);
  });

  it("failed es terminal", () => {
    expect(isStatusAdvance("failed", "delivered")).toBe(false);
    expect(isStatusAdvance("failed", "read")).toBe(false);
    expect(isStatusAdvance("failed", "sent")).toBe(false);
  });
});

describe("metaErrorReason", () => {
  it("distingue número que no recibe de problema nuestro", () => {
    expect(metaErrorReason(131026).reason).toBe("undeliverable");
    expect(metaErrorReason(131042).reason).toBe("needs_payment");
  });

  it("reconoce la ventana de 24h cerrada", () => {
    expect(metaErrorReason(131047).reason).toBe("reengagement_window");
  });

  it("agrupa los códigos de plantilla", () => {
    for (const code of [132000, 132001, 132012, 132069]) {
      expect(metaErrorReason(code).reason).toBe("template_issue");
    }
  });

  it("cae en unknown sin código", () => {
    const { reason, text } = metaErrorReason(null);
    expect(reason).toBe("unknown");
    expect(text).toContain("desconocido");
  });
});

describe("texto del fallo", () => {
  it("el motivo del hilo es legible y sin código técnico", () => {
    const human = humanDeliveryError(statusEvent({ errorCode: 131026 }));
    expect(human).toContain("no puede recibir");
    expect(human).not.toContain("131026");
  });

  it("el motivo guardado en el log sí lleva código y detalle", () => {
    const stored = formatDeliveryError(
      statusEvent({ errorCode: 131026, errorMessage: "Message undeliverable" }),
    );
    expect(stored).toBe("undeliverable: Message undeliverable (131026)");
  });

  it("recorta errores largos para que quepan en la columna", () => {
    const stored = formatDeliveryError(
      statusEvent({ errorCode: 133010, errorMessage: "x".repeat(900) }),
    );
    expect(stored.length).toBeLessThanOrEqual(500);
  });
});
