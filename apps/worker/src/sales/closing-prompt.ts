/**
 * Lo que Sebastián lee sobre cómo cerrar. **Puro.**
 *
 * Es un bloque del prompt efectivo y no parte de la persona
 * (`sales/persona.ts`) por la misma razón por la que las reglas duras no son
 * configurables: esto no lo escribe el admin. Describe una herramienta que el
 * sistema le pone en la mano, y aparece **solo cuando la herramienta está
 * puesta** — prometerle una forma de registrar el pedido que no tiene sería la
 * misma promesa vacía que el bloque de apoyos visuales evita al revés.
 *
 * **No nombra el producto**, y no es un olvido: cuando este bloque existe, la
 * ficha del producto está justo debajo con su nombre y su precio. Nombrarlo aquí
 * obligaría a leerlo una segunda vez, y dos lecturas del mismo dato son dos
 * lecturas que un día no coinciden.
 *
 * ## Qué puede y qué no puede sostener este texto
 *
 * Conviene decirlo con precisión, porque la diferencia importa el día que algo
 * salga mal:
 *
 * - **Que no invente precios ni ids de variante** no depende de este texto: no
 *   hay campo donde escribirlos (`closingCaptureSchema`).
 * - **Que no le diga al cliente que su pedido quedó registrado cuando no quedó**
 *   tampoco depende de este texto: en un turno donde el cierre corrió, el texto
 *   del modelo no sale (`closingTurnVoice`).
 * - **Cuándo llamar** —con los datos completos y no antes— sí depende de este
 *   texto. Es lo único que queda del lado blando, y el costo de que falle es
 *   barato y visible: el constructor de orden contesta qué falta y el cliente lo
 *   lee en el momento, que es el primer criterio del ticket funcionando.
 */

import { CLOSING_TOOL_NAME, MAX_QUANTITY } from "./closing-capture";

/** El bloque que le explica cómo se registra un pedido desde el chat. */
export function buildClosingToolBlock(): string {
  return [
    "## Cómo registras el pedido",
    `Cuando la persona ya decidió comprar el producto de arriba, el pedido lo registras tú desde este chat con la herramienta \`${CLOSING_TOOL_NAME}\`. No hay formularios, ni enlaces, ni links de pago: le pides los datos por aquí y llamas la herramienta.`,
    "",
    "Lo que necesitas pedirle, todo junto y en un solo mensaje:",
    "- Nombre y apellido",
    "- Teléfono para la entrega",
    "- Departamento y municipio",
    "- Dirección exacta, o si prefiere reclamar en la oficina de la transportadora",
    "",
    `Llama la herramienta cuando los tengas todos. Pasa cada dato **tal como te lo dijo**: no completes lo que falte, no corrijas su dirección y no inventes un dato que no dio — si falta algo, el sistema te dice qué es y se lo pregunta él mismo. Si pide más de ${MAX_QUANTITY} unidades, no lo registres: dile que lo pasas con un asesor para un pedido de ese tamaño.`,
    "",
    "El pago es contraentrega: paga cuando recibe. Nunca le pidas datos de tarjeta, transferencias ni comprobantes.",
    "",
    "**No le digas que su pedido quedó registrado por tu cuenta.** El sistema le confirma el pedido con su número apenas queda creado, y a ti te dice cómo terminó. Si te dice que no se registró, no lo anuncies como hecho.",
  ].join("\n");
}
