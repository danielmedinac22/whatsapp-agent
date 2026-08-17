import { describe, expect, it } from "vitest";
import {
  evaluateSalesEscalation,
  MAX_PRODUCT_ATTEMPTS,
  type SalesEscalationFacts,
} from "./escalation-triggers";

/** Una conversación que va bien: producto identificado y nadie pidiendo nada raro. */
function conversacion(over: Partial<SalesEscalationFacts> = {}): SalesEscalationFacts {
  return {
    inbound: [],
    productIdentified: true,
    productAttempts: 1,
    ...over,
  };
}

describe("evaluateSalesEscalation · palabra clave de petición de humano", () => {
  it("escala cuando el cliente pide hablar con una persona", () => {
    expect(
      evaluateSalesEscalation(
        conversacion({ inbound: ["quiero hablar con una persona por favor"] }),
      ),
    ).toBe("human_requested");
  });

  it("reconoce la petición con acentos, mayúsculas y sin ellos", () => {
    // Lo que llega por WhatsApp viene tecleado en un teléfono.
    for (const texto of [
      "Me pueden PASAR con un asesor?",
      "necesito un agente",
      "quiero que me atienda una persona",
      "esto es un bot?",
      "atención al cliente",
    ]) {
      expect(evaluateSalesEscalation(conversacion({ inbound: [texto] }))).toBe(
        "human_requested",
      );
    }
  });

  it("no confunde agradecerle al vendedor con pedir otro humano", () => {
    // Sebastián *es* un asesor de ventas: sin verbo de pedir, «asesor» no es
    // una petición de escalar.
    expect(
      evaluateSalesEscalation(conversacion({ inbound: ["gracias asesor, muy amable"] })),
    ).toBeNull();
  });
});

describe("evaluateSalesEscalation · petición fuera de las reglas", () => {
  it("escala cuando piden garantía, devolución o reembolso", () => {
    expect(
      evaluateSalesEscalation(
        conversacion({ inbound: ["y si no me funciona hay devolución?"] }),
      ),
    ).toBe("out_of_rules_request");
  });

  it("escala cuando piden crédito, cuotas o factura", () => {
    expect(
      evaluateSalesEscalation(conversacion({ inbound: ["me lo pueden dar a cuotas?"] })),
    ).toBe("out_of_rules_request");
  });

  it("escala cuando exigen una fecha de entrega comprometida", () => {
    // Historia 17: el vendedor no promete tiempos. La petición pasa a quien sí
    // puede comprometerse.
    expect(
      evaluateSalesEscalation(
        conversacion({ inbound: ["necesito que llegue hoy mismo, es urgente"] }),
      ),
    ).toBe("out_of_rules_request");
  });

  it("escala cuando piden venta al por mayor", () => {
    expect(
      evaluateSalesEscalation(
        conversacion({ inbound: ["quiero comprar al por mayor para revender"] }),
      ),
    ).toBe("out_of_rules_request");
  });

  it("preguntar cuándo llega no es exigir una fecha", () => {
    // La duda de cualquiera. El prompt ya prohíbe contestarla con una fecha;
    // escalar cada una llenaría la bandeja del asesor de conversaciones que
    // iban bien.
    expect(
      evaluateSalesEscalation(conversacion({ inbound: ["llega mañana?"] })),
    ).toBeNull();
  });

  it("pedir descuento NO escala aquí", () => {
    // El límite se aplica al construir la orden, que es donde se sabe de cierto
    // que se pasó. Escalarlo por el texto sería adivinarlo.
    expect(
      evaluateSalesEscalation(conversacion({ inbound: ["me haces un descuento?"] })),
    ).toBeNull();
  });
});

describe("evaluateSalesEscalation · objeción repetida sin avance", () => {
  it("escala cuando repite la misma objeción y la conversación no se movió", () => {
    expect(
      evaluateSalesEscalation(
        conversacion({
          inbound: [
            "está muy caro para mí",
            "y qué trae exactamente",
            "no sé, sigue estando caro",
          ],
        }),
      ),
    ).toBe("repeated_objection");
  });

  it("no escala si entre las dos veces la conversación avanzó", () => {
    // Volver sobre el precio después de pedir el total no es atascamiento: es
    // una negociación normal.
    expect(
      evaluateSalesEscalation(
        conversacion({
          inbound: [
            "me parece caro",
            "cuánto es el total con envío?",
            "bueno, sigue siendo caro pero lo quiero",
          ],
        }),
      ),
    ).toBeNull();
  });

  it("cambiar de objeción no es insistir", () => {
    expect(
      evaluateSalesEscalation(
        conversacion({
          inbound: ["está muy caro", "y no confío en comprar por internet"],
        }),
      ),
    ).toBeNull();
  });

  it("elogiar el producto dos veces no es una objeción repetida", () => {
    // El patrón de precio no lleva comodines: «está muy bueno» no es «caro».
    expect(
      evaluateSalesEscalation(
        conversacion({ inbound: ["está muy bueno", "se ve que está muy bueno"] }),
      ),
    ).toBeNull();
  });

  it("una sola objeción no escala", () => {
    expect(
      evaluateSalesEscalation(conversacion({ inbound: ["me parece muy caro"] })),
    ).toBeNull();
  });
});

describe("evaluateSalesEscalation · dos intentos sin identificar el producto", () => {
  it("escala al segundo intento sin producto", () => {
    expect(
      evaluateSalesEscalation(
        conversacion({
          inbound: ["hola, vi el anuncio", "el de la foto azul"],
          productIdentified: false,
          productAttempts: MAX_PRODUCT_ATTEMPTS,
        }),
      ),
    ).toBe("product_unidentified");
  });

  it("con un solo intento todavía se pregunta, no se escala", () => {
    expect(
      evaluateSalesEscalation(
        conversacion({
          inbound: ["hola, vi el anuncio"],
          productIdentified: false,
          productAttempts: 1,
        }),
      ),
    ).toBeNull();
  });

  it("con el producto ya identificado, los intentos previos no escalan nada", () => {
    expect(
      evaluateSalesEscalation(
        conversacion({
          inbound: ["hola, vi el anuncio", "el serum capilar"],
          productIdentified: true,
          productAttempts: 5,
        }),
      ),
    ).toBeNull();
  });
});

describe("evaluateSalesEscalation · una conversación que avanza normal no escala", () => {
  it("preguntar, dudar y comprar no es motivo de asesor", () => {
    // Importa tanto como los cuatro disparadores: un vendedor que escala ante
    // la primera objeción no vende nada y le llena la bandeja al asesor.
    expect(
      evaluateSalesEscalation(
        conversacion({
          inbound: [
            "hola, vi el anuncio del serum",
            "cuánto cuesta?",
            "y sirve para cabello teñido?",
            "listo, lo quiero",
            "mi dirección es zona 10, ciudad de Guatemala",
          ],
        }),
      ),
    ).toBeNull();
  });

  it("una conversación vacía no escala", () => {
    expect(evaluateSalesEscalation(conversacion({ inbound: [] }))).toBeNull();
  });
});

describe("evaluateSalesEscalation · precedencia", () => {
  it("la petición explícita de humano gana sobre lo demás", () => {
    // Los cuatro hacen lo mismo; el orden solo decide qué lee el asesor en la
    // alerta, y lo más informativo es lo que el cliente pidió con todas las letras.
    expect(
      evaluateSalesEscalation(
        conversacion({
          inbound: ["está caro", "sigue caro, mejor pásame con un asesor"],
          productIdentified: false,
          productAttempts: 3,
        }),
      ),
    ).toBe("human_requested");
  });
});
