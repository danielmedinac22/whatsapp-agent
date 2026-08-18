import { z } from "zod";

/**
 * Lo que la pantalla de configuración del vendedor manda, y las reglas que se
 * aplican antes de escribir la fila. **Todo esto es puro**: no toca la base, ni
 * la sesión, ni el reloj.
 *
 * Vive en `@wa/shared` y no en el panel por la misma razón que los otros
 * `*Input`: la ruta que valida y el formulario que dibuja el error tienen que
 * estar de acuerdo sobre qué es válido, y dos copias de esa respuesta se
 * desincronizan en cuanto una se toque.
 *
 * **Lo que este archivo no hace, a propósito: decidir si hay vendedor.** Ese
 * listón —`display_name` no vacío— ya vive en el worker
 * (`sales/persona.ts::isSalesAgentConfigured`) y es lo que sostiene la
 * no-regresión de Guatemala. Escribir aquí una tercera copia sería agregarle un
 * lugar más donde el listón puede quedar distinto, que es justo el error que
 * convierte un `INSERT` a medio llenar en el momento en que Katherine deja de
 * atender. El panel **no decide si hay vendedor**: guarda lo que le
 * escribieron, y el worker decide con su listón de siempre.
 */

/** Nombre visible: lo único que el cliente ve, y el listón del worker. */
const MAX_DISPLAY_NAME = 60;

/**
 * Los tres mensajes base son mensajes de WhatsApp, así que el techo es el del
 * canal (4096) y no un número inventado por esta pantalla.
 */
const MAX_BASE_MESSAGE = 4096;

/** El tono es un fragmento de prompt, no el prompt entero de Katherine. */
const MAX_TONE = 4000;

/**
 * Lo que la base usa cuando la fila no existe —que es el estado de producción
 * hoy: `sales_agent_settings` está vacía—.
 *
 * Están acá y no escritos en la página para que la pantalla en blanco muestre
 * **lo que la base usaría**, no lo que a la página le pareció razonable. Son
 * espejo de los `default` de las columnas de `sales_agent_settings`; si allá
 * cambian, cambian acá.
 */
export const SALES_AGENT_DEFAULTS = {
  displayName: "",
  greeting: "",
  closingPush: "",
  funnelMessage: "",
  toneInstructions: "",
  /** Cero prohíbe descuentos, y es el valor seguro. */
  discountLimitPct: 0,
  model: "openai/gpt-5.4-mini",
  reasoningEffort: "low",
} as const;

/**
 * El vocabulario de esfuerzo del proveedor. La columna sigue siendo `text` a
 * propósito —cambia sin migración—, pero la pantalla es un selector: ofrece los
 * tres que el worker reconoce (`normalizeReasoningEffort`), y cualquier otra
 * cosa que llegue a la columna por otra vía sigue cayendo en `low` allá.
 */
export const SALES_REASONING_EFFORTS = ["low", "medium", "high"] as const;

/**
 * Lo que el panel manda al guardar.
 *
 * **El nombre visible puede llegar vacío y eso no es un error de validación.**
 * Es la mitad del mecanismo: la pantalla se puede llenar de a poco —el tono
 * hoy, los mensajes mañana— y mientras el nombre esté vacío el vendedor no
 * atiende y contesta el agente de confirmación, que es el comportamiento de
 * producción hoy. Exigir el nombre aquí convertiría «guardar un borrador» en
 * «encender al vendedor», que es exactamente lo que no puede pasar sobre la
 * operación que factura.
 *
 * El límite repite el rango del `check` de la tabla (`between 0 and 100`) para
 * que un valor fuera de rango vuelva como un error legible del formulario y no
 * como un 500 de la base.
 */
export const salesAgentSettingsInput = z.object({
  displayName: z.string().max(MAX_DISPLAY_NAME),
  greeting: z.string().max(MAX_BASE_MESSAGE),
  closingPush: z.string().max(MAX_BASE_MESSAGE),
  funnelMessage: z.string().max(MAX_BASE_MESSAGE),
  toneInstructions: z.string().max(MAX_TONE),
  discountLimitPct: z.number().int().min(0).max(100),
  model: z.string().min(1).max(120),
  reasoningEffort: z.enum(SALES_REASONING_EFFORTS),
});
export type SalesAgentSettingsInput = z.infer<typeof salesAgentSettingsInput>;

/**
 * Los valores tal como van a la fila.
 *
 * Recorta los textos porque el worker los recorta para leerlos —el listón del
 * nombre y la composición del prompt hacen `trim()`—, y guardar un nombre de
 * tres espacios dejaría en la base un vendedor que la pantalla muestra con
 * nombre y el worker no reconoce. Recortar acá es que la fila diga la verdad:
 * lo que se guarda es lo que se va a usar.
 */
export function normalizeSalesAgentSettings(
  input: SalesAgentSettingsInput,
): SalesAgentSettingsInput {
  return {
    displayName: input.displayName.trim(),
    greeting: input.greeting.trim(),
    closingPush: input.closingPush.trim(),
    funnelMessage: input.funnelMessage.trim(),
    toneInstructions: input.toneInstructions.trim(),
    discountLimitPct: input.discountLimitPct,
    model: input.model.trim(),
    reasoningEffort: input.reasoningEffort,
  };
}

/**
 * En qué estado está el límite de descuento. Es lo que decide el tratamiento
 * visual, y por eso es una función y no un `pct === 0` repartido por el JSX.
 *
 * **Cero va en verde y el resto en ámbar**, que es al revés de lo que sugiere
 * la intuición de «cero = apagado = alerta»: prohibir descuentos es el estado
 * **seguro** —nadie regala margen— y además es el default de la columna. Lo que
 * merece el color de advertencia es autorizar a bajar el precio, que es el
 * único campo del panel que gasta plata.
 */
export type SalesDiscountState = "prohibido" | "autorizado";

export function salesDiscountState(pct: number): SalesDiscountState {
  return pct === 0 ? "prohibido" : "autorizado";
}

/**
 * Un punto de partida para el tono, **no una opción cerrada**.
 *
 * Elegir uno rellena el texto y de ahí en adelante es libre: el campo sigue
 * siendo el mismo textarea. Sin presets, el campo se llena con lo primero que
 * se le ocurra a quien lo abra; con presets cerrados, se pierde la mitad libre
 * que la configuración híbrida eligió a propósito.
 *
 * **Los textos no nombran ningún país.** El prototipo los tenía escritos en
 * guatemalteco, y un preset que escribe «guatemalteco neutro» dentro de la
 * configuración del vendedor colombiano es la fuga entre operaciones que todo
 * el proyecto existe para impedir — solo que escrita por un clic, no por un
 * `SELECT` mal filtrado. Lo del país lo escribe quien configura, que sabe cuál
 * es.
 */
export interface SalesTonePreset {
  key: string;
  /** Cómo se llama en la tarjeta. */
  label: string;
  /** Qué hace, en una línea. */
  hint: string;
  /** El texto con el que rellena el campo. */
  text: string;
}

export const SALES_TONE_PRESETS: readonly SalesTonePreset[] = [
  {
    key: "cercano",
    label: "Cercano",
    hint: "Tutea, directo, sin formalismos",
    text: "Cercano y directo, sin tratar de usted. Escribe como se habla en WhatsApp: frases cortas, sin párrafos largos. No prometas resultados médicos.",
  },
  {
    key: "formal",
    label: "Formal",
    hint: "Trata de usted, tono profesional",
    text: "Trate al cliente de usted. Tono profesional y sobrio, sin emojis. No prometa resultados médicos.",
  },
  {
    key: "propio",
    label: "Propio",
    hint: "Un ejemplo escrito a mano, para partir de ahí",
    text: "Cercano pero sin exagerar. Si preguntan por el envío, confirma que es contraentrega. Si piden un descuento por encima del límite, no inventes: di que lo consultas y vuelves con la respuesta.",
  },
];

/**
 * Qué preset está en uso, o `null` si el texto ya es de quien lo escribió.
 *
 * Que la tarjeta se apague en cuanto alguien edita una coma es lo que hace
 * visible que el preset era un punto de partida: la pantalla deja de decir
 * «este es tu tono» y pasa a decir «este tono lo escribiste vos». Compara con
 * los bordes recortados porque un espacio al final no cambia el tono.
 */
export function activeSalesTonePreset(text: string): string | null {
  const clean = text.trim();
  if (clean.length === 0) return null;
  return SALES_TONE_PRESETS.find((p) => p.text === clean)?.key ?? null;
}
