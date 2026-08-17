import { describe, expect, it } from "vitest";
import {
  type AdProductMapping,
  type AdReferralRef,
  type CatalogProduct,
  type SemanticCandidate,
  type SemanticMatcher,
  recognizeProduct,
} from "./recognition";

// Los nombres son los reales del catálogo de Vorare (lectura a producción,
// 17-ago-2026), porque el caso que justifica este módulo es que cuatro de
// ellos son casi idénticos y el primero, por sí solo, es el 77% del volumen.
// Los ids son inventados: la cascada resuelve por mapeo y por confianza,
// nunca por un id escrito a mano.
const DHT: CatalogProduct = {
  id: "dht",
  name: "REVITALHAIR - DHT ANTICALVICIE",
};
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
const DEOS: CatalogProduct = {
  id: "deos",
  name: "DEOS — Cápsulas Desodorizantes Naturales",
};
const RELOJ: CatalogProduct = {
  id: "reloj",
  name: "RELOJ ELEGANCE - CURREN 8225",
};

const FAMILIA_REVITALHAIR = [DHT, DHT_BLOCKER, COMBO_360, HAIR_RECOVERY];
const CATALOGO = [...FAMILIA_REVITALHAIR, DEOS, RELOJ];

// IDs de anuncio con la forma de los de Meta. Ninguno es real.
const ANUNCIO_RELOJ = "120210000000000001";
const ANUNCIO_FAMILIA = "120210000000000002";
const ANUNCIO_NO_REGISTRADO = "120210000000000099";

const MAPEO: AdProductMapping[] = [
  { adId: ANUNCIO_RELOJ, productIds: [RELOJ.id] },
  {
    adId: ANUNCIO_FAMILIA,
    productIds: FAMILIA_REVITALHAIR.map((p) => p.id),
  },
];

function referencia(
  adId: string | null,
  copy: Partial<Pick<AdReferralRef, "headline" | "body">> = {},
): AdReferralRef {
  return {
    adId,
    headline: copy.headline ?? "Detén la caída del cabello",
    body: copy.body ?? "Bloqueador natural de DHT. Resultados en 30 días.",
  };
}

/** Un matcher que siempre dice lo mismo, sin mirar el anuncio ni el catálogo. */
function matcherFijo(
  ...candidatos: Array<[CatalogProduct | { id: string }, number]>
): SemanticMatcher {
  const respuesta: SemanticCandidate[] = candidatos.map(([p, confidence]) => ({
    productId: p.id,
    confidence,
  }));
  return () => respuesta;
}

/** Un matcher que no ve nada en ningún anuncio. */
const matcherMudo: SemanticMatcher = () => [];

describe("recognizeProduct · nivel 1, por ID del anuncio", () => {
  it("un anuncio registrado con un solo producto queda resuelto a ese producto", async () => {
    const r = await recognizeProduct({
      referral: referencia(ANUNCIO_RELOJ),
      catalog: CATALOGO,
      adMappings: MAPEO,
      matchSemantically: matcherMudo,
    });
    expect(r).toEqual({ kind: "resolved", product: RELOJ, level: "ad-id" });
  });

  it("un anuncio registrado con varios productos queda ambiguo con esa lista, no con el catálogo entero", async () => {
    const r = await recognizeProduct({
      referral: referencia(ANUNCIO_FAMILIA),
      catalog: CATALOGO,
      adMappings: MAPEO,
      matchSemantically: matcherMudo,
    });
    expect(r).toEqual({
      kind: "ambiguous",
      candidates: FAMILIA_REVITALHAIR,
      level: "ad-id",
    });
  });

  it("el mapeo del anuncio manda sobre lo que diga el texto", async () => {
    // El copy habla de cabello y un matcher crédulo resolvería a DHT con
    // confianza altísima; pero el admin registró el anuncio para el reloj.
    const r = await recognizeProduct({
      referral: referencia(ANUNCIO_RELOJ),
      catalog: CATALOGO,
      adMappings: MAPEO,
      matchSemantically: matcherFijo([DHT, 0.99]),
    });
    expect(r).toEqual({ kind: "resolved", product: RELOJ, level: "ad-id" });
  });

  it("un mapeo que apunta a productos fuera del catálogo cuenta como anuncio no registrado", async () => {
    // El catálogo es el de la operación: un anuncio mal etiquetado hacia un
    // producto de otro país no resuelve a él, y la cascada sigue por el texto.
    const r = await recognizeProduct({
      referral: referencia(ANUNCIO_RELOJ),
      catalog: CATALOGO,
      adMappings: [
        { adId: ANUNCIO_RELOJ, productIds: ["producto-de-otra-operacion"] },
      ],
      matchSemantically: matcherFijo([DEOS, 0.9]),
    });
    expect(r).toEqual({ kind: "resolved", product: DEOS, level: "semantic" });
  });

  it("el mismo anuncio repartido en varias filas del mapeo se junta en una sola lista", async () => {
    // Es la forma natural de una tabla de unión: una fila por par.
    const r = await recognizeProduct({
      referral: referencia(ANUNCIO_FAMILIA),
      catalog: CATALOGO,
      adMappings: [
        { adId: ANUNCIO_FAMILIA, productIds: [DHT_BLOCKER.id] },
        { adId: ANUNCIO_FAMILIA, productIds: [DHT.id] },
        { adId: ANUNCIO_FAMILIA, productIds: [DHT.id] },
      ],
      matchSemantically: matcherMudo,
    });
    expect(r).toEqual({
      kind: "ambiguous",
      candidates: [DHT, DHT_BLOCKER],
      level: "ad-id",
    });
  });

  it("el ID del anuncio se compara sin los espacios que deja el pegado", async () => {
    const r = await recognizeProduct({
      referral: referencia(` ${ANUNCIO_RELOJ}`),
      catalog: CATALOGO,
      adMappings: [{ adId: `${ANUNCIO_RELOJ} `, productIds: [RELOJ.id] }],
      matchSemantically: matcherMudo,
    });
    expect(r).toEqual({ kind: "resolved", product: RELOJ, level: "ad-id" });
  });
});

describe("recognizeProduct · nivel 2, por texto del anuncio", () => {
  it("un anuncio no registrado que el matcher reconoce con confianza queda resuelto", async () => {
    const r = await recognizeProduct({
      referral: referencia(ANUNCIO_NO_REGISTRADO, {
        headline: "Reloj Curren 8225",
        body: "Elegancia en tu muñeca. Envío gratis.",
      }),
      catalog: CATALOGO,
      adMappings: MAPEO,
      matchSemantically: matcherFijo([RELOJ, 0.93], [DEOS, 0.1]),
    });
    expect(r).toEqual({ kind: "resolved", product: RELOJ, level: "semantic" });
  });

  it("un anuncio no registrado con dos candidatos confiables queda ambiguo con ellos", async () => {
    const r = await recognizeProduct({
      referral: referencia(ANUNCIO_NO_REGISTRADO),
      catalog: CATALOGO,
      adMappings: MAPEO,
      matchSemantically: matcherFijo(
        [DHT, 0.9],
        [DHT_BLOCKER, 0.85],
        [COMBO_360, 0.4],
      ),
    });
    expect(r).toEqual({
      kind: "ambiguous",
      candidates: [DHT, DHT_BLOCKER],
      level: "semantic",
    });
  });

  it("un candidato por debajo del umbral no cuenta ni aunque sea el único", async () => {
    const r = await recognizeProduct({
      referral: referencia(ANUNCIO_NO_REGISTRADO),
      catalog: CATALOGO,
      adMappings: MAPEO,
      matchSemantically: matcherFijo([RELOJ, 0.6]),
    });
    expect(r).toEqual({ kind: "unknown", reason: "low-confidence" });
  });

  it("un producto que el matcher inventa fuera del catálogo se ignora", async () => {
    // Un modelo puede devolver un id que no existe. Que lo haga con la
    // confianza más alta de todas no lo vuelve un candidato.
    const r = await recognizeProduct({
      referral: referencia(ANUNCIO_NO_REGISTRADO),
      catalog: CATALOGO,
      adMappings: MAPEO,
      matchSemantically: matcherFijo([{ id: "fantasma" }, 0.99], [RELOJ, 0.9]),
    });
    expect(r).toEqual({ kind: "resolved", product: RELOJ, level: "semantic" });
  });

  it("los candidatos ambiguos salen de mayor a menor confianza, para la lista corta", async () => {
    const r = await recognizeProduct({
      referral: referencia(ANUNCIO_NO_REGISTRADO),
      catalog: CATALOGO,
      adMappings: MAPEO,
      matchSemantically: matcherFijo([COMBO_360, 0.85], [DHT, 0.95]),
    });
    expect(r).toEqual({
      kind: "ambiguous",
      candidates: [DHT, COMBO_360],
      level: "semantic",
    });
  });

  it("un anuncio no registrado sin titular ni cuerpo queda desconocido, aunque el matcher tuviera opinión", async () => {
    // Sin copy no hay nada que matchear. Es también el rastro que dejaría un
    // proveedor que recorta el titular y el cuerpo del anuncio.
    const r = await recognizeProduct({
      referral: { adId: ANUNCIO_NO_REGISTRADO, headline: "  ", body: null },
      catalog: CATALOGO,
      adMappings: MAPEO,
      matchSemantically: matcherFijo([RELOJ, 0.99]),
    });
    expect(r).toEqual({ kind: "unknown", reason: "no-ad-copy" });
  });

  it("acepta un matcher asíncrono, que es lo que será en producción", async () => {
    const r = await recognizeProduct({
      referral: referencia(ANUNCIO_NO_REGISTRADO),
      catalog: CATALOGO,
      adMappings: MAPEO,
      matchSemantically: async () => [{ productId: DEOS.id, confidence: 0.9 }],
    });
    expect(r).toEqual({ kind: "resolved", product: DEOS, level: "semantic" });
  });
});

describe("recognizeProduct · el caso REVITALHAIR", () => {
  it("cuatro nombres casi idénticos que el matcher ve parecidos dan ambiguo, nunca una elección", async () => {
    // Un anuncio de la familia que el admin no registró. El matcher devuelve
    // confianzas altas y cercanas —pero NO iguales— para los cuatro. La regla
    // que este test protege: tener la confianza más alta no es ganar.
    const r = await recognizeProduct({
      referral: referencia(ANUNCIO_NO_REGISTRADO, {
        headline: "Adiós a la calvicie",
        body: "Bloquea la DHT y recupera tu cabello. Tratamiento capilar total.",
      }),
      catalog: CATALOGO,
      adMappings: MAPEO,
      matchSemantically: matcherFijo(
        [DHT, 0.92],
        [DHT_BLOCKER, 0.9],
        [COMBO_360, 0.86],
        [HAIR_RECOVERY, 0.83],
        [DEOS, 0.05],
      ),
    });
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") return;
    expect(r.candidates).toEqual(FAMILIA_REVITALHAIR);
    expect(r.candidates).not.toContain(DEOS);
  });

  it("aunque el matcher favorezca a uno por más de un margen, si otro también es confiable no elige", async () => {
    // 0,97 contra 0,81: una regla de «gana el mejor por un margen» resolvería
    // a DHT. Aquí no existe esa regla, y sobre el 77% del volumen no debe
    // existir: dos productos confiables para el mismo copy es que el copy no
    // los distingue.
    const r = await recognizeProduct({
      referral: referencia(ANUNCIO_NO_REGISTRADO),
      catalog: CATALOGO,
      adMappings: MAPEO,
      matchSemantically: matcherFijo([DHT, 0.97], [DHT_BLOCKER, 0.81]),
    });
    expect(r).toEqual({
      kind: "ambiguous",
      candidates: [DHT, DHT_BLOCKER],
      level: "semantic",
    });
  });
});

describe("recognizeProduct · sin nada que reconocer", () => {
  it("un mensaje sin referencia de anuncio queda desconocido", async () => {
    // Un «hola» orgánico. Ni el mapeo ni un matcher entusiasta cambian eso.
    const r = await recognizeProduct({
      referral: null,
      catalog: CATALOGO,
      adMappings: MAPEO,
      matchSemantically: matcherFijo([RELOJ, 0.99]),
    });
    expect(r).toEqual({ kind: "unknown", reason: "no-referral" });
  });

  it("una referencia con catálogo vacío queda desconocida", async () => {
    // Hay anuncio, hay mapeo y hay un matcher que opinaría; pero no hay
    // productos que reconocer, y la cascada no inventa ninguno.
    const r = await recognizeProduct({
      referral: referencia(ANUNCIO_RELOJ),
      catalog: [],
      adMappings: MAPEO,
      matchSemantically: matcherFijo([RELOJ, 0.99]),
    });
    expect(r).toEqual({ kind: "unknown", reason: "empty-catalog" });
  });
});
