import { describe, expect, it } from "vitest";
import {
  buildAdIndex,
  buildCatalog,
  isEditableInPanel,
  isUuid,
  productIdsWithinCatalog,
  readAdReferralSignal,
  resolveCatalog,
  resolveProduct,
  resolveProductIdsForAd,
  type Operation,
  type ScopedProductAdRow,
  type ScopedProductRow,
} from "@wa/db";

// UUIDs inventados a propósito, igual que en los dos accesores hermanos: la
// operación se resuelve por su fila, nunca por un identificador de producción
// escrito a mano.
const GUATEMALA_ID = "11111111-1111-4111-8111-111111111111";
const COLOMBIA_ID = "22222222-2222-4222-8222-222222222222";

function operacion(id: string, countryCode: string, currency: string): Operation {
  return {
    id,
    name: countryCode,
    countryCode,
    currency,
    status: "active",
    capiDatasetId: null,
    // Columna de la `0029`, por lo mismo que la de arriba: la fila la tiene.
    metaAdAccountId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const GUATEMALA = operacion(GUATEMALA_ID, "GT", "GTQ");
const COLOMBIA = operacion(COLOMBIA_ID, "CO", "COP");

interface Fila extends ScopedProductRow {
  name: string;
  source: "shopify" | "native";
}

function producto(
  id: string,
  operationId: string,
  name: string,
  source: Fila["source"] = "shopify",
): Fila {
  return { id, operationId, name, source };
}

function mapeo(
  operationId: string,
  productId: string,
  adId: string,
): ScopedProductAdRow {
  return { operationId, productId, adId };
}

// El catálogo real de Vorare, con los tres nombres casi idénticos que son la
// razón por la que el id de anuncio es el nivel primario del reconocimiento.
const DHT = producto("p1", GUATEMALA_ID, "REVITALHAIR – DHT ANTICALVICIE");
const BLOCKER = producto(
  "p2",
  GUATEMALA_ID,
  "REVITALHAIR – DHT BLOCKER ANTICALVICIE",
);
const COMBO = producto(
  "p3",
  GUATEMALA_ID,
  "REVITALHAIR – COMBO DHT + SERUM ANTICALVICIE 360",
);
const SERUM = producto(
  "p4",
  GUATEMALA_ID,
  "REVITALHAIR Serum Capilar",
  "native",
);
/** El mismo producto en el catálogo colombiano: otra fila, otro id, otro país. */
const DHT_CO = producto("q1", COLOMBIA_ID, "REVITALHAIR – DHT ANTICALVICIE");

const catalogoGuatemalteco = [DHT, BLOCKER, COMBO, SERUM];
const dosCatalogos = [...catalogoGuatemalteco, DHT_CO];

/** La forma que tiene producción hoy: ningún producto, ningún mapeo. */
const catalogoVacio: Fila[] = [];

describe("resolveCatalog · aislamiento entre operaciones", () => {
  it("le da a cada operación solo sus productos", () => {
    expect(resolveCatalog(dosCatalogos, GUATEMALA).map((p) => p.id)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
    expect(resolveCatalog(dosCatalogos, COLOMBIA).map((p) => p.id)).toEqual([
      "q1",
    ]);
  });

  it("pedir el catálogo de una operación que no tiene productos no devuelve el de la vecina", () => {
    // Es la regla que comparte con `resolveAgentSettings` y
    // `resolveSalesAgentSettings`. Acá el daño es que el reconocimiento
    // resuelva un lead guatemalteco contra un producto colombiano y le mande al
    // cliente el precio y la moneda del país equivocado.
    expect(resolveCatalog(catalogoGuatemalteco, COLOMBIA)).toEqual([]);
  });

  it("sin ninguna fila el catálogo está vacío para todos", () => {
    // El estado de producción hoy: `products` en cero.
    expect(resolveCatalog(catalogoVacio, GUATEMALA)).toEqual([]);
    expect(resolveCatalog(catalogoVacio, COLOMBIA)).toEqual([]);
  });
});

describe("resolveProduct · un id que llega de afuera", () => {
  it("abre el producto propio", () => {
    expect(resolveProduct(dosCatalogos, GUATEMALA, "p1")?.name).toBe(
      "REVITALHAIR – DHT ANTICALVICIE",
    );
  });

  it("pedir con el id exacto de un producto ajeno devuelve nada, no el producto", () => {
    // El id viaja en la URL de la ficha y en el cuerpo de las peticiones de
    // edición: escribir a mano el uuid del producto colombiano no puede ser
    // una forma de abrirlo —ni de editarlo— desde el panel guatemalteco.
    expect(resolveProduct(dosCatalogos, GUATEMALA, "q1")).toBeNull();
    expect(resolveProduct(dosCatalogos, COLOMBIA, "p1")).toBeNull();
  });

  it("un id que no existe devuelve nada", () => {
    expect(resolveProduct(dosCatalogos, GUATEMALA, "no-existe")).toBeNull();
  });
});

describe("resolveProductIdsForAd · el conjunto que consulta el reconocimiento", () => {
  const mapeos = [
    mapeo(GUATEMALA_ID, "p1", "23851094782"),
    // El anuncio de familia: el mismo id apunta a dos productos a propósito.
    mapeo(GUATEMALA_ID, "p2", "23851094999"),
    mapeo(GUATEMALA_ID, "p4", "23851094999"),
    // Colombia tiene registrado el mismo id de anuncio sobre su propio producto.
    mapeo(COLOMBIA_ID, "q1", "23851094782"),
  ];

  it("un anuncio de familia devuelve todos sus productos, no el primero", () => {
    // Es lo que deja a la cascada quedar ambigua en vez de elegir. Elegir sobre
    // el 77% del volumen es mandarle al cliente el SKU equivocado.
    expect(resolveProductIdsForAd(mapeos, GUATEMALA, "23851094999")).toEqual([
      "p2",
      "p4",
    ]);
  });

  it("el mismo id de anuncio registrado en dos países resuelve solo al producto del país que pregunta", () => {
    expect(resolveProductIdsForAd(mapeos, GUATEMALA, "23851094782")).toEqual([
      "p1",
    ]);
    expect(resolveProductIdsForAd(mapeos, COLOMBIA, "23851094782")).toEqual([
      "q1",
    ]);
  });

  it("un anuncio que nadie registró no devuelve ningún producto", () => {
    expect(resolveProductIdsForAd(mapeos, GUATEMALA, "99999999999")).toEqual([]);
  });

  it("encuentra el anuncio aunque el pegado haya arrastrado espacios", () => {
    // El admin pega el id desde el administrador de anuncios; el copiado trae
    // espacios y saltos de línea. Un id que no encuentra su mapeo se ve igual
    // que un anuncio sin registrar: el módulo parece cargado y no reconoce.
    expect(resolveProductIdsForAd(mapeos, GUATEMALA, "  23851094782\n")).toEqual(
      ["p1"],
    );
  });

  it("un anuncio vacío no consulta nada", () => {
    expect(resolveProductIdsForAd(mapeos, GUATEMALA, "   ")).toEqual([]);
  });
});

describe("productIdsWithinCatalog · a qué productos se puede asociar un anuncio", () => {
  it("acepta los de la operación y descarta los ajenos", () => {
    // La selección múltiple manda una lista de ids desde el navegador: la que
    // llega no es necesariamente la que la pantalla dibujó.
    expect(
      productIdsWithinCatalog(dosCatalogos, GUATEMALA, ["p1", "q1", "p3"]),
    ).toEqual(["p1", "p3"]);
  });

  it("no duplica cuando el mismo producto viene dos veces", () => {
    expect(
      productIdsWithinCatalog(dosCatalogos, GUATEMALA, ["p1", "p1"]),
    ).toEqual(["p1"]);
  });

  it("con todos los ids ajenos no queda ninguno", () => {
    expect(productIdsWithinCatalog(dosCatalogos, COLOMBIA, ["p1", "p2"])).toEqual(
      [],
    );
  });
});

describe("buildCatalog · el N:M como lo ve la pantalla", () => {
  const mapeos = [
    mapeo(GUATEMALA_ID, "p1", "23851094782"),
    mapeo(GUATEMALA_ID, "p2", "23851094999"),
    mapeo(GUATEMALA_ID, "p4", "23851094999"),
    mapeo(COLOMBIA_ID, "q1", "23851094999"),
  ];

  it("un anuncio compartido dice a qué otros productos apunta", () => {
    // Sin esto el N:M existe en la base y no en la pantalla: desde la ficha de
    // un producto, un anuncio compartido parece exclusivo.
    const gt = buildCatalog(dosCatalogos, mapeos, GUATEMALA);
    const blocker = gt.find((e) => e.product.id === "p2");
    expect(blocker?.ads).toEqual([
      { adId: "23851094999", alsoPointsTo: ["p4"] },
    ]);
  });

  it("un anuncio exclusivo no apunta a ningún otro", () => {
    const gt = buildCatalog(dosCatalogos, mapeos, GUATEMALA);
    const dht = gt.find((e) => e.product.id === "p1");
    expect(dht?.ads).toEqual([{ adId: "23851094782", alsoPointsTo: [] }]);
  });

  it("nunca nombra como «también apunta a» un producto de otra operación", () => {
    // El mismo id de anuncio está registrado en los dos países. Si el cruce no
    // filtrara por operación, la ficha guatemalteca diría que su anuncio
    // también apunta al producto colombiano — y ahí el aislamiento se pierde en
    // la pantalla aunque la base lo respete.
    const gt = buildCatalog(dosCatalogos, mapeos, GUATEMALA);
    const todos = gt.flatMap((e) => e.ads.flatMap((a) => a.alsoPointsTo));
    expect(todos).not.toContain("q1");
  });

  it("un producto sin anuncios queda con la lista vacía, que es lo que la pantalla convierte en fuga de reconocimiento", () => {
    const gt = buildCatalog(dosCatalogos, mapeos, GUATEMALA);
    expect(gt.find((e) => e.product.id === "p3")?.ads).toEqual([]);
  });

  it("el catálogo de una operación sin productos queda vacío aunque la otra tenga mapeos", () => {
    expect(buildCatalog(catalogoGuatemalteco, mapeos, COLOMBIA)).toEqual([]);
  });

  it("descarta un mapeo que apunta a un producto que el catálogo no tiene", () => {
    // Puede pasar en una fixture y no en la base —la clave foránea compuesta lo
    // impide—, pero la regla se sostiene en los dos lados.
    const huerfano = [...mapeos, mapeo(GUATEMALA_ID, "borrado", "24019338702")];
    const gt = buildCatalog(dosCatalogos, huerfano, GUATEMALA);
    expect(gt.flatMap((e) => e.ads.map((a) => a.adId))).not.toContain(
      "24019338702",
    );
  });
});

describe("buildAdIndex · el mismo mapeo visto desde el anuncio", () => {
  const mapeos = [
    mapeo(GUATEMALA_ID, "p1", "23851094782"),
    mapeo(GUATEMALA_ID, "p2", "23851094999"),
    mapeo(GUATEMALA_ID, "p4", "23851094999"),
    mapeo(COLOMBIA_ID, "q1", "24019338702"),
  ];

  it("agrupa cada anuncio con todos sus productos", () => {
    expect(buildAdIndex(mapeos, GUATEMALA)).toEqual([
      { adId: "23851094999", productIds: ["p2", "p4"] },
      { adId: "23851094782", productIds: ["p1"] },
    ]);
  });

  it("los compartidos quedan primero, que son los que hay que mirar", () => {
    const [primero] = buildAdIndex(mapeos, GUATEMALA);
    expect(primero?.productIds.length).toBe(2);
  });

  it("no muestra los anuncios de otra operación", () => {
    expect(buildAdIndex(mapeos, GUATEMALA).map((a) => a.adId)).not.toContain(
      "24019338702",
    );
  });
});

describe("isEditableInPanel · el panel no escribe sobre la tienda", () => {
  it("el producto nativo se edita acá", () => {
    expect(isEditableInPanel("native")).toBe(true);
  });

  it("el producto conectado no", () => {
    // Su nombre y su descripción se leen de la tienda en tiempo de uso: por eso
    // `products.name` es nullable. Copiarlos acá sería la desincronización
    // silenciosa que esa decisión existe para evitar.
    expect(isEditableInPanel("shopify")).toBe(false);
  });
});

describe("isUuid · un id que llega del navegador", () => {
  it("acepta un uuid", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
  });

  it("rechaza lo que no lo es", () => {
    // Sin esto, un id inventado entra a la consulta y Postgres responde
    // «invalid input syntax for type uuid» — que el admin lee como una falla
    // del panel y no como «ese producto no es de esta operación».
    expect(isUuid("")).toBe(false);
    expect(isUuid("p1")).toBe(false);
    expect(isUuid("11111111-1111-4111-8111-11111111111")).toBe(false);
  });
});

describe("readAdReferralSignal · que el módulo no pueda estar muerto y verse sano", () => {
  it("sin ninguna referencia jamás dice que nunca llegó una", () => {
    // Es el estado de producción hoy: 1.722 conversaciones, cero con `ad_id`.
    // No es un bug —la pauta apunta a otra WABA— pero es indistinguible de un
    // módulo roto si la pantalla no lo dice.
    expect(
      readAdReferralSignal({
        clicksInWindow: 0,
        registeredClicksInWindow: 0,
        clicksAllTime: 0,
      }),
    ).toBe("nunca_llego_una_referencia");
  });

  it("con clics que no encuentran su anuncio dice que llegan sin registrar", () => {
    // Lo contrario del anterior: acá el mapa está incompleto, no muerto.
    expect(
      readAdReferralSignal({
        clicksInWindow: 12,
        registeredClicksInWindow: 0,
        clicksAllTime: 40,
      }),
    ).toBe("llegan_clics_sin_registrar");
  });

  it("con clics que encuentran su anuncio dice que el mapa se está consultando", () => {
    expect(
      readAdReferralSignal({
        clicksInWindow: 12,
        registeredClicksInWindow: 9,
        clicksAllTime: 40,
      }),
    ).toBe("el_mapa_se_esta_consultando");
  });

  it("hubo clics alguna vez pero no en la ventana", () => {
    // No es lo mismo que «nunca»: el módulo funcionó, así que la pantalla no
    // debe mandar a revisar la integración.
    expect(
      readAdReferralSignal({
        clicksInWindow: 0,
        registeredClicksInWindow: 0,
        clicksAllTime: 40,
      }),
    ).toBe("sin_clics_en_la_ventana");
  });
});
