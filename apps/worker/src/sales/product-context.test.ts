import { describe, expect, it } from "vitest";
import {
  nativeProductContext,
  renderProductContextBlock,
  shopifyProductContext,
} from "./product-context";
import type { ShopifyProduct } from "../shopify/admin";

function productoDeTienda(over: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: "gid://shopify/Product/8123",
    title: "REVITALHAIR Serum Capilar",
    handle: "revitalhair-serum",
    descriptionHtml: "<p>Serum con biotina.</p>",
    description: "Serum con biotina.",
    priceRange: { min: "199.00", max: "199.00", currency: "GTQ" },
    variants: [
      { title: "30 ml", price: "199.00", available: true, sku: "RH-30" },
      { title: "60 ml", price: "349.00", available: false, sku: "RH-60" },
    ],
    ...over,
  };
}

describe("renderProductContextBlock · la ficha que ve el vendedor", () => {
  it("lleva nombre, precio, presentaciones y descripción", () => {
    const bloque = renderProductContextBlock({
      name: "REVITALHAIR Serum Capilar",
      description: "Serum con biotina.",
      price: "199 GTQ",
      variants: ["30 ml"],
    });
    expect(bloque).toContain("## Producto del que te escriben");
    expect(bloque).toContain("Producto: REVITALHAIR Serum Capilar");
    expect(bloque).toContain("Precio: 199 GTQ");
    expect(bloque).toContain("Presentaciones disponibles: 30 ml");
    expect(bloque).toContain("Serum con biotina.");
  });

  it("cierra prohibiendo completar lo que la ficha no dice", () => {
    // Es la única defensa contra que el modelo rellene con especificaciones
    // plausibles el hueco de una ficha incompleta.
    const bloque = renderProductContextBlock({
      name: "Producto sin ficha",
      description: null,
      price: null,
      variants: [],
    });
    expect(bloque).toContain("no lo inventes");
  });

  it("lo que la fuente no da, no se nombra", () => {
    const bloque = renderProductContextBlock({
      name: "Producto sin ficha",
      description: null,
      price: null,
      variants: [],
    });
    expect(bloque).not.toContain("Precio:");
    expect(bloque).not.toContain("Presentaciones");
    expect(bloque).not.toContain("Descripción");
  });
});

describe("shopifyProductContext · el producto conectado a la tienda", () => {
  it("toma el precio y solo las presentaciones disponibles", () => {
    // Ofrecer una presentación agotada es una venta que se cae al día
    // siguiente, y la de 60 ml no está disponible.
    const contexto = shopifyProductContext(productoDeTienda());
    expect(contexto.price).toBe("199 GTQ");
    expect(contexto.variants).toEqual(["30 ml"]);
  });

  it("con precios distintos entre presentaciones, muestra el rango", () => {
    const contexto = shopifyProductContext(
      productoDeTienda({
        priceRange: { min: "199.00", max: "349.00", currency: "GTQ" },
      }),
    );
    expect(contexto.price).toBe("199 GTQ – 349 GTQ");
  });

  it("no confunde la variante por defecto de Shopify con una presentación", () => {
    const contexto = shopifyProductContext(
      productoDeTienda({
        variants: [
          { title: "Default Title", price: "199.00", available: true, sku: null },
        ],
      }),
    );
    expect(contexto.variants).toEqual([]);
  });
});

describe("nativeProductContext · el producto del panel", () => {
  it("sale de la fila del catálogo, sin precio ni presentaciones", () => {
    // `products` tiene el mínimo que el reconocimiento necesitaba: nombre y
    // descripción. Un precio nativo es una columna que todavía no existe.
    const contexto = nativeProductContext({
      name: "Combo Vorare",
      description: "Dos serums y un tónico.",
    });
    expect(contexto).toEqual({
      name: "Combo Vorare",
      description: "Dos serums y un tónico.",
      price: null,
      variants: [],
    });
  });

  it("una fila sin nombre no produce ficha", () => {
    expect(nativeProductContext({ name: null, description: "algo" })).toBeNull();
    expect(nativeProductContext({ name: "  ", description: null })).toBeNull();
  });
});
