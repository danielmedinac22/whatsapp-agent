import { describe, expect, it } from "vitest";
import {
  nativeWithoutPriceDetail,
  planClosingLine,
  storeClosingLine,
  type CatalogProductRow,
  type LineCapture,
} from "./closing-line";

// ── El catálogo, con sus dos mitades ────────────────────────────────────────
//
// La mitad conectada lee su precio de la tienda en tiempo de uso; la nativa lo
// lleva en la columna que agregó la `0028`. Todo este archivo existe para fijar
// que esas dos mitades no se mezclen.

const OPERACION = "op-gt";

const NATIVO: CatalogProductRow = {
  id: "prod-nativo",
  operationId: OPERACION,
  source: "native",
  shopifyProductId: null,
  name: "REVITALHAIR Serum Capilar",
  price: "349.00",
};

const CONECTADO: CatalogProductRow = {
  id: "prod-tienda",
  operationId: OPERACION,
  source: "shopify",
  shopifyProductId: "gid://shopify/Product/7788990011",
  name: null,
  price: null,
};

const UNA_UNIDAD: LineCapture = { cantidad: 1, presentacion: null };

function planear(
  product: CatalogProductRow | null,
  capture: LineCapture = UNA_UNIDAD,
) {
  return planClosingLine({ operationId: OPERACION, product, capture });
}

describe("planClosingLine · un producto creado en el panel", () => {
  it("con precio, la venta se cierra sola y sin preguntarle nada a la tienda", () => {
    const r = planear(NATIVO);
    // Que NO sea `ask_store` es el criterio, no un detalle: un producto que la
    // tienda no tiene, no tiene nada que preguntarle a la tienda.
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.line).toEqual({
      productId: "prod-nativo",
      variantId: null,
      title: "REVITALHAIR Serum Capilar",
      quantity: 1,
      unitPrice: 349,
    });
  });

  it("sin precio no se cierra: pasa a un asesor y dice cuál producto es", () => {
    const r = planear({ ...NATIVO, price: null });
    expect(r.kind).toBe("not_sellable");
    if (r.kind !== "not_sellable") return;
    expect(r.detail).toContain("REVITALHAIR Serum Capilar");
    expect(r.detail).toContain("todavía no tiene precio");
  });

  it("con un precio ilegible en la columna tampoco se inventa un importe", () => {
    // La base lo impide con su `check`, pero el camino que decide una venta no
    // se apoya en que nadie haya escrito por otra vía.
    for (const price of ["", "  ", "no-es-un-numero", "0", "-100"]) {
      expect(planear({ ...NATIVO, price }).kind).toBe("not_sellable");
    }
  });

  it("lleva la cantidad que dijo el cliente, no una", () => {
    const r = planear(NATIVO, { cantidad: 3, presentacion: null });
    expect(r.kind === "ok" && r.line.quantity).toBe(3);
  });

  it("el precio se lee con decimales y sin reformatearse", () => {
    const r = planear({ ...NATIVO, price: "1250.50" });
    expect(r.kind === "ok" && r.line.unitPrice).toBe(1250.5);
  });
});

describe("planClosingLine · un producto conectado a la tienda", () => {
  it("no lee ningún precio de esta base: se lo pide a la tienda", () => {
    const r = planear(CONECTADO);
    expect(r).toEqual({
      kind: "ask_store",
      shopifyProductId: "gid://shopify/Product/7788990011",
    });
  });

  it("aunque alguien le hubiera escrito un precio propio, sigue preguntándole a la tienda", () => {
    // El `check` de la `0028` no deja escribir esta fila. La regla se fija
    // igual: el día que exista por otra vía, el precio que se cobra tiene que
    // seguir siendo el de la tienda y no el de esta columna.
    const r = planear({ ...CONECTADO, price: "1.00" });
    expect(r.kind).toBe("ask_store");
  });

  it("sin identificador de la tienda no se vende: va a una persona", () => {
    const r = planear({ ...CONECTADO, shopifyProductId: null });
    expect(r.kind).toBe("not_sellable");
  });
});

describe("planClosingLine · lo que no es una venta", () => {
  it("sin producto reconocido no hay línea", () => {
    expect(planear(null).kind).toBe("no_product");
  });

  it("un producto de otra operación se lee como si no existiera", () => {
    // La columna `conversations.product_id` es suelta: nada en la base impide
    // que apunte al catálogo del país vecino. Que acá resuelva a «no hay
    // producto» es lo que evita venderle a un guatemalteco el SKU colombiano.
    const r = planear({ ...NATIVO, operationId: "op-co" });
    expect(r.kind).toBe("no_product");
  });
});

// ── La tienda contestando ───────────────────────────────────────────────────

const VARIANTE = {
  id: "gid://shopify/ProductVariant/11",
  title: "Default Title",
  available: true,
  price: "300.00",
};

function desdeLaTienda(
  live: Parameters<typeof storeClosingLine>[0]["live"],
  capture: LineCapture = UNA_UNIDAD,
) {
  return storeClosingLine({ productId: "prod-tienda", live, capture });
}

describe("storeClosingLine · el precio sale de la tienda, en tiempo de uso", () => {
  it("la línea lleva la variante y el precio que contestó la tienda", () => {
    const r = desdeLaTienda({ title: "Colágeno Hidrolizado", variants: [VARIANTE] });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.line).toEqual({
      productId: "prod-tienda",
      variantId: "gid://shopify/ProductVariant/11",
      title: "Colágeno Hidrolizado",
      quantity: 1,
      unitPrice: 300,
    });
  });

  it("con presentación, el título del pedido la nombra", () => {
    const r = desdeLaTienda(
      {
        title: "Colágeno Hidrolizado",
        variants: [
          { ...VARIANTE, title: "250 ml" },
          { ...VARIANTE, id: "v-2", title: "500 ml" },
        ],
      },
      { cantidad: 1, presentacion: "250ml" },
    );
    expect(r.kind === "ok" && r.line.title).toBe("Colágeno Hidrolizado — 250 ml");
  });

  it("con varias presentaciones y ninguna nombrada se le pregunta al cliente", () => {
    const r = desdeLaTienda({
      title: "Colágeno Hidrolizado",
      variants: [
        { ...VARIANTE, title: "250 ml" },
        { ...VARIANTE, id: "v-2", title: "500 ml" },
      ],
    });
    expect(r).toEqual({ kind: "ambiguous_variant", options: ["250 ml", "500 ml"] });
  });

  it("sin presentación disponible con precio, no se cierra", () => {
    const r = desdeLaTienda({
      title: "Colágeno Hidrolizado",
      variants: [{ ...VARIANTE, available: false }],
    });
    expect(r.kind).toBe("not_sellable");
  });

  it("si la tienda no devuelve el producto, tampoco se inventa nada", () => {
    expect(desdeLaTienda(null).kind).toBe("not_sellable");
  });
});

describe("nativeWithoutPriceDetail", () => {
  it("nombra el producto para que se sepa cuál completar en el panel", () => {
    expect(nativeWithoutPriceDetail("Kit Barba Vorare")).toContain(
      "«Kit Barba Vorare»",
    );
  });

  it("sin nombre sigue siendo una frase legible", () => {
    expect(nativeWithoutPriceDetail(null)).toContain("el producto");
  });
});
