import { describe, expect, it } from "vitest";
import {
  MIN_NAME_COVERAGE,
  SEMANTIC_MATCH_CONFIDENCE,
  matchAdCopyToCatalog,
} from "./semantic-match";
import {
  SEMANTIC_CONFIDENCE_THRESHOLD,
  recognizeProduct,
  type CatalogProduct,
} from "./recognition";

// Los nombres son los **reales** del catálogo de Guatemala (lectura a
// producción, 17-ago-2026). Los cuatro primeros son la familia que motivó toda
// la cascada: casi homónimos y la mayoría del volumen de Vorare. Los ids son
// inventados; nada se resuelve por un id escrito a mano.
const DHT: CatalogProduct = { id: "dht", name: "REVITALHAIR - DHT ANTICALVICIE" };
const BLOCKER: CatalogProduct = {
  id: "blocker",
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

const FAMILIA = [DHT, BLOCKER, COMBO_360, HAIR_RECOVERY];
const CATALOGO = [...FAMILIA, DEOS, RELOJ];

/** Los ids que el matcher propone, en el orden en que los devuelve. */
function propuestos(
  headline: string | null,
  body: string | null,
  catalog: readonly CatalogProduct[] = CATALOGO,
): string[] {
  return matchAdCopyToCatalog({ headline, body }, catalog).map(
    (c) => c.productId,
  );
}

/** La cascada entera con este matcher enchufado, que es como corre en el worker. */
function reconocer(
  headline: string | null,
  body: string | null,
  catalog: readonly CatalogProduct[] = CATALOGO,
) {
  return recognizeProduct({
    // Un anuncio que nadie registró: sin mapeo, el nivel 1 no dice nada y la
    // cascada cae al 2, que es lo que estos tests miran.
    referral: { adId: "120210000000000099", headline, body },
    catalog,
    adMappings: [],
    matchSemantically: matchAdCopyToCatalog,
  });
}

describe("el nivel semántico · la familia REVITALHAIR", () => {
  it("un anuncio capilar sobre la familia real propone los cuatro, nunca uno", () => {
    // Coberturas medidas sobre estos nombres: 0,617 · 0,463 · 0,308 · 0,407.
    // El más corto cubre casi el doble que el más largo, y eso NO lo vuelve el
    // elegido: esa diferencia es prosa publicitaria contra cadena de SKU.
    expect(
      propuestos(
        "Adiós a la calvicie",
        "Bloquea la DHT y recupera tu cabello. Tratamiento capilar total.",
      ),
    ).toEqual(FAMILIA.map((p) => p.id));
  });

  it("un anuncio que nombra un SKU de la familia arrastra a sus hermanos", () => {
    // El anuncio dice exactamente el nombre del primero y no dice «blocker» ni
    // «serum». Aun así los tres son candidatos: sus nombres no se distinguen
    // entre sí, así que ningún texto puede separarlos.
    expect(
      propuestos(
        "REVITALHAIR DHT ANTICALVICIE",
        "Detén la caída del cabello en 30 días.",
      ),
    ).toEqual([DHT.id, BLOCKER.id, COMBO_360.id]);
  });

  it("ni siquiera el anuncio que nombra el combo entero elige el combo", () => {
    expect(
      propuestos(
        "REVITALHAIR COMBO 360 con SERUM",
        "Cápsulas más serum capilar de uso diario.",
      ),
    ).toEqual(FAMILIA.map((p) => p.id));
  });

  it("todos los candidatos salen con la misma confianza, así que no hay con qué elegir", () => {
    const confianzas = matchAdCopyToCatalog(
      {
        headline: "Adiós a la calvicie",
        body: "Bloquea la DHT y recupera tu cabello. Tratamiento capilar total.",
      },
      CATALOGO,
    ).map((c) => c.confidence);
    expect(confianzas.length).toBe(4);
    expect(new Set(confianzas).size).toBe(1);
  });

  it("puesta en la cascada, la familia termina en ambiguo con sus cuatro candidatos", async () => {
    const r = await reconocer(
      "Adiós a la calvicie",
      "Bloquea la DHT y recupera tu cabello. Tratamiento capilar total.",
    );
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") return;
    expect(r.candidates).toEqual(FAMILIA);
    expect(r.level).toBe("semantic");
  });

  it("un anuncio de la familia nunca arrastra a un producto de otra categoría", async () => {
    const r = await reconocer(
      "Adiós a la calvicie",
      "Bloquea la DHT y recupera tu cabello. Tratamiento capilar total.",
    );
    if (r.kind !== "ambiguous") throw new Error("debía quedar ambiguo");
    expect(r.candidates).not.toContain(DEOS);
    expect(r.candidates).not.toContain(RELOJ);
  });
});

describe("el nivel semántico · el anuncio que sí se distingue", () => {
  it("un anuncio de reloj resuelve al reloj, que es para lo que existe este nivel", async () => {
    const r = await reconocer(
      "Reloj Curren 8225",
      "Elegancia en tu muñeca. Envío gratis a todo Guatemala.",
    );
    expect(r).toEqual({ kind: "resolved", product: RELOJ, level: "semantic" });
  });

  it("resuelve igual con el anuncio en mayúsculas y sin tildes", async () => {
    const r = await reconocer(
      "DEOS CAPSULAS DESODORIZANTES",
      "FRESCURA NATURAL TODO EL DIA.",
    );
    expect(r).toEqual({ kind: "resolved", product: DEOS, level: "semantic" });
  });

  it("con el titular vacío alcanza el cuerpo del anuncio", async () => {
    const r = await reconocer(
      null,
      "Reloj Curren 8225 con estuche. Elegancia en tu muñeca.",
    );
    expect(r).toEqual({ kind: "resolved", product: RELOJ, level: "semantic" });
  });
});

describe("el nivel semántico · cuando no hay nada que reconocer", () => {
  it("un anuncio de otra categoría no propone ningún producto", async () => {
    const r = await reconocer(
      "Colchón ortopédico",
      "Duerme mejor desde hoy. Envío gratis.",
    );
    expect(r).toEqual({ kind: "unknown", reason: "low-confidence" });
  });

  it("compartir una sola palabra genérica no alcanza para proponer un producto", async () => {
    // «Combo» y «total» están en el nombre más largo de la familia, y aun así
    // cubren 0,286 de él: por debajo del piso. Una palabra suelta compartida es
    // coincidencia, no evidencia.
    const r = await reconocer(
      "Combo de belleza total",
      "Todo lo que necesitas en un solo kit.",
    );
    expect(r).toEqual({ kind: "unknown", reason: "low-confidence" });
  });

  it("un anuncio capilar que no nombra ninguna palabra del catálogo queda desconocido", async () => {
    // Límite medido y aceptado: el matcher compara palabras, no significados.
    // Sale pregunta abierta al lead, que es la dirección segura del error; la
    // forma de resolverlo es registrar el anuncio en el catálogo (nivel 1).
    const r = await reconocer(
      "¿Se te cae el cabello?",
      "Recupéralo con el tratamiento natural que todos usan.",
    );
    expect(r).toEqual({ kind: "unknown", reason: "low-confidence" });
  });
});

describe("el nivel semántico · lo que no puede reventar", () => {
  it("con el catálogo vacío devuelve cero candidatos en vez de lanzar", () => {
    expect(propuestos("Adiós a la calvicie", "Bloquea la DHT", [])).toEqual([]);
  });

  it("un producto conectado a la tienda sin nombre no se propone ni rompe el resto", () => {
    // `products.name` es nulo para los conectados a propósito; si la tienda no
    // respondió, `loadCatalog` los deja con el nombre vacío.
    const sinNombre: CatalogProduct = { id: "de-la-tienda", name: "" };
    expect(
      propuestos("Reloj Curren 8225", "Elegancia en tu muñeca.", [
        sinNombre,
        RELOJ,
      ]),
    ).toEqual([RELOJ.id]);
  });

  it("un catálogo entero sin nombres legibles devuelve cero candidatos", () => {
    expect(
      propuestos("Reloj Curren 8225", "Elegancia.", [
        { id: "a", name: "" },
        { id: "b", name: "   " },
      ]),
    ).toEqual([]);
  });

  it("un anuncio con puro relleno no propone nada", () => {
    expect(propuestos("  ", "de la los para con")).toEqual([]);
  });

  it("un catálogo de un solo producto puede resolver sin quedar ambiguo", async () => {
    const r = await reconocer("Reloj Curren 8225", "Elegancia.", [RELOJ]);
    expect(r).toEqual({ kind: "resolved", product: RELOJ, level: "semantic" });
  });
});

describe("el nivel semántico · las constantes del sistema", () => {
  it("la confianza de un candidato supera el umbral de la cascada", () => {
    // Si alguien baja una y no la otra, este nivel deja de proponer nada y la
    // única señal sería que el vendedor pregunta siempre.
    expect(SEMANTIC_MATCH_CONFIDENCE).toBeGreaterThanOrEqual(
      SEMANTIC_CONFIDENCE_THRESHOLD,
    );
  });

  it("el piso de cobertura deja pasar al nombre más largo de la familia y frena a la palabra suelta", () => {
    // 0,407 es lo que un anuncio capilar cubre del nombre más largo; 0,286 es
    // lo que «combo … total» cubre del mismo nombre. El piso vive en el hueco.
    expect(MIN_NAME_COVERAGE).toBeGreaterThan(0.286);
    expect(MIN_NAME_COVERAGE).toBeLessThan(0.407);
  });

  it("los candidatos salen en el orden del catálogo y no ordenados por parecido", () => {
    // El primero de una lista corta es el que más se elige. Ordenarla por un
    // margen que este módulo declara ruido sería empujar al lead con él.
    const alReves = [RELOJ, DEOS, HAIR_RECOVERY, COMBO_360, BLOCKER, DHT];
    expect(
      propuestos(
        "Adiós a la calvicie",
        "Bloquea la DHT y recupera tu cabello. Tratamiento capilar total.",
        alReves,
      ),
    ).toEqual([HAIR_RECOVERY.id, COMBO_360.id, BLOCKER.id, DHT.id]);
  });
});
