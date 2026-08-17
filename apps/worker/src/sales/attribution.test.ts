import { describe, expect, it } from "vitest";
import type { ParsedAdReferral } from "../kapso/inbound";
import { decideAdAttribution, type StoredAdAttribution } from "./attribution";

const CLIC = new Date("2026-08-17T10:00:00.000Z");
const CLIC_ANTERIOR = new Date("2026-07-01T09:00:00.000Z");

/** Una conversación que nunca vino de un anuncio: las 1.692 de hoy. */
const SIN_ATRIBUCION: StoredAdAttribution = {
  adId: null,
  adHeadline: null,
  adBody: null,
  adSourceUrl: null,
  ctwaClid: null,
  adReferralAt: null,
  adReferralRaw: null,
  productId: null,
};

/** Una conversación que ya vino de un anuncio y tiene su producto resuelto. */
const ATRIBUCION_DE_JULIO: StoredAdAttribution = {
  adId: "anuncio-julio",
  adHeadline: "Titular de julio",
  adBody: "Cuerpo de julio",
  adSourceUrl: "https://fb.me/julio",
  ctwaClid: "clid-julio",
  adReferralAt: CLIC_ANTERIOR,
  adReferralRaw: { source_id: "anuncio-julio", ctwa_clid: "clid-julio" },
  productId: "producto-julio",
};

function referencia(over: Partial<ParsedAdReferral> = {}): ParsedAdReferral {
  return {
    adId: "anuncio-agosto",
    headline: "Recupera tu cabello",
    body: "REVITALHAIR DHT en 90 días",
    sourceUrl: "https://fb.me/agosto",
    sourceType: "ad",
    ctwaClid: "clid-agosto",
    path: "message.referral",
    raw: { source_id: "anuncio-agosto", ctwa_clid: "clid-agosto" },
    ...over,
  };
}

describe("decideAdAttribution · llega una referencia", () => {
  it("guarda el anuncio y el identificador de clic en la misma escritura", () => {
    const { write } = decideAdAttribution({
      stored: SIN_ATRIBUCION,
      referral: referencia(),
      receivedAt: CLIC,
    });
    expect(write).toEqual({
      adId: "anuncio-agosto",
      adHeadline: "Recupera tu cabello",
      adBody: "REVITALHAIR DHT en 90 días",
      adSourceUrl: "https://fb.me/agosto",
      ctwaClid: "clid-agosto",
      adReferralAt: CLIC,
      adReferralRaw: { source_id: "anuncio-agosto", ctwa_clid: "clid-agosto" },
      productId: null,
    });
  });

  it("el instante es el del mensaje que la trajo, no el del reloj", () => {
    const { write } = decideAdAttribution({
      stored: SIN_ATRIBUCION,
      referral: referencia(),
      receivedAt: CLIC,
    });
    expect(write?.adReferralAt).toBe(CLIC);
  });

  it("guarda el objeto crudo tal cual llegó", () => {
    const raw = {
      source_id: "anuncio-agosto",
      media_type: "video",
      campos_que_no_parseamos: { welcome_message: { text: "hola" } },
    };
    const { write } = decideAdAttribution({
      stored: SIN_ATRIBUCION,
      referral: referencia({ raw }),
      receivedAt: CLIC,
    });
    expect(write?.adReferralRaw).toEqual(raw);
  });

  it("un anuncio sin identificador de clic no inventa uno", () => {
    const { write } = decideAdAttribution({
      stored: SIN_ATRIBUCION,
      referral: referencia({ ctwaClid: null }),
      receivedAt: CLIC,
    });
    expect(write?.adId).toBe("anuncio-agosto");
    expect(write?.ctwaClid).toBeNull();
  });
});

describe("decideAdAttribution · un clic nuevo pisa el anterior", () => {
  it("no deja ni un campo del anuncio viejo", () => {
    const { write } = decideAdAttribution({
      stored: ATRIBUCION_DE_JULIO,
      referral: referencia(),
      receivedAt: CLIC,
    });
    // El anuncio de agosto con el titular de julio es una atribución que nunca
    // existió; con el identificador de clic de julio, además, le reportaría a
    // Meta la venta de una pauta que no la produjo.
    expect(write?.adId).toBe("anuncio-agosto");
    expect(write?.adHeadline).toBe("Recupera tu cabello");
    expect(write?.ctwaClid).toBe("clid-agosto");
    expect(write?.adReferralRaw).toEqual({
      source_id: "anuncio-agosto",
      ctwa_clid: "clid-agosto",
    });
    expect(write?.adReferralAt).toBe(CLIC);
  });

  it("deja el producto sin resolver, para que lo decida el anuncio nuevo", () => {
    const { write } = decideAdAttribution({
      stored: ATRIBUCION_DE_JULIO,
      referral: referencia(),
      receivedAt: CLIC,
    });
    expect(write?.productId).toBeNull();
  });

  it("un clic nuevo sin identificador no revive el identificador viejo", () => {
    const { write } = decideAdAttribution({
      stored: ATRIBUCION_DE_JULIO,
      referral: referencia({ ctwaClid: null }),
      receivedAt: CLIC,
    });
    expect(write?.ctwaClid).toBeNull();
  });

  it("avisa que pisó una atribución anterior — es la única pérdida irreversible", () => {
    const primera = decideAdAttribution({
      stored: SIN_ATRIBUCION,
      referral: referencia(),
      receivedAt: CLIC,
    });
    const segunda = decideAdAttribution({
      stored: ATRIBUCION_DE_JULIO,
      referral: referencia(),
      receivedAt: CLIC,
    });
    expect(primera.overwritesPreviousReferral).toBe(false);
    expect(segunda.overwritesPreviousReferral).toBe(true);
  });

  it("el mismo anuncio otra vez adelanta el instante: el ruteo quiere el más reciente", () => {
    const { write } = decideAdAttribution({
      stored: ATRIBUCION_DE_JULIO,
      referral: referencia({ adId: "anuncio-julio", ctwaClid: "clid-julio-2" }),
      receivedAt: CLIC,
    });
    expect(write?.adReferralAt).toBe(CLIC);
  });
});

describe("decideAdAttribution · el mensaje no trae referencia", () => {
  it("no escribe nada", () => {
    const { write } = decideAdAttribution({
      stored: ATRIBUCION_DE_JULIO,
      referral: null,
      receivedAt: CLIC,
    });
    expect(write).toBeNull();
  });

  it("la conversación conserva su anuncio, su producto y su identificador de clic", () => {
    // Es el caso de toda respuesta de botón o de lista: Meta nunca las
    // acompaña de referencia, y sin esta regla el lead perdería su origen al
    // primer toque.
    const { effective } = decideAdAttribution({
      stored: ATRIBUCION_DE_JULIO,
      referral: null,
      receivedAt: CLIC,
    });
    expect(effective).toEqual(ATRIBUCION_DE_JULIO);
    expect(effective.adReferralAt).toBe(CLIC_ANTERIOR);
  });

  it("una conversación sin anuncio no gana un instante inventado", () => {
    const { effective, write } = decideAdAttribution({
      stored: SIN_ATRIBUCION,
      referral: null,
      receivedAt: CLIC,
    });
    expect(write).toBeNull();
    expect(effective.adReferralAt).toBeNull();
    expect(effective.ctwaClid).toBeNull();
  });
});
