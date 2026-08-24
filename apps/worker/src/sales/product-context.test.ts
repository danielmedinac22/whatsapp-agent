import { describe, expect, it } from "vitest";
import {
  nativeProductContext,
  renderProductContextBlock,
  renderVisualSupportSection,
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
      {
        id: "gid://shopify/ProductVariant/301",
        title: "30 ml",
        price: "199.00",
        available: true,
        sku: "RH-30",
      },
      {
        id: "gid://shopify/ProductVariant/601",
        title: "60 ml",
        price: "349.00",
        available: false,
        sku: "RH-60",
      },
    ],
    ...over,
  };
}

describe("renderProductContextBlock · la ficha que ve el vendedor", () => {
  it("lleva nombre, precio, presentaciones y descripción", () => {
    const bloque = renderProductContextBlock({
      name: "REVITALHAIR Serum Capilar",
      salesBrief: null,
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
      salesBrief: null,
      description: null,
      price: null,
      variants: [],
    });
    expect(bloque).toContain("no lo inventes");
  });

  it("lo que la fuente no da, no se nombra", () => {
    const bloque = renderProductContextBlock({
      name: "Producto sin ficha",
      salesBrief: null,
      description: null,
      price: null,
      variants: [],
    });
    expect(bloque).not.toContain("Precio:");
    expect(bloque).not.toContain("Presentaciones");
    expect(bloque).not.toContain("Descripción");
  });
});

describe("renderProductContextBlock · de dónde sale el texto del producto", () => {
  const LANDING = [
    "🔥 Elige tu oferta — la seleccionas en la barra de compra",
    "👇",
    '¿Deseas tu producto? Dale a la barra amarilla "Comprar con envío gratis".',
    "💊 ¿Cómo tomarlo? Toma 2 cápsulas por día, 20–30 min antes de comer.",
  ].join("\n");

  it("con ficha del equipo, la descripción de la tienda no entra", () => {
    // La decisión de diseño del cambio. Sumarlas dejaría al equipo sin saber
    // nunca si su ficha alcanza: la landing taparía el hueco.
    const bloque = renderProductContextBlock({
      name: "REVITALHAIR",
      salesBrief: "2 cápsulas al día con agua. No en embarazo ni lactancia.",
      description: LANDING,
      price: "159 GTQ",
      variants: [],
    });
    expect(bloque).toContain("Ficha del producto, escrita por el equipo");
    expect(bloque).toContain("2 cápsulas al día con agua.");
    expect(bloque).not.toContain("barra amarilla");
  });

  it("con ficha, tampoco lleva el aviso de que está leyendo una página web", () => {
    // El aviso existe para lo que se copió de la landing. Sobre una ficha
    // escrita para WhatsApp sería una advertencia sobre algo que no pasó.
    const bloque = renderProductContextBlock({
      name: "REVITALHAIR",
      salesBrief: "2 cápsulas al día.",
      description: LANDING,
      price: null,
      variants: [],
    });
    expect(bloque).not.toContain("página web");
  });

  it("sin ficha, la tienda entra limpia y avisada", () => {
    const bloque = renderProductContextBlock({
      name: "REVITALHAIR",
      salesBrief: null,
      description: LANDING,
      price: null,
      variants: [],
    });
    expect(bloque).toContain("copiada de su página de venta");
    // Lo que la limpieza saca: la línea que es solo un emoji.
    expect(bloque).not.toContain("👇");
    // Lo que la limpieza NO saca, porque borrarlo por regla es adivinar: la
    // instrucción de tocar un botón. De eso se encarga el aviso.
    expect(bloque).toContain("barra amarilla");
    expect(bloque).toContain("no la mandes a hacer clic en nada");
    // Y lo que hacía falta desde el principio.
    expect(bloque).toContain("2 cápsulas por día");
  });

  it("una ficha en blanco no cuenta como ficha", () => {
    const bloque = renderProductContextBlock({
      name: "REVITALHAIR",
      salesBrief: "   ",
      description: LANDING,
      price: null,
      variants: [],
    });
    expect(bloque).toContain("copiada de su página de venta");
  });

  it("el tope le da lugar a la ficha técnica, que vive al final de la landing", () => {
    // El bug que originó todo: con 800 caracteres, una landing de 5.000 se
    // cortaba en el encabezado y la dosis no llegaba nunca.
    const largo = "Relleno de encabezado. ".repeat(150); // ~3.450 caracteres
    const bloque = renderProductContextBlock({
      name: "REVITALHAIR",
      salesBrief: null,
      description: `${largo}\nDosis: 2 cápsulas por día.`,
      price: null,
      variants: [],
    });
    expect(bloque).toContain("Dosis: 2 cápsulas por día.");
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
          {
            id: "gid://shopify/ProductVariant/1",
            title: "Default Title",
            price: "199.00",
            available: true,
            sku: null,
          },
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
      salesBrief: null,
      description: "Dos serums y un tónico.",
    });
    expect(contexto).toEqual({
      name: "Combo Vorare",
      salesBrief: null,
      description: "Dos serums y un tónico.",
      price: null,
      variants: [],
    });
  });

  it("una fila sin nombre no produce ficha", () => {
    expect(
      nativeProductContext({ name: null, salesBrief: null, description: "algo" }),
    ).toBeNull();
    expect(
      nativeProductContext({ name: "  ", salesBrief: null, description: null }),
    ).toBeNull();
  });
});

describe("renderVisualSupportSection · lo que el cliente está recibiendo", () => {
  it("nombra cada archivo y de qué tipo es", () => {
    // El vendedor tiene que poder hablar de lo que el cliente está viendo. Sin
    // los nombres, lo único que puede hacer es no mencionarlos.
    const seccion = renderVisualSupportSection([
      { filename: "antes-despues.jpg", mime: "image/jpeg" },
      { filename: "testimonio.mp4", mime: "video/mp4" },
      { filename: "ficha-producto.pdf", mime: "application/pdf" },
    ]);
    expect(seccion).toContain("antes-despues.jpg (foto)");
    expect(seccion).toContain("testimonio.mp4 (video)");
    expect(seccion).toContain("ficha-producto.pdf (documento)");
  });

  it("le prohíbe prometer archivos que no están en la lista", () => {
    // El error caro no es quedarse corto: es ofrecer «te paso el catálogo» y
    // dejar al cliente esperando algo que nadie va a mandar.
    const seccion = renderVisualSupportSection([
      { filename: "antes.jpg", mime: "image/jpeg" },
    ]);
    expect(seccion).toContain("No prometas ningún otro archivo");
  });

  it("sin archivos no hay sección", () => {
    // Una sección que dijera «no hay archivos» le daría al modelo un tema del
    // que hablar y algo que disculpar.
    expect(renderVisualSupportSection([])).toBeNull();
  });
});
