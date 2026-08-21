/**
 * Cómo se distingue en pantalla una operación de otra.
 *
 * Todo lo de este archivo es PURO: recibe un código de país y devuelve con qué
 * se tiñe el marco. No toca la base, ni el reloj, ni React.
 *
 * **Por qué esto es código y no una preferencia del que maquete.** El error que
 * el marco teñido previene —editar el país equivocado— es silencioso: nadie
 * recibe un aviso, el pedido simplemente sale mal. La forma la cerró el usuario
 * el 17-ago-2026 tras tres rondas de prototipos
 * (`ventas-pulido-ui/01`), y trae tres decisiones que no son estéticas:
 *
 * 1. **El tinte muere en el borde del marco.** Estas variables se aplican al
 *    barra de la operación, nunca al contenido. Si el acento
 *    siguiera al país, cada botón primario cambiaría de color y el verde
 *    dejaría de significar «confirmado» — justo en Guatemala, que es lo que
 *    factura. Es el patrón de Slack (el tema tiñe la barra, no los mensajes),
 *    de la consola de AWS y del modo prueba de Stripe.
 * 2. **Violeta Guatemala, azul Colombia.** El criterio no fue cuál se ve mejor
 *    sino cuál es más difícil de confundir de reojo, y eso lo compra la
 *    distancia cromática. El par violeta/rosa se ve más armónico y es el peor
 *    para este trabajo.
 * 3. **Ningún país toma un color que ya significa algo en el contenido.** Se
 *    descartó la escala verde/amarillo/rojo que AWS recomienda: esa codifica
 *    **severidad** (dev < test < prod) y los países no están ordenados por
 *    peligro, son pares.
 *
 * **Los dos tonos se oscurecieron el 20-ago-2026** (decisión 2 de esa tarde) al
 * pasar el panel a fondo claro. Medidos contra `#e8edeb` —la barra plegada—, que es la
 * superficie más oscura de la paleta y por eso la que manda, el violeta
 * `#a78bfa` daba 2,30:1 y el cian `#38bdf8` 1,81:1: fallaban tanto el listón de
 * texto (4,5:1) como el de componente (3:1). Los valores de ahora dan 6,00:1 y
 * 5,01:1 y conservan violeta y azul, que es lo que hace que las dos operaciones
 * se distingan de un vistazo.
 *
 * El hallazgo que hace que esto tenga que ser verificable: «el cambio Guatemala
 * ↔ Colombia se percibe sin explicarlo» hoy lo pasa cualquier cosa, **porque
 * Colombia está vacía y cambia todo el contenido**. El día que opere, dos
 * catálogos con los mismos cuatro nombres REVITALHAIR. Por eso lo que se prueba
 * aquí es que el marco distingue **con el contenido idéntico**.
 */

/** Los cuatro valores que el marco necesita de una operación para teñirse. */
export interface OperationTint {
  /** El color pleno: el borde de la baldosa activa y el número de teléfono. */
  base: string;
  /** El mismo, al 45%: bordes y separadores del marco. */
  line: string;
  /** Al 13%: el relleno de lo que está activo. */
  soft: string;
  /** Al 7%: el degradado del fondo de las barras. */
  faint: string;
}

/**
 * Los tonos elegidos, por código ISO 3166-1 alfa-2 — el mismo que lleva
 * `operations.country_code`.
 */
const TINTS: Readonly<Record<string, string>> = {
  GT: "#6d28d9",
  CO: "#0369a1",
};

/**
 * La rueda de la que sale el tono de un país que todavía no tiene uno elegido.
 *
 * **Ninguno toca un color de {@link RESERVED_CONTENT_COLORS}**, que son los que
 * ya significan algo en el contenido. Un país nuevo entra con un tono
 * distinguible en vez de con el de otro país o con el acento del producto, que
 * es lo que rompería el mecanismo entero el día que alguien dé de alta el
 * tercero sin pasar por aquí.
 *
 * Los cuatro llegan a AA sobre `#e8edeb`, la superficie más oscura de la paleta:
 * 5,10:1, 5,99:1, 6,02:1 y 8,75:1.
 */
const SPARE_TINTS: readonly string[] = [
  "#be185d",
  "#92400e",
  "#166534",
  "#334155",
];

/** Suma estable de un texto. No es criptográfica: solo tiene que ser determinista. */
function codeHash(code: string): number {
  let h = 0;
  for (let i = 0; i < code.length; i++) {
    h = (h * 31 + code.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** `#rrggbb` → `rgba(r, g, b, alpha)`. */
function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * El tinte de una operación por su código de país.
 *
 * Un país sin tono elegido **no cae en un color por defecto compartido**: saca
 * uno estable de {@link SPARE_TINTS}. Dos operaciones con el mismo tinte serían
 * el mecanismo apagado sin que nadie lo note.
 */
export function operationTint(countryCode: string): OperationTint {
  const code = countryCode.trim().toUpperCase();
  const base =
    TINTS[code] ?? SPARE_TINTS[codeHash(code) % SPARE_TINTS.length]!;
  return {
    base,
    line: withAlpha(base, 0.45),
    soft: withAlpha(base, 0.13),
    faint: withAlpha(base, 0.07),
  };
}

/** Los códigos con tono elegido por el usuario, para quien quiera enumerarlos. */
export const OPERATION_TINTS = TINTS;

/**
 * Los colores del contenido que ningún tinte de operación puede tomar: la tinta
 * del producto y los cinco textos de estado. La tinta es «esto se puede tocar»,
 * el ámbar «sin responder», el rojo «escalada», el verde «en automático», el
 * violeta «novedad» y el gris azulado «sin producto». Si un país se pintara de
 * uno de ellos, el color dejaría de querer decir una cosa sola.
 *
 * **Se rederivó con la paleta clara del 20-ago-2026.** Los cuatro valores de
 * antes eran del tema oscuro —menta `#6ee7b7`, `#34d399`, ámbar `#f4c16d` y
 * rojo `#f87171`— y ya no los usa nadie, así que reservarlos no protegía nada.
 */
export const RESERVED_CONTENT_COLORS: readonly string[] = [
  "#0f766e",
  "#8a5a08",
  "#a52020",
  "#0b5f52",
  "#5a41a8",
  "#41586a",
];
