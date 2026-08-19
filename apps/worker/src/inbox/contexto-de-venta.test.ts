import { describe, expect, it } from "vitest";
import {
  escalationPhrase,
  escalationReasonFromDedupKey,
  isSalesEscalation,
  resolveProductRecognition,
  resolveRowMark,
  salesThreadEvents,
  type SalesContextFacts,
} from "@wa/db";

const dia = (d: number) => new Date(Date.UTC(2026, 6, d, 12, 0, 0));

/** Una conversación sin nada de ventas: la de Katherine de todos los días. */
const sinVenta: SalesContextFacts = {
  adReferralAt: null,
  adId: null,
  adHeadline: null,
  productName: null,
  productIdentified: false,
  escalations: [],
};

describe("cómo quedó el reconocimiento", () => {
  it("una conversación que no vino de un anuncio no tiene nada que reconocer", () => {
    expect(resolveProductRecognition(sinVenta)).toBe("sin_anuncio");
  });

  it("con producto resuelto queda identificada", () => {
    expect(
      resolveProductRecognition({ adReferralAt: dia(3), productIdentified: true }),
    ).toBe("identificado");
  });

  it("llegó por un anuncio y sigue sin producto: sin identificar", () => {
    expect(
      resolveProductRecognition({
        adReferralAt: dia(3),
        productIdentified: false,
      }),
    ).toBe("sin_identificar");
  });
});

describe("qué marca la fila de la bandeja", () => {
  it("una conversación limpia no se marca: marcar todo es no marcar nada", () => {
    expect(
      resolveRowMark({
        ...sinVenta,
        adReferralAt: dia(3),
        adId: "23851094782",
        productName: "REVITALHAIR – DHT ANTICALVICIE",
        productIdentified: true,
      }),
    ).toBeNull();
  });

  it("la de Katherine, sin anuncio ni escaladas, tampoco se marca", () => {
    expect(resolveRowMark(sinVenta)).toBeNull();
  });

  it("se marca la que llegó por anuncio y sigue sin producto", () => {
    expect(
      resolveRowMark({ ...sinVenta, adReferralAt: dia(3), adId: "238" }),
    ).toBe("sin_identificar");
  });

  it("la escalada gana sobre el producto sin identificar: es una sola cosa que hacer", () => {
    expect(
      resolveRowMark({
        ...sinVenta,
        adReferralAt: dia(3),
        escalations: [{ at: dia(4), reason: "sales_product_unidentified" }],
      }),
    ).toBe("escalada");
  });

  it("una conversación con producto reconocido que igual se escaló se marca escalada", () => {
    expect(
      resolveRowMark({
        ...sinVenta,
        adReferralAt: dia(3),
        productIdentified: true,
        productName: "REVITALHAIR",
        escalations: [{ at: dia(4), reason: "sales_human_requested" }],
      }),
    ).toBe("escalada");
  });
});

describe("lo que el hilo cuenta del contexto de venta", () => {
  it("una conversación sin anuncio no agrega ni una línea al hilo", () => {
    expect(salesThreadEvents(sinVenta)).toEqual([]);
  });

  it("el reconocimiento se cuenta con la fecha del clic, que es lo único fechado", () => {
    expect(
      salesThreadEvents({
        ...sinVenta,
        adReferralAt: dia(3),
        adId: "23851094782",
        productName: "REVITALHAIR – DHT ANTICALVICIE",
        productIdentified: true,
      }),
    ).toEqual([
      {
        kind: "producto_identificado",
        at: dia(3),
        productName: "REVITALHAIR – DHT ANTICALVICIE",
        adId: "23851094782",
      },
    ]);
  });

  it("sin producto, el hilo dice que no se logró identificar y de qué anuncio venía", () => {
    expect(
      salesThreadEvents({
        ...sinVenta,
        adReferralAt: dia(3),
        adId: null,
        adHeadline: "Frena la caída del cabello",
      }),
    ).toEqual([
      {
        kind: "producto_sin_identificar",
        at: dia(3),
        adId: null,
        adHeadline: "Frena la caída del cabello",
      },
    ]);
  });

  it("los eventos salen del más viejo al más nuevo, mezclados con lo que pasó después", () => {
    const eventos = salesThreadEvents({
      ...sinVenta,
      adReferralAt: dia(3),
      adId: "238",
      productIdentified: true,
      escalations: [
        { at: dia(9), reason: "sales_repeated_objection" },
        { at: dia(5), reason: "sales_product_unidentified" },
      ],
    });
    expect(eventos.map((e) => e.at)).toEqual([dia(3), dia(5), dia(9)]);
  });
});

describe("el motivo de la escalada, que solo sobrevive en la clave de deduplicación", () => {
  const contacto = "b1e4c8de-4e2f-4a3b-9a1c-2f7d6e5b4a30";

  it("saca el motivo del aviso al cliente", () => {
    expect(
      escalationReasonFromDedupKey(
        `escalation-customer-${contacto}-sales_product_unidentified-489123`,
      ),
    ).toBe("sales_product_unidentified");
  });

  it("un motivo de una sola palabra también sale entero", () => {
    expect(
      escalationReasonFromDedupKey(`escalation-customer-${contacto}-manual-489123`),
    ).toBe("manual");
  });

  it("un motivo que este código no conoce sale tal cual, no se esconde", () => {
    expect(
      escalationReasonFromDedupKey(
        `escalation-customer-${contacto}-sales_motivo_del_futuro-489123`,
      ),
    ).toBe("sales_motivo_del_futuro");
  });

  it("el aviso al admin no cuenta: va al teléfono del administrador, no al hilo del cliente", () => {
    expect(
      escalationReasonFromDedupKey(
        `escalation-customer-`.replace("customer", "admin") +
          `${contacto}-sales_human_requested-489123`,
      ),
    ).toBeNull();
  });

  it("cualquier otra clave de la cola devuelve nada", () => {
    expect(escalationReasonFromDedupKey("followup-1234-abc")).toBeNull();
    expect(escalationReasonFromDedupKey("")).toBeNull();
  });
});

describe("a quién se le atribuye la escalada", () => {
  it("los motivos del vendedor llevan su nombre", () => {
    expect(isSalesEscalation("sales_human_requested")).toBe(true);
    expect(isSalesEscalation("sales_product_unidentified")).toBe(true);
  });

  it("el audio del cliente no es de ventas: existe desde mucho antes que el módulo", () => {
    expect(isSalesEscalation("audio_message")).toBe(false);
    expect(isSalesEscalation("manual")).toBe(false);
    expect(isSalesEscalation(null)).toBe(false);
  });

  it("cada motivo conocido tiene su frase, y el desconocido no inventa ninguna", () => {
    expect(escalationPhrase("sales_product_unidentified")).toBe(
      "tras dos intentos sin identificar el producto",
    );
    expect(escalationPhrase("audio_message")).toBe(
      "porque el cliente mandó un audio",
    );
    expect(escalationPhrase("sales_motivo_del_futuro")).toBeNull();
    expect(escalationPhrase(null)).toBeNull();
  });
});
