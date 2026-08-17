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

// ────────────────────────────────────────────────────────────────────────────
// Referencia de anuncio (CTWA)
// ────────────────────────────────────────────────────────────────────────────

/**
 * El `referral` tal como Meta lo documenta, con los campos que no parseamos
 * incluidos: son los que tienen que sobrevivir en el objeto crudo.
 */
const REFERRAL_DE_META = {
  source_url: "https://fb.me/3cr4Wqqkv",
  source_id: "120226305854810726",
  source_type: "ad",
  headline: "Recupera tu cabello",
  body: "REVITALHAIR DHT en 90 días",
  media_type: "image",
  image_url: "https://scontent.xx.fbcdn.net/v/t45.1",
  ctwa_clid: "Aff-n8ZTODiE79d22KtAwQKj9e_mIEOOj27vDVwFjN80dp4",
  welcome_message: { text: "¡Hola! ¿En qué te ayudamos?" },
};

/** Un mensaje de texto normal, al que se le cuelga el referral donde se quiera. */
function textoConReferral(
  colocar: (payload: Record<string, any>) => void,
): KapsoInboundPayload {
  const payload: Record<string, any> = {
    phone_number_id: "1129137660293996",
    message: {
      id: "wamid.CTWA",
      timestamp: "1786806459",
      type: "text",
      from: "50236890343",
      text: { body: "hola, me interesa" },
      kapso: { direction: "inbound" },
    },
    conversation: { kapso: { contact_name: "Ana" } },
  };
  colocar(payload);
  return payload as KapsoInboundPayload;
}

describe("parseInboundMessage · referencia de anuncio", () => {
  it("expone la referencia cuando el payload la trae donde Meta la pone", () => {
    const parsed = parseInboundMessage(
      textoConReferral((p) => {
        p["message"].referral = REFERRAL_DE_META;
      }),
    );
    expect(parsed?.text).toBe("hola, me interesa");
    expect(parsed?.adReferral).toMatchObject({
      adId: "120226305854810726",
      headline: "Recupera tu cabello",
      body: "REVITALHAIR DHT en 90 días",
      sourceUrl: "https://fb.me/3cr4Wqqkv",
      sourceType: "ad",
      ctwaClid: "Aff-n8ZTODiE79d22KtAwQKj9e_mIEOOj27vDVwFjN80dp4",
      path: "message.referral",
    });
  });

  it("guarda el objeto crudo entero, con los campos que no parseamos", () => {
    const parsed = parseInboundMessage(
      textoConReferral((p) => {
        p["message"].referral = REFERRAL_DE_META;
      }),
    );
    // Es la red contra un recorte del proveedor: no existe endpoint de Meta
    // para pedir la referencia después, así que lo que no se guarde se pierde.
    expect(parsed?.adReferral?.raw).toEqual(REFERRAL_DE_META);
    expect(parsed?.adReferral?.raw["media_type"]).toBe("image");
    expect(parsed?.adReferral?.raw["welcome_message"]).toEqual({
      text: "¡Hola! ¿En qué te ayudamos?",
    });
  });

  it("un payload sin referencia se parsea igual que hoy, sin inventar campos", () => {
    const parsed = parseInboundMessage(textoConReferral(() => {}));
    expect(parsed?.adReferral).toBeNull();
    expect(parsed?.text).toBe("hola, me interesa");
    expect(parsed?.kind).toBe("text");
    expect(parsed?.from).toBe("50236890343");
    expect(parsed?.mediaUrl).toBeNull();
  });

  it("una respuesta de botón no trae referencia: Meta no la manda", () => {
    const parsed = parseInboundMessage({
      phone_number_id: "1129137660293996",
      message: {
        id: "wamid.BTN2",
        type: "button",
        from: "50236890343",
        button: { text: "Confirmar pedido" },
      },
    } as KapsoInboundPayload);
    expect(parsed?.kind).toBe("button");
    expect(parsed?.adReferral).toBeNull();
  });

  it("la encuentra en el sub-objeto de Kapso", () => {
    const parsed = parseInboundMessage(
      textoConReferral((p) => {
        p["message"].kapso.referral = REFERRAL_DE_META;
      }),
    );
    expect(parsed?.adReferral?.adId).toBe("120226305854810726");
    expect(parsed?.adReferral?.path).toBe("message.kapso.referral");
  });

  it("la encuentra colgada de la conversación", () => {
    const parsed = parseInboundMessage(
      textoConReferral((p) => {
        p["conversation"].kapso.referral = REFERRAL_DE_META;
      }),
    );
    expect(parsed?.adReferral?.ctwaClid).toBe(REFERRAL_DE_META.ctwa_clid);
    expect(parsed?.adReferral?.path).toBe("conversation.kapso.referral");
  });

  it("la encuentra en una ruta que nadie previó, y dice cuál era", () => {
    // La ruta exacta del campo en el payload de Kapso no está documentada y su
    // serializador ya recortó otros campos. Perder el identificador de clic por
    // haber adivinado mal la ruta es irreversible, así que hay búsqueda a
    // ciegas — y `path` deja anotado dónde apareció de verdad.
    const parsed = parseInboundMessage(
      textoConReferral((p) => {
        p["message"].kapso.ads = { ctwa: { referral: REFERRAL_DE_META } };
      }),
    );
    expect(parsed?.adReferral?.adId).toBe("120226305854810726");
    expect(parsed?.adReferral?.path).toBe("message.kapso.ads.ctwa.referral");
  });

  it("la reconoce por sus campos aunque la clave no se llame referral", () => {
    const parsed = parseInboundMessage(
      textoConReferral((p) => {
        p["message"].kapso.ad_source = {
          source_id: "999",
          ctwa_clid: "clid-999",
        };
      }),
    );
    expect(parsed?.adReferral?.adId).toBe("999");
    expect(parsed?.adReferral?.ctwaClid).toBe("clid-999");
    expect(parsed?.adReferral?.path).toBe("message.kapso.ad_source");
  });

  it("el cuerpo de un mensaje de texto no parece una referencia de anuncio", () => {
    // `message.text.body` tiene un campo `body`, igual que el referral. Buscar
    // por `body` haría que todo mensaje escrito a mano viniera de un anuncio.
    const parsed = parseInboundMessage(
      textoConReferral((p) => {
        p["message"].text = { body: "headline y body de mentira" };
      }),
    );
    expect(parsed?.adReferral).toBeNull();
  });

  it("una referencia que no identifica nada cuenta como ausente", () => {
    const parsed = parseInboundMessage(
      textoConReferral((p) => {
        p["message"].referral = { source_type: "organic", media_type: "image" };
      }),
    );
    // Sin anuncio, sin clic, sin URL y sin copy no hubo clic en nada: guardarla
    // marcaría la conversación como lead recién llegado de una pauta.
    expect(parsed?.adReferral).toBeNull();
  });

  it("un identificador de anuncio sin comillas no se pierde", () => {
    // Meta lo manda como cadena, pero cualquier serializador intermedio puede
    // emitirlo como número, y perder el id del anuncio por eso sería absurdo.
    const parsed = parseInboundMessage(
      textoConReferral((p) => {
        p["message"].referral = { source_id: 12345 };
      }),
    );
    expect(parsed?.adReferral?.adId).toBe("12345");
  });

  it("un anuncio sin identificador de clic se guarda igual, con el clic en null", () => {
    // Meta omite `ctwa_clid` en los anuncios de Estados. El anuncio sirve para
    // reconocer el producto aunque no haya nada que reportarle a Meta después.
    const parsed = parseInboundMessage(
      textoConReferral((p) => {
        p["message"].referral = {
          source_id: "120226305854810726",
          headline: "Escríbenos",
        };
      }),
    );
    expect(parsed?.adReferral?.adId).toBe("120226305854810726");
    expect(parsed?.adReferral?.ctwaClid).toBeNull();
  });

  it("los campos en blanco cuentan como ausentes", () => {
    const parsed = parseInboundMessage(
      textoConReferral((p) => {
        p["message"].referral = {
          source_id: "120226305854810726",
          headline: "   ",
          body: "",
          ctwa_clid: null,
        };
      }),
    );
    expect(parsed?.adReferral?.headline).toBeNull();
    expect(parsed?.adReferral?.body).toBeNull();
    expect(parsed?.adReferral?.ctwaClid).toBeNull();
  });

  it("también la encuentra en un payload con sobre `data`", () => {
    const parsed = parseInboundMessage({
      data: textoConReferral((p) => {
        p["message"].referral = REFERRAL_DE_META;
      }),
    } as KapsoInboundPayload);
    expect(parsed?.adReferral?.adId).toBe("120226305854810726");
  });

  it("la referencia viaja también en mensajes que no son de texto", () => {
    const parsed = parseInboundMessage(
      textoConReferral((p) => {
        p["message"].type = "image";
        p["message"].image = { caption: "quiero este" };
        p["message"].referral = REFERRAL_DE_META;
      }),
    );
    expect(parsed?.kind).toBe("media");
    expect(parsed?.adReferral?.adId).toBe("120226305854810726");
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
