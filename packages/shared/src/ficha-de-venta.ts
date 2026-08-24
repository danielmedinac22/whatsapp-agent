/**
 * Hasta dónde llega el texto de un producto en el prompt del vendedor.
 *
 * **Vive acá, y no en el worker, porque hay dos lados que tienen que estar de
 * acuerdo.** El worker lo usa para recortar; el panel lo usa para decirle al
 * equipo cuánto de lo que está escribiendo se va a leer. Dos números distintos
 * significarían un contador que promete algo que el prompt no cumple, y ese
 * desacuerdo no lo ve ningún test que mire un solo lado.
 *
 * **Eran 800, y 800 era el bug.** La descripción de un producto de Shopify no
 * es una ficha técnica: es el cuerpo de una página de venta. Las dos de Vorare
 * miden 5.821 y 4.069 caracteres de texto plano y el modelo veía los primeros
 * 800 — que en una landing son todo encabezado. La dosis del REVITALHAIR
 * empieza en el carácter 2.603 y las contraindicaciones en el 4.565: no
 * llegaban nunca, así que el modelo las completaba con lo que sonaba
 * razonable.
 */
export const TOPE_DE_TEXTO_DEL_PRODUCTO = 6_000;
