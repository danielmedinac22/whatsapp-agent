import { describe, expect, it } from "vitest";
import { nextPageUrl, sortAds, toMetaAds, type MetaAd } from "./ads";

/** La forma exacta que devolvió la cuenta real el 19-ago-2026. */
const RESPUESTA_REAL = {
  data: [
    {
      id: "120249621052150761",
      name: "FRANK 3 NUEVO 25 07",
      effective_status: "PAUSED",
      campaign: {
        name: "DHT ESCALAMIENTO 22 12 05 2026",
        id: "120245351523780761",
      },
    },
    {
      id: "120250080543990761",
      name: "VIDEO 18 VARIACION",
      effective_status: "PAUSED",
      campaign: {
        name: "DHT ESCALAMIENTO 22 12 05 2026",
        id: "120245351523780761",
      },
    },
  ],
  paging: {
    cursors: { before: "QVFI...", after: "QVFI..." },
    next: "https://graph.facebook.com/v25.0/act_2042265076620189/ads?limit=3&after=ELCURSOR",
  },
};

describe("toMetaAds · de lo que contesta Meta a lo que se elige", () => {
  it("lee id, nombre, estado y la campaña", () => {
    expect(toMetaAds(RESPUESTA_REAL)).toEqual([
      {
        id: "120249621052150761",
        name: "FRANK 3 NUEVO 25 07",
        status: "PAUSED",
        campaignName: "DHT ESCALAMIENTO 22 12 05 2026",
        campaignId: "120245351523780761",
      },
      {
        id: "120250080543990761",
        name: "VIDEO 18 VARIACION",
        status: "PAUSED",
        campaignName: "DHT ESCALAMIENTO 22 12 05 2026",
        campaignId: "120245351523780761",
      },
    ]);
  });

  it("un anuncio sin id se descarta: elegirlo no haría nada", () => {
    const ads = toMetaAds({
      data: [{ name: "VIDEO 1", effective_status: "ACTIVE" }, { id: "1", name: "ok" }],
    });
    expect(ads.map((a) => a.id)).toEqual(["1"]);
  });

  it("un anuncio sin nombre se muestra por su id, no en blanco", () => {
    // Una fila vacía en la lista es indistinguible de un error de carga.
    const [ad] = toMetaAds({ data: [{ id: "99", name: "  " }] });
    expect(ad?.name).toBe("(sin nombre) 99");
    expect(ad?.status).toBe("UNKNOWN");
    expect(ad?.campaignName).toBeNull();
  });

  it("una respuesta sin datos, vacía o rara no revienta", () => {
    for (const body of [null, undefined, {}, { data: null }, { data: "x" }, 42]) {
      expect(toMetaAds(body)).toEqual([]);
    }
  });
});

describe("nextPageUrl", () => {
  it("encuentra la página siguiente cuando la hay", () => {
    expect(nextPageUrl(RESPUESTA_REAL)).toContain("after=ELCURSOR");
  });

  it("sin paginación devuelve null, que es lo que corta el bucle", () => {
    for (const body of [null, {}, { paging: {} }, { paging: { next: "" } }]) {
      expect(nextPageUrl(body)).toBeNull();
    }
  });
});

describe("sortAds · el que se va a registrar es el que acaba de lanzarse", () => {
  const ad = (
    name: string,
    status: string,
    campaignName: string | null,
  ): MetaAd => ({ id: name, name, status, campaignName, campaignId: null });

  it("los activos van primero, aunque alfabéticamente vayan últimos", () => {
    // La cuenta arrastra cientos de pausados de meses anteriores. Sin esto la
    // lista se abre en un anuncio apagado desde julio.
    const ordenados = sortAds([
      ad("ZZZ pausado", "PAUSED", "Campaña A"),
      ad("AAA activo", "ACTIVE", "Campaña Z"),
    ]);
    expect(ordenados.map((a) => a.name)).toEqual(["AAA activo", "ZZZ pausado"]);
  });

  it("dentro del mismo estado agrupa por campaña, que es lo que distingue", () => {
    // 92 de 200 anuncios comparten nombre: «VIDEO 1» aparece 23 veces. La
    // campaña es lo único que los separa, así que tiene que ordenar antes que
    // el nombre del anuncio.
    const ordenados = sortAds([
      ad("VIDEO 1", "PAUSED", "DHT WHATSAPP SEBAS"),
      ad("VIDEO 1", "PAUSED", "CJ NEURO WPP"),
      ad("VIDEO 2", "PAUSED", "CJ NEURO WPP"),
    ]);
    expect(ordenados.map((a) => `${a.campaignName} · ${a.name}`)).toEqual([
      "CJ NEURO WPP · VIDEO 1",
      "CJ NEURO WPP · VIDEO 2",
      "DHT WHATSAPP SEBAS · VIDEO 1",
    ]);
  });

  it("no modifica la lista que recibe", () => {
    const original = [ad("B", "PAUSED", null), ad("A", "ACTIVE", null)];
    sortAds(original);
    expect(original.map((a) => a.name)).toEqual(["B", "A"]);
  });
});
