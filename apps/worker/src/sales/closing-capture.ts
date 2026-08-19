/**
 * Cómo el vendedor entrega los datos del cliente, y qué pasa con el turno
 * después.
 *
 * Todo lo de este archivo es PURO: no toca la base, ni la tienda, ni el modelo.
 * Es la mitad decidible del eslabón que faltaba —el cierre existía entero y no
 * tenía cómo dispararse— y por eso vive aparte del adaptador que sí llama a la
 * tienda (`agent/sales-closing-tool.ts`).
 *
 * ## La regla que gobierna la forma de la captura
 *
 * **El modelo entrega palabras; el código entrega ids y precios.** Lo que
 * Sebastián puede decir es lo que el cliente le dijo —cómo se llama, dónde vive,
 * cuántas quiere, qué presentación— y nada más. Ni el id de la variante ni el
 * precio unitario están en {@link ClosingCapture}, y no es una omisión: un
 * modelo que puede escribir el precio de una línea puede equivocarse en el
 * precio de una línea, y en contraentrega eso no se descubre hasta que el
 * repartidor está en la puerta cobrando otra cifra. El precio sale de la tienda,
 * en tiempo de uso, igual que la ficha del producto.
 *
 * Por lo mismo la cantidad tiene techo. No es una regla de negocio inventada:
 * es que un dígito de más —«20» donde el cliente dijo «2»— es un despacho
 * contraentrega de veinte unidades que nadie pidió, y el error se paga entero
 * porque no hay cobro previo que lo frene. Pasado el techo el caso va a una
 * persona en vez de crearse.
 *
 * ## Y la regla que gobierna el turno
 *
 * **En un turno donde el cierre corrió, el cierre es quien habla.** El texto que
 * el modelo redacta después de que la herramienta contesta **no sale**, y eso es
 * lo único que impide el fallo que este camino existe para evitar, al revés: que
 * el cliente lea «tu pedido quedó registrado» cuando no quedó. Se midió con el
 * modelo de producción y no es hipotético — contestó exactamente eso después de
 * recibir el resultado de la herramienta. Un prompt puede pedirle que no lo
 * diga; solo no mandar su texto garantiza que no lo diga.
 *
 * Cuando el cierre **no** habló —modo seco, o el cierre encolado— el turno no se
 * puede quedar mudo: el cliente acaba de dictar su dirección. Sale un texto fijo
 * y honesto, que no afirma que el pedido exista. Ver
 * {@link closingPendingMessage}.
 */

import { z } from "zod";
import type { CloseSaleResult } from "./closing";
import type { ClosingLine, SalesClosing } from "./order";

/**
 * El nombre con el que el modelo ve la herramienta. Vive acá —y no en el
 * adaptador— porque el bloque de instrucciones del prompt lo nombra, y un
 * nombre escrito dos veces es un nombre que un día no coincide.
 */
export const CLOSING_TOOL_NAME = "registrar_pedido";

/**
 * El techo de unidades que se cierran desde el chat.
 *
 * Veinte es holgado para el negocio real —el pedido típico es de una a tres— y
 * angosto para el error que importa: un cero de más. Pasado el techo no se
 * rechaza la venta, se pasa a una persona, que es la diferencia entre proteger
 * la operación y perder un mayorista.
 */
export const MAX_QUANTITY = 20;

/**
 * Lo que el vendedor captura de la conversación.
 *
 * Los nombres son los que el modelo lee, así que van en el idioma en el que
 * transcurre la conversación. Todo lo que el cliente puede no haber dicho
 * todavía es nullable **a propósito**: la herramienta tiene que poder recibir un
 * cierre incompleto para que el constructor de orden diga qué falta y el cliente
 * lo lea en el momento. Un esquema que exigiera todo dejaría al modelo
 * inventando el hueco para poder llamar.
 */
export const closingCaptureSchema = z.object({
  nombre: z.string().nullable().describe("Nombre de pila, tal como lo dijo."),
  apellido: z.string().nullable().describe("Apellido, tal como lo dijo."),
  telefono: z
    .string()
    .nullable()
    .describe("Teléfono de contacto para la entrega, tal como lo dictó."),
  departamento: z.string().nullable().describe("Departamento de la entrega."),
  municipio: z.string().nullable().describe("Municipio de la entrega."),
  direccion: z
    .string()
    .nullable()
    .describe(
      "Dirección exacta de entrega. Null si va a reclamar en oficina.",
    ),
  reclama_en_oficina: z
    .boolean()
    .describe(
      "true solo si el cliente dijo que prefiere reclamar en la oficina de la transportadora.",
    ),
  email: z.string().nullable().describe("Correo. Es opcional; null si no lo dio."),
  cantidad: z.number().int().describe("Cuántas unidades quiere."),
  presentacion: z
    .string()
    .nullable()
    .describe(
      "Qué presentación eligió, con el nombre exacto de la lista de presentaciones disponibles. Null si el producto tiene una sola.",
    ),
  descuento_pct: z
    .number()
    .describe(
      "Descuento pactado en la conversación, en porcentaje. 0 si no pactaste ninguno.",
    ),
});

/** Lo que el modelo entrega, ya validado por el esquema. */
export type ClosingCapture = z.infer<typeof closingCaptureSchema>;

/**
 * Qué presentación eligió, contra las que la tienda dice que hay.
 *
 * Es puro y devuelve una unión porque los tres casos se atienden distinto: con
 * una sola presentación no hay nada que preguntar, con varias y ninguna nombrada
 * **hay que preguntarle al cliente** —no elegir por él, que es despachar lo que
 * no pidió—, y sin ninguna disponible no hay nada que vender y lo mira una
 * persona.
 */
export type VariantPick<V> =
  | { kind: "ok"; variant: V }
  /** Varias presentaciones y el cliente no dijo cuál. Se le pregunta. */
  | { kind: "ambiguous"; options: readonly string[] }
  /** La tienda no ofrece ninguna vendible. No es del cliente. */
  | { kind: "none" };

/** Comparación tolerante: el cliente escribe «250 ml» y la tienda dice «250ml». */
function sameTitle(a: string, b: string): boolean {
  const clean = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  return clean(a) === clean(b) && clean(a).length > 0;
}

/**
 * La presentación elegida.
 *
 * Con una sola disponible se usa esa **aunque el cliente no la haya nombrado**:
 * no hay ambigüedad que resolver. Con varias, el nombre tiene que coincidir con
 * una; si no coincide con ninguna se pregunta en vez de adivinar la más
 * parecida, porque «la más parecida» entre dos presentaciones de un mismo
 * producto es exactamente cómo se despacha la equivocada.
 */
export function pickVariant<V extends { title: string }>(
  available: readonly V[],
  stated: string | null,
): VariantPick<V> {
  const [only] = available;
  if (!only) return { kind: "none" };
  if (available.length === 1) return { kind: "ok", variant: only };

  const said = stated?.trim();
  const match = said
    ? available.find((v) => sameTitle(v.title, said))
    : undefined;
  if (match) return { kind: "ok", variant: match };
  return { kind: "ambiguous", options: available.map((v) => v.title) };
}

/** Si la cantidad capturada es una que no se cierra sola. */
export function quantityOutOfRange(quantity: number): boolean {
  return (
    !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY
  );
}

/**
 * De lo capturado al cierre que `closeSale` espera.
 *
 * La línea llega **ya resuelta** contra la tienda y no se deriva de lo
 * capturado: es el punto donde se hace cumplir que el precio y el id de la
 * variante no vienen del modelo. `leadRef` es el id de la conversación, que es
 * de donde sale la llave de idempotencia — no entra nada del reloj, para que dos
 * disparos del mismo cierre colisionen.
 */
export function capturedToClosing(input: {
  leadRef: string;
  capture: ClosingCapture;
  line: ClosingLine;
}): SalesClosing {
  const c = input.capture;
  return {
    leadRef: input.leadRef,
    contact: {
      firstName: c.nombre,
      lastName: c.apellido,
      phone: c.telefono,
      city: c.municipio,
      division: c.departamento,
      address: c.direccion,
      pickupAtOffice: c.reclama_en_oficina,
      email: c.email,
    },
    lines: [input.line],
    discountPct: c.descuento_pct,
  };
}

/**
 * Quién habla en un turno donde el cierre corrió.
 *
 * `closing_spoke` significa que el texto del modelo **se descarta**: el cierre
 * ya le escribió al cliente lo que había que escribirle —la corrección, el aviso
 * de escalamiento, o el pedido creado con su número— y dejar salir además la
 * redacción del modelo es duplicar el mensaje en el mejor caso y contradecirlo
 * en el peor.
 *
 * `closing_silent` son los dos casos en que el cierre calla a propósito y el
 * cliente igual está esperando: el modo seco, que no creó nada y no le puede
 * decir que sí, y el cierre encolado, que todavía no llegó a la tienda.
 */
export type ClosingTurnVoice =
  | { kind: "closing_spoke" }
  | { kind: "closing_silent" };

export function closingTurnVoice(result: CloseSaleResult): ClosingTurnVoice {
  switch (result.kind) {
    case "invalid":
    case "escalated":
    case "created":
    case "duplicate":
      return { kind: "closing_spoke" };
    case "dry_run":
    case "queued":
      return { kind: "closing_silent" };
  }
}

/**
 * Cómo terminó el cierre en este turno, si es que se disparó.
 *
 * `result` en `null` —el caso de siempre— es que la herramienta no se llamó y el
 * turno es el de antes, sin una línea de diferencia. Vive acá y no en el
 * adaptador porque es lo que {@link resolveSalesTurnText} necesita para decidir,
 * y la decisión es la parte que se puede probar sin base ni tienda.
 */
export interface ClosingTurnOutcome {
  /** Si el cierre ya le escribió al cliente y el texto del modelo sobra. */
  suppressModelText: boolean;
  /** El resultado del cierre. `null` si no llegó a correr. */
  result: CloseSaleResult | null;
}

/** Qué sale de un turno del vendedor, y por qué. */
export interface SalesTurnText {
  /** Lo que se le manda al cliente. Vacío = no sale nada en este turno. */
  body: string;
  /**
   * De dónde salió. Es para el log y para los tests: la diferencia entre «el
   * modelo no dijo nada» y «el cierre ya habló» es la que uno quiere ver en
   * producción a las tres de la mañana.
   */
  source: "model" | "closing_pending" | "suppressed" | "empty";
}

/**
 * Qué texto sale del turno del vendedor. **Puro.**
 *
 * Las tres reglas, en orden:
 *
 * 1. **Si el cierre ya le habló al cliente, el modelo no habla.** Se midió que
 *    el modelo, al recibir el resultado de la herramienta, redacta «tu pedido
 *    quedó registrado» — una frase que es cierta o falsa según cómo terminó el
 *    cierre, y que el modelo no está en condiciones de calificar. El único texto
 *    que no puede mentir es el que no se manda.
 * 2. **Si el cierre corrió y calló a propósito** —modo seco, o encolado— sale un
 *    texto fijo que dice que los datos están y **no** que el pedido exista. El
 *    turno no se puede quedar mudo: el cliente acaba de dictar su dirección.
 * 3. **Si la herramienta no corrió**, sale el texto del modelo, que es el turno
 *    de siempre.
 */
export function resolveSalesTurnText(input: {
  modelText: string;
  closing: ClosingTurnOutcome;
  /** Se recibe en vez de importarse para que este archivo siga sin redactar. */
  pendingMessage: string;
}): SalesTurnText {
  if (input.closing.suppressModelText) {
    return { body: "", source: "suppressed" };
  }
  if (input.closing.result !== null) {
    return { body: input.pendingMessage, source: "closing_pending" };
  }
  const text = input.modelText.trim();
  return text
    ? { body: text, source: "model" }
    : { body: "", source: "empty" };
}

/**
 * Lo que la herramienta le devuelve al modelo.
 *
 * **No es lo que el cliente lee.** Es lo que Sebastián sabe al terminar de
 * registrar, y se lo decimos aunque su texto no vaya a salir en los casos en que
 * el cierre habló: el turno siguiente lo tiene en la historia, y un vendedor que
 * no sabe si el pedido se creó vuelve a pedir los datos.
 */
export function closingToolReport(result: CloseSaleResult): {
  estado: string;
  detalle: string;
} {
  switch (result.kind) {
    case "created":
      return {
        estado: "registrado",
        detalle: `El pedido ${result.orderName} quedó creado y ya se le confirmó al cliente por este chat.${
          result.discountClamped
            ? " El descuento pactado superaba el límite: se creó al precio autorizado y un asesor va a revisarlo."
            : ""
        }`,
      };
    case "duplicate":
      return {
        estado: "ya_estaba_registrado",
        detalle: `Este cierre ya había creado el pedido ${result.orderName}. No se creó otro. No vuelvas a pedirle los datos.`,
      };
    case "invalid":
      return {
        estado: "faltan_datos",
        detalle:
          "Al cliente ya se le pidió por este chat lo que falta. No se lo vuelvas a pedir: espera su respuesta y recién entonces registra de nuevo.",
      };
    case "escalated":
      return {
        estado: "paso_a_un_asesor",
        detalle:
          "El cierre no se pudo armar por algo que el cliente no puede corregir. Ya pasó a un asesor y ya se le avisó. No sigas la conversación.",
      };
    case "dry_run":
      return {
        estado: "no_registrado_modo_prueba",
        detalle:
          "La escritura a la tienda está apagada: el pedido NO existe. No le digas al cliente que quedó registrado.",
      };
    case "queued":
      return {
        estado: "no_registrado_en_cola",
        detalle: `El pedido no llegó a la tienda (${result.reason}). El equipo ya fue avisado y lo va a crear. NO le digas al cliente que quedó registrado.`,
      };
  }
}
