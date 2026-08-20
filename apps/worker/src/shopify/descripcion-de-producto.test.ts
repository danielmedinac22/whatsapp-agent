import { describe, expect, it } from "vitest";
import { htmlToPlainText } from "./admin";

/**
 * La descripción de un producto, de HTML de tienda a texto.
 *
 * ## Por qué esto importa más de lo que parece
 *
 * El mismo texto va a **dos** lugares que no se parecen en nada: la ficha del
 * panel —que lo dibuja con `whitespace-pre-line`, o sea respetando los saltos—
 * y el prompt del vendedor, **topado en 800 caracteres**. Un salto de más es
 * feo en la pantalla y caro en el prompt: cada línea en blanco es presupuesto
 * que no se gasta en decir qué se vende.
 *
 * ## La forma real del HTML de esta tienda
 *
 * No es un párrafo con negritas. La descripción de un producto de Vorare es una
 * **página entera**: 27.655 caracteres con `<style>`, animaciones, letreros
 * rotativos y tablas de precios. Los fixtures de acá imitan esa forma —divs
 * anidados y vacíos— y no un `<p>Hola</p>`, porque el fallo que estas pruebas
 * fijan solo aparece con etiquetas de sobra.
 */
describe("htmlToPlainText · la descripción que ve el panel y el vendedor", () => {
  it("tira los bloques de estilo y de script enteros, no solo sus etiquetas", () => {
    // La descripción de esta tienda empieza con ~600 chars de CSS. Sin esto, el
    // vendedor recibiría `--acento:#06b6d4` como si fuera una característica.
    const html = `<style>.vs{--acento:#06b6d4;}</style><p>Antena HD</p><script>window.x=1</script>`;
    expect(htmlToPlainText(html)).toBe("Antena HD");
  });

  it("los divs vacíos no dejan líneas en blanco, aunque estén anidados", () => {
    // **Éste es el fallo que se vio en pantalla.** Cada etiqueta se reemplaza
    // por un espacio, así que una línea "vacía" queda como `" "` — y el
    // colapso de saltos no la ve, porque los `\n` no quedan pegados. Medido
    // contra la ficha real: 197 líneas en blanco, 175 de ellas con un espacio
    // adentro, y rachas de hasta nueve seguidas.
    const html = `<p>Elige tu pack</p><div><div></div><div></div></div><div><span></span></div><p>1 Antena</p>`;
    const texto = htmlToPlainText(html);

    expect(texto).toBe("Elige tu pack\n\n1 Antena");
    // Ninguna línea puede ser "espacios que parecen vacío": eso es lo que
    // rompía el colapso, y es invisible en un `toEqual` mal leído.
    for (const linea of texto.split("\n")) {
      expect(linea).toBe(linea.trim());
    }
  });

  it("nunca deja más de una línea en blanco seguida", () => {
    // El listón no es "menos saltos": es que exista un tope. Sin tope, un
    // producto con más divs vacíos que otro se ve peor sin que nadie sepa por qué.
    const html = `<p>Uno</p>${"<div> </div>".repeat(20)}<p>Dos</p>`;
    const lineas = htmlToPlainText(html).split("\n");
    let racha = 0;
    let peor = 0;
    for (const l of lineas) {
      if (!l) racha++;
      else {
        peor = Math.max(peor, racha);
        racha = 0;
      }
    }
    expect(peor).toBeLessThanOrEqual(1);
  });

  it("conserva la separación entre párrafos: no aplana todo a una línea", () => {
    // La dirección contraria del error. Un texto sin ningún salto es una pared
    // de letras, y en el panel se lee peor que con espacio de más.
    const html = `<p>Adiós al cable</p><p>TV en HD gratis</p>`;
    expect(htmlToPlainText(html)).toBe("Adiós al cable\n\nTV en HD gratis");
  });

  it("un salto de línea de la tienda sigue siendo un salto", () => {
    expect(htmlToPlainText(`Adiós al cable<br>TV en HD gratis`)).toBe(
      "Adiós al cable\nTV en HD gratis",
    );
  });

  it("las viñetas de una lista quedan como viñetas", () => {
    const html = `<ul><li>Sin mensualidad</li><li>Señal HD</li></ul>`;
    expect(htmlToPlainText(html)).toBe("• Sin mensualidad\n• Señal HD");
  });

  it("las entidades vuelven a ser caracteres", () => {
    expect(htmlToPlainText(`<p>Envío &amp; garantía &quot;90 días&quot;</p>`)).toBe(
      'Envío & garantía "90 días"',
    );
    // `&nbsp;` es espacio, y un párrafo que solo lo contiene no deja línea.
    expect(htmlToPlainText(`<p>Uno</p><p>&nbsp;</p><p>Dos</p>`)).toBe("Uno\n\nDos");
  });

  it("una descripción vacía o sin texto devuelve cadena vacía, no espacios", () => {
    // El panel decide entre la descripción y «Sin descripción en la tienda.»
    // con una comprobación de verdad/falsedad: un `" "` haría que muestre un
    // hueco en vez del texto que explica que no hay descripción.
    for (const html of ["", "<div></div>", "<style>.x{}</style>", "   "]) {
      expect(htmlToPlainText(html)).toBe("");
    }
  });
});
