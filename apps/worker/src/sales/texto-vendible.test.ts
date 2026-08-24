import { describe, expect, it } from "vitest";
import { sinRepeticionInterna, textoVendible } from "./texto-vendible";

describe("sinRepeticionInterna · la marquesina dicha una sola vez", () => {
  const SELLOS = "🚚 Envío gratis a toda Guatemala 💵 Pagas al recibir 🛡️ Garantía total";

  it("dos vueltas del ticker quedan en una", () => {
    // Un ticker se escribe repetido en el HTML para que el bucle de la
    // animación no tenga costura, y llega como una sola línea.
    expect(sinRepeticionInterna(`${SELLOS} ${SELLOS}`)).toBe(SELLOS);
  });

  it("cuatro vueltas también, porque se parte por mitades", () => {
    const cuatro = [SELLOS, SELLOS, SELLOS, SELLOS].join(" ");
    expect(sinRepeticionInterna(cuatro)).toBe(SELLOS);
  });

  it("tres vueltas, que no son mitad de nada", () => {
    const tres = [SELLOS, SELLOS, SELLOS].join(" ");
    expect(sinRepeticionInterna(tres)).toBe(SELLOS);
  });

  it("una frase que solo se parece a sí misma no se toca", () => {
    const frase = "Toma 2 cápsulas por día, 20 a 30 minutos antes de comer.";
    expect(sinRepeticionInterna(frase)).toBe(frase);
  });

  it("una línea corta no se parte, aunque repita", () => {
    // El mínimo de largo evita que «sí sí» o «ja ja» se lean como marquesina.
    expect(sinRepeticionInterna("ja ja")).toBe("ja ja");
  });
});

describe("textoVendible · la landing dejada en lo que sirve", () => {
  it("saca las líneas que son solo adorno", () => {
    const limpio = textoVendible(["💊", "👇", "Suplemento anti-caída"].join("\n"));
    expect(limpio).toBe("Suplemento anti-caída");
  });

  it("no confunde adorno con una línea que tiene palabras", () => {
    expect(textoVendible("📚 GRATIS")).toBe("📚 GRATIS");
  });

  it("saca la reseña entera, no solo sus adornos", () => {
    // Dejar el cuerpo suelto es peor que dejar la reseña: un párrafo sin firma
    // se lee como un hecho del producto.
    const conResena = [
      "Beneficios del producto",
      "",
      "B",
      "",
      "Byron M. Ciudad de Guatemala",
      "",
      "★★★★★",
      "",
      "Llevo dos meses y se me nota menos caída.",
      "",
      "✓ Compra verificada",
      "",
      "Dosis: 2 cápsulas por día",
    ].join("\n");
    const limpio = textoVendible(conResena);
    expect(limpio).not.toContain("Byron M.");
    expect(limpio).not.toContain("menos caída");
    expect(limpio).toContain("Beneficios del producto");
    expect(limpio).toContain("Dosis: 2 cápsulas por día");
  });

  it("la inicial suelta sin sello de compra no se lleva nada por delante", () => {
    // Las dos marcas juntas son lo que vuelve segura la regla: sin el sello,
    // una mayúscula suelta se comería la página.
    const texto = ["A", "", "Contenido que se queda", "", "Y más contenido"].join("\n");
    expect(textoVendible(texto)).toContain("Contenido que se queda");
    expect(textoVendible(texto)).toContain("Y más contenido");
  });

  it("saca el testimonio entrecomillado, que es la otra forma de reseña", () => {
    // Las dos fichas de Vorare escriben las reseñas distinto y ninguna coincide
    // con la otra: se reconocen las marcas de una en una.
    const texto = [
      "★★★★★",
      '"La uso en los pies cuando siento ardor al final del día y se absorbe rápido."',
      "Modo de uso: aplicar en la noche",
    ].join("\n");
    const limpio = textoVendible(texto);
    expect(limpio).not.toContain("ardor al final del día");
    expect(limpio).toBe("Modo de uso: aplicar en la noche");
  });

  it("una cita corta no es un testimonio", () => {
    const texto = '"Código Vital"';
    expect(textoVendible(texto)).toBe(texto);
  });

  it("la misma línea dos veces seguidas se dice una", () => {
    const texto = ["Envío gratis a toda Guatemala", "Envío gratis a toda Guatemala"].join("\n");
    expect(textoVendible(texto)).toBe("Envío gratis a toda Guatemala");
  });

  it("no reordena ni resume: lo que queda está en el orden de la tienda", () => {
    // Es lo que permite comparar el antes y el después línea por línea el día
    // que algo se lea raro en una conversación.
    const texto = ["Primero", "Segundo", "Tercero"].join("\n");
    expect(textoVendible(texto)).toBe(texto);
  });

  it("una descripción que es toda adorno queda vacía, no a medias", () => {
    expect(textoVendible("💊\n👇\n★★★★★")).toBe("");
  });
});
