import { describe, expect, it } from "vitest";
import {
  escalationPhrase,
  escalationReasonFromDedupKey,
  isSalesEscalation,
  parseRecognitionOutcome,
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
  recognitionOutcome: null,
  candidates: [],
  escalations: [],
};

/** Los cuatro de nombre casi idéntico, que son los que motivaron todo esto. */
const FAMILIA = [
  "REVITALHAIR - DHT ANTICALVICIE",
  "REVITALHAIR - DHT BLOCKER ANTICALVICIE",
  "REVITALHAIR COMBO DHT + SERUM ANTICALVICIE 360",
  "Hair Recovery 3X - COMBO RECUPERACION CAPILAR TOTAL",
];

/** Un lead que llegó por el anuncio de la familia y la cascada no pudo elegir. */
const ambigua: SalesContextFacts = {
  ...sinVenta,
  adReferralAt: dia(3),
  adId: "23851094782",
  recognitionOutcome: "ambiguous",
  candidates: FAMILIA,
};

describe("cómo quedó el reconocimiento", () => {
  it("una conversación que no vino de un anuncio no tiene nada que reconocer", () => {
    expect(resolveProductRecognition(sinVenta)).toBe("sin_anuncio");
  });

  it("con producto resuelto queda identificada", () => {
    expect(
      resolveProductRecognition({
        adReferralAt: dia(3),
        productIdentified: true,
        recognitionOutcome: "resolved",
      }),
    ).toBe("identificado");
  });

  it("llegó por un anuncio, la cascada no encontró ni un candidato: sin identificar", () => {
    expect(
      resolveProductRecognition({
        adReferralAt: dia(3),
        productIdentified: false,
        recognitionOutcome: "unknown",
      }),
    ).toBe("sin_identificar");
  });

  it("la cascada dudó entre los cuatro REVITALHAIR: ambiguo, que no es lo mismo", () => {
    // El hallazgo entero del ticket: antes de la 0026 este caso y el de arriba
    // dejaban la misma huella —un producto en null— y la pantalla los contaba
    // igual, mandando al asesor a cargar un anuncio que sí estaba cargado.
    expect(resolveProductRecognition(ambigua)).toBe("ambiguo");
  });

  it("un producto ya resuelto manda sobre un reconocimiento posterior que no supo", () => {
    // El recomprador: hay una conversación por contacto para siempre, así que
    // un clic nuevo en un anuncio que no sabemos reconocer se escribe encima
    // del producto que esa persona sí compró. Decir «sin identificar» ahí
    // borraría de la pantalla algo que la conversación sabe.
    expect(
      resolveProductRecognition({
        adReferralAt: dia(9),
        productIdentified: true,
        recognitionOutcome: "unknown",
      }),
    ).toBe("identificado");
  });

  it("una conversación cuyo reconocimiento todavía no corrió no afirma nada de más", () => {
    // `null` en la columna es la tercera historia: no corrió. Es el estado de
    // las 1.736 conversaciones de hoy.
    expect(
      resolveProductRecognition({
        adReferralAt: dia(3),
        productIdentified: false,
        recognitionOutcome: null,
      }),
    ).toBe("sin_identificar");
  });
});

describe("cómo se lee la columna del resultado", () => {
  it("los tres valores de la cascada se leen tal cual", () => {
    expect(parseRecognitionOutcome("resolved")).toBe("resolved");
    expect(parseRecognitionOutcome("ambiguous")).toBe("ambiguous");
    expect(parseRecognitionOutcome("unknown")).toBe("unknown");
  });

  it("sin valor es «no corrió», no un resultado", () => {
    expect(parseRecognitionOutcome(null)).toBeNull();
  });

  it("un valor que este código no conoce se lee como que no consta", () => {
    // La pantalla dice entonces lo que decía antes de la 0026, en vez de
    // inventarle un estado a una fila que alguien escribió por otra vía.
    expect(parseRecognitionOutcome("quizas")).toBeNull();
    expect(parseRecognitionOutcome("")).toBeNull();
  });
});

describe("qué marca la fila de la bandeja", () => {
  it("una conversación limpia no se marca: marcar todo es no marcar nada", () => {
    expect(
      resolveRowMark({
        ...sinVenta,
        adReferralAt: dia(3),
        productIdentified: true,
        recognitionOutcome: "resolved",
      }),
    ).toBeNull();
  });

  it("la de Katherine, sin anuncio ni escaladas, tampoco se marca", () => {
    expect(resolveRowMark(sinVenta)).toBeNull();
  });

  it("se marca la que llegó por anuncio y no tuvo ni un candidato", () => {
    expect(
      resolveRowMark({
        ...sinVenta,
        adReferralAt: dia(3),
        recognitionOutcome: "unknown",
      }),
    ).toBe("sin_identificar");
  });

  it("la ambigua se marca distinto, porque le pide al asesor lo contrario", () => {
    // «Ambiguo» se resuelve desempatando en el chat; «sin producto» se resuelve
    // cargando el anuncio en el catálogo, que es otra pantalla. Una sola marca
    // para las dos manda al asesor a hacer lo que no es.
    expect(resolveRowMark(ambigua)).toBe("ambiguo");
  });

  it("la escalada gana sobre el producto sin identificar: es una sola cosa que hacer", () => {
    expect(
      resolveRowMark({
        ...sinVenta,
        adReferralAt: dia(3),
        recognitionOutcome: "unknown",
        escalations: [{ at: dia(4), reason: "sales_product_unidentified" }],
      }),
    ).toBe("escalada");
  });

  it("la escalada gana también sobre la duda entre candidatos", () => {
    expect(
      resolveRowMark({
        ...ambigua,
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
        recognitionOutcome: "resolved",
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
        recognitionOutcome: "resolved",
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

  it("cuando la cascada dudó, el hilo cuenta entre qué dudó", () => {
    // Es la información útil de verdad: sin los candidatos, este evento diría
    // lo mismo que «no encontré nada» y volvería a mezclar las dos historias.
    expect(salesThreadEvents(ambigua)).toEqual([
      {
        kind: "producto_ambiguo",
        at: dia(3),
        adId: "23851094782",
        adHeadline: null,
        candidates: FAMILIA,
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
        recognitionOutcome: "unknown",
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
      recognitionOutcome: "resolved",
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
