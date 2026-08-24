/**
 * La descripción de la tienda, dejada en lo que sirve para vender por WhatsApp.
 *
 * **Por qué existe.** La descripción de un producto de Shopify no es una ficha
 * técnica: es el cuerpo de una página de venta. Trae el carrusel de ofertas, el
 * marquesina de sellos repetida para la animación, las reseñas con foto y las
 * instrucciones para tocar un botón que solo existe en el navegador. Medido
 * contra las dos fichas de Vorare: 5.821 y 4.069 caracteres de texto plano, de
 * los cuales el modelo veía 800 — y esos 800 se los comía el encabezado, así
 * que la dosis, la ficha y las contraindicaciones no llegaban nunca.
 *
 * **Lo que este archivo NO hace.** No intenta entender la página ni recortarla
 * por secciones. Una landing no tiene estructura garantizada y un recorte por
 * temas borra justo lo que hacía falta el día que la landing cambia. Lo único
 * que se saca es lo que **se puede probar que sobra**: duplicación literal y
 * decoración sin palabras. Cada regla acá se sostiene sola.
 *
 * Lo que *no* se puede limpiar con reglas —que el texto le hable a alguien que
 * está mirando una página, y que las reseñas sean de otras personas— se resuelve
 * en el prompt, diciéndole al modelo qué está leyendo. Ver
 * `renderProductContextBlock`. Una regla que borra no puede competir con una
 * frase que explica.
 */

/** Un carácter que aporta significado: si no hay ninguno, la línea es adorno. */
const TIENE_PALABRA = /\p{L}|\p{N}/u;

/** La fila de estrellas de una calificación, con o sin el número al lado. */
const SOLO_ESTRELLAS = /^[★☆⭐\s\d.,/·+]+$/u;

/** La inicial en el círculo del avatar de una reseña: una letra, sola. */
const INICIAL_DE_AVATAR = /^\p{Lu}$/u;

/**
 * El testimonio entrecomillado, que es la otra forma en que llega una reseña.
 *
 * Las dos fichas de Vorare traen reseñas y **ninguna de las dos las escribe
 * igual**: una las firma con inicial y sello de compra verificada, la otra las
 * pone entre comillas debajo de las estrellas. No hay un formato de reseña que
 * aprender, así que se reconocen las marcas de una en una. Un párrafo entero
 * entre comillas en la ficha de un producto es alguien citado; el largo mínimo
 * deja pasar una etiqueta corta que sí forme parte del producto.
 */
const TESTIMONIO_CITADO = /^["“”«][\s\S]{40,}["“”»]$/u;

/** El sello que cierra cada reseña. */
const COMPRA_VERIFICADA = /^[✓✔]\s*compra verificada$/iu;

/**
 * La marquesina, dicha una sola vez.
 *
 * Un ticker de sellos se escribe repetido en el HTML para que el bucle de la
 * animación no tenga costura, así que llega como `X X` —o `X X X X`— en una
 * sola línea. No es una línea larga: son dos, pegadas. Se parte por mitades
 * hasta que dejen de ser iguales, que atrapa el ×2 y el ×4; el ×3 se prueba
 * aparte porque no es una mitad de nada.
 */
export function sinRepeticionInterna(linea: string): string {
  let s = linea.trim();
  for (let i = 0; i < 4; i++) {
    const antes = s;
    s = unaVez(s);
    if (s === antes) break;
  }
  return s;
}

function unaVez(s: string): string {
  for (const partes of [2, 3]) {
    if (s.length < partes * 20) continue;
    const trozos = repartir(s, partes);
    if (trozos && trozos.every((t) => t === trozos[0])) return trozos[0]!;
  }
  return s;
}

/** `s` partido en `n` trozos iguales separados por espacio, o `null`. */
function repartir(s: string, n: number): string[] | null {
  const largo = s.length - (n - 1); // los espacios que separan los trozos
  if (largo % n !== 0) return null;
  const paso = largo / n;
  const trozos: string[] = [];
  for (let i = 0; i < n; i++) {
    const desde = i * (paso + 1);
    if (i > 0 && s[desde - 1] !== " ") return null;
    trozos.push(s.slice(desde, desde + paso));
  }
  return trozos;
}

/**
 * Cuántas líneas puede durar una reseña antes de que dejemos de creer que lo es.
 *
 * El límite es lo que vuelve segura la regla: sin él, una inicial suelta en
 * mitad de la página se comería todo hasta la próxima reseña.
 */
const LARGO_MAXIMO_DE_RESENA = 6;

/**
 * Si en `i` empieza una reseña, dónde termina. `null` si no empieza una.
 *
 * Una reseña se reconoce **por dos marcas a la vez**: la inicial del avatar que
 * la abre y el sello de compra verificada que la cierra, con el cuerpo en
 * medio. Pedir las dos es lo que hace que la regla no pueda dispararse en una
 * página que no tiene reseñas — que es la única garantía que puede dar una
 * regla escrita contra una landing y no contra un formato.
 */
function finDeResena(lineas: readonly string[], i: number): number | null {
  if (!INICIAL_DE_AVATAR.test(lineas[i]!)) return null;
  // Las líneas en blanco no cuentan: la landing separa cada renglón de la
  // reseña con el doble salto de `</p>`, así que contarlas haría que el límite
  // se agotara a la mitad de toda reseña de verdad.
  let vistas = 0;
  for (let j = i + 1; j < lineas.length && vistas < LARGO_MAXIMO_DE_RESENA; j++) {
    if (!lineas[j]) continue;
    if (COMPRA_VERIFICADA.test(lineas[j]!)) return j;
    vistas++;
  }
  return null;
}

/**
 * El texto de la tienda sin lo que se puede probar que sobra.
 *
 * **Pura.** Entra el texto plano que ya produjo `htmlToPlainText`, sale el
 * mismo texto sin adorno ni duplicación. Nunca reordena ni resume: lo que
 * queda está en el orden en que la tienda lo escribió, que es lo que permite
 * comparar el antes y el después línea por línea cuando algo se lea raro.
 */
export function textoVendible(descripcion: string): string {
  const lineas = descripcion
    .split("\n")
    .map(sinRepeticionInterna)
    .filter((l, i, todas) => l !== "" || (i > 0 && todas[i - 1] !== ""));

  const salida: string[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]!;

    // El testimonio de otro cliente **entero**, no sus adornos: dejar el cuerpo
    // suelto es peor que dejar la reseña, porque un párrafo sin firma se lee
    // como un hecho del producto y no como lo que alguien contó.
    const fin = finDeResena(lineas, i);
    if (fin !== null) {
      i = fin;
      continue;
    }

    if (!linea) {
      if (salida.length > 0 && salida[salida.length - 1] !== "") salida.push("");
      continue;
    }
    if (!TIENE_PALABRA.test(linea)) continue;
    if (SOLO_ESTRELLAS.test(linea)) continue;
    if (COMPRA_VERIFICADA.test(linea)) continue;
    if (TESTIMONIO_CITADO.test(linea)) continue;
    // La misma línea dos veces seguidas es la marquesina partida en dos nodos,
    // no un énfasis.
    if (salida.length > 0 && salida[salida.length - 1] === linea) continue;
    salida.push(linea);
  }

  while (salida.length > 0 && salida[salida.length - 1] === "") salida.pop();
  while (salida.length > 0 && salida[0] === "") salida.shift();
  return salida.join("\n");
}
