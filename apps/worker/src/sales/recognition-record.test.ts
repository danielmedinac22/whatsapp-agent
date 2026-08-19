import { describe, expect, it } from "vitest";
import {
  recognitionRecord,
  registerRecognition,
  type RecognitionRecord,
} from "./recognition-record";
import type { CatalogProduct, ProductRecognition } from "./recognition";

// Los cuatro nombres son los reales del catálogo de Vorare y los ids son
// inventados, igual que en `recognition.test.ts`: el caso que justifica todo
// este registro es que la cascada dude entre ellos, no cómo se llaman las filas.
const DHT: CatalogProduct = { id: "dht", name: "REVITALHAIR - DHT ANTICALVICIE" };
const DHT_BLOCKER: CatalogProduct = {
  id: "dht-blocker",
  name: "REVITALHAIR - DHT BLOCKER ANTICALVICIE",
};
const COMBO_360: CatalogProduct = {
  id: "combo-360",
  name: "REVITALHAIR COMBO DHT + SERUM ANTICALVICIE 360",
};
const HAIR_RECOVERY: CatalogProduct = {
  id: "hair-recovery",
  name: "Hair Recovery 3X - COMBO RECUPERACION CAPILAR TOTAL",
};
const RELOJ: CatalogProduct = { id: "reloj", name: "RELOJ ELEGANCE - CURREN 8225" };

const LA_DUDA_DE_LOS_CUATRO: ProductRecognition = {
  kind: "ambiguous",
  candidates: [DHT, DHT_BLOCKER, COMBO_360, HAIR_RECOVERY],
  level: "ad-id",
};

describe("qué queda escrito de cómo terminó la cascada", () => {
  it("cuando resolvió, queda el producto y queda dicho que resolvió", () => {
    expect(
      recognitionRecord({ kind: "resolved", product: RELOJ, level: "ad-id" }),
    ).toEqual({
      productRecognition: "resolved",
      productCandidateIds: null,
      productId: "reloj",
    });
  });

  it("la duda entre los cuatro REVITALHAIR queda registrada con los cuatro, en su orden", () => {
    // Es el caso que motivó el ticket: sin los candidatos, «ambiguo» no se
    // puede ni mostrar en la bandeja ni convertir en una pregunta al lead.
    expect(recognitionRecord(LA_DUDA_DE_LOS_CUATRO)).toEqual({
      productRecognition: "ambiguous",
      productCandidateIds: ["dht", "dht-blocker", "combo-360", "hair-recovery"],
    });
  });

  it("registrar la duda no es elegir: no se escribe ningún producto", () => {
    // La regla de toda la cascada, dicha del lado de la escritura. Elegir uno
    // de cuatro casi homónimos es mandarle al cliente el SKU equivocado.
    const record = recognitionRecord(LA_DUDA_DE_LOS_CUATRO);
    expect(record.productId).toBeUndefined();
    expect("productId" in record).toBe(false);
  });

  it("«no encontré nada» se registra, y por eso deja de parecerse a «ambiguo»", () => {
    // Las dos historias que antes contaban lo mismo. Ahora la base las separa,
    // y piden cosas opuestas del asesor: desempatar, o cargar el anuncio.
    const sinCandidatos = recognitionRecord({
      kind: "unknown",
      reason: "low-confidence",
    });
    expect(sinCandidatos).toEqual({
      productRecognition: "unknown",
      productCandidateIds: null,
    });
    expect(sinCandidatos.productRecognition).not.toBe(
      recognitionRecord(LA_DUDA_DE_LOS_CUATRO).productRecognition,
    );
  });

  it("sin resolver, el producto que la conversación ya tenía no se toca", () => {
    // El recomprador: un clic nuevo en un anuncio que no sabemos reconocer no
    // puede borrar el producto que esa persona sí compró. Ausente es «no
    // toques la columna»; nunca se escribe un `null` encima.
    for (const recognition of [
      LA_DUDA_DE_LOS_CUATRO,
      { kind: "unknown", reason: "no-ad-copy" } as const,
    ]) {
      expect("productId" in recognitionRecord(recognition)).toBe(false);
    }
  });

  it("los cuatro motivos de «no encontré nada» se registran igual: son telemetría del log", () => {
    const motivos = [
      "no-referral",
      "empty-catalog",
      "no-ad-copy",
      "low-confidence",
    ] as const;
    for (const reason of motivos) {
      expect(recognitionRecord({ kind: "unknown", reason })).toEqual({
        productRecognition: "unknown",
        productCandidateIds: null,
      });
    }
  });
});

describe("si registrar falla, el mensaje entrante sigue su curso", () => {
  it("una escritura que revienta no lanza: devuelve que no quedó registrado", async () => {
    // El reconocimiento corre en el camino de entrada de todo mensaje, que es
    // el que factura. Un `await` que lanza ahí deja la operación muda.
    let avisado: unknown = null;
    const registrado = await registerRecognition({
      recognition: LA_DUDA_DE_LOS_CUATRO,
      save: () => Promise.reject(new Error("la base se cayó")),
      onFailure: (err) => {
        avisado = err;
      },
    });
    expect(registrado).toBe(false);
    expect(String(avisado)).toContain("la base se cayó");
  });

  it("una escritura que lanza en seco tampoco se escapa", async () => {
    const registrado = await registerRecognition({
      recognition: { kind: "unknown", reason: "low-confidence" },
      save: () => {
        throw new Error("conexión cerrada");
      },
    });
    expect(registrado).toBe(false);
  });

  it("cuando la escritura entra, se escribe una sola vez y con todo el resultado", async () => {
    const escrituras: RecognitionRecord[] = [];
    const registrado = await registerRecognition({
      recognition: LA_DUDA_DE_LOS_CUATRO,
      save: async (record) => {
        escrituras.push(record);
      },
    });
    expect(registrado).toBe(true);
    expect(escrituras).toEqual([
      {
        productRecognition: "ambiguous",
        productCandidateIds: ["dht", "dht-blocker", "combo-360", "hair-recovery"],
      },
    ]);
  });
});
