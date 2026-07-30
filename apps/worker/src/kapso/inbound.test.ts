import { describe, expect, it } from "vitest";
import {
  parseInboundMessage,
  parseStatusEvent,
  type KapsoInboundPayload,
} from "./inbound";

function audioPayload(
  kapso: Record<string, unknown>,
): KapsoInboundPayload {
  return {
    phone_number_id: "1129137660293996",
    message: {
      id: "wamid.AUDIO",
      timestamp: "1730093100",
      type: "audio",
      from: "50236890343",
      kapso: { direction: "inbound", ...kapso },
    },
    conversation: { kapso: { contact_name: "Ana" } },
  } as KapsoInboundPayload;
}

describe("parseInboundMessage · audio", () => {
  it("usa la transcripción como texto para que el agente pueda responder", () => {
    const parsed = parseInboundMessage(
      audioPayload({
        media_url: "https://api.kapso.ai/media/abc",
        media_data: { url: "https://api.kapso.ai/media/abc", content_type: "audio/ogg" },
        transcript: { text: "Hola, quiero cambiar mi dirección" },
      }),
    );
    expect(parsed?.kind).toBe("audio");
    expect(parsed?.text).toBe("Hola, quiero cambiar mi dirección");
    expect(parsed?.transcript).toBe("Hola, quiero cambiar mi dirección");
    expect(parsed?.mediaUrl).toBe("https://api.kapso.ai/media/abc");
    expect(parsed?.mediaMime).toBe("audio/ogg");
  });

  it("sin transcripción deja el texto vacío (el pipeline escala a humano)", () => {
    const parsed = parseInboundMessage(
      audioPayload({ media_url: "https://api.kapso.ai/media/xyz" }),
    );
    expect(parsed?.kind).toBe("audio");
    expect(parsed?.text).toBe("");
    expect(parsed?.transcript).toBeNull();
    expect(parsed?.mediaUrl).toBe("https://api.kapso.ai/media/xyz");
  });

  it("una transcripción en blanco cuenta como ausente", () => {
    const parsed = parseInboundMessage(
      audioPayload({ transcript: { text: "   " } }),
    );
    expect(parsed?.transcript).toBeNull();
    expect(parsed?.text).toBe("");
  });

  it("prefiere media_data.url sobre media_url", () => {
    const parsed = parseInboundMessage(
      audioPayload({
        media_url: "https://api.kapso.ai/media/viejo",
        media_data: { url: "https://api.kapso.ai/media/nuevo" },
      }),
    );
    expect(parsed?.mediaUrl).toBe("https://api.kapso.ai/media/nuevo");
  });
});

describe("parseInboundMessage · resto", () => {
  it("un texto normal no trae media", () => {
    const parsed = parseInboundMessage({
      phone_number_id: "1129137660293996",
      message: {
        id: "wamid.TEXT",
        type: "text",
        from: "50236890343",
        text: { body: "hola" },
        kapso: { direction: "inbound" },
      },
    } as KapsoInboundPayload);
    expect(parsed?.text).toBe("hola");
    expect(parsed?.mediaUrl).toBeNull();
    expect(parsed?.transcript).toBeNull();
  });

  it("ignora el eco de nuestros propios mensajes", () => {
    const parsed = parseInboundMessage({
      phone_number_id: "1129137660293996",
      message: {
        id: "wamid.OUT",
        type: "text",
        from: "50236890343",
        text: { body: "hola" },
        kapso: { direction: "outbound" },
      },
    } as KapsoInboundPayload);
    expect(parsed).toBeNull();
  });

  it("un tap de botón de plantilla llega como texto", () => {
    const parsed = parseInboundMessage({
      phone_number_id: "1129137660293996",
      message: {
        id: "wamid.BTN",
        type: "button",
        from: "50236890343",
        button: { text: "Confirmar pedido" },
      },
    } as KapsoInboundPayload);
    expect(parsed?.text).toBe("Confirmar pedido");
    expect(parsed?.kind).toBe("button");
  });
});

describe("parseStatusEvent", () => {
  it("el nombre del evento viene por cabecera en payload v2", () => {
    const status = parseStatusEvent("whatsapp.message.delivered", {
      message: { id: "wamid.X" },
    } as KapsoInboundPayload);
    expect(status?.status).toBe("delivered");
    expect(status?.waMessageId).toBe("wamid.X");
  });

  it("extrae el error de Meta de statuses[].errors[]", () => {
    const status = parseStatusEvent("whatsapp.message.failed", {
      message: {
        id: "wamid.X",
        kapso: {
          statuses: [
            { status: "failed", errors: [{ code: 131026, title: "Undeliverable" }] },
          ],
        },
      },
    } as KapsoInboundPayload);
    expect(status?.errorCode).toBe(131026);
    expect(status?.errorTitle).toBe("Undeliverable");
  });

  it("no confunde un mensaje entrante con un evento de estado", () => {
    expect(
      parseStatusEvent("whatsapp.message.received", {
        message: { id: "wamid.X" },
      } as KapsoInboundPayload),
    ).toBeNull();
  });
});
