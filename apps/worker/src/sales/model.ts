/**
 * Con qué modelo y con cuánto esfuerzo de razonamiento contesta el vendedor.
 *
 * Puro: traduce dos columnas de `sales_agent_settings` a lo que el SDK espera.
 *
 * **El esfuerzo bajo es una decisión medida, no un ahorro.** Persuadir no es una
 * tarea de razonamiento, y el esfuerzo alto agrega segundos de latencia que en
 * una conversación de WhatsApp cuestan más ventas que cualquier mejora de
 * redacción. Y es **un campo, no una constante**: subirlo después es cambiar un
 * valor en el panel, no desplegar. Lo mismo con el modelo — si Sebastián cierra
 * mal, el primer sospechoso es el modelo, y cambiarlo cuesta un `UPDATE`.
 */

/** El vocabulario de esfuerzo del proveedor. */
export type ReasoningEffort = "low" | "medium" | "high";

/**
 * El esfuerzo válido más cercano a lo que diga la columna.
 *
 * `reasoning_effort` es `text` y no un enum —es vocabulario del proveedor y
 * cambia sin migración—, así que puede llegar cualquier cosa: un valor de una
 * versión futura, un espacio de más, una mayúscula del panel. Lo que no se
 * reconoce cae en `low`, que es el default de la columna y el valor con el que
 * se midió la latencia; adivinar hacia arriba sería encarecer y demorar cada
 * turno por un error de tecleo.
 */
export function normalizeReasoningEffort(value: string | null): ReasoningEffort {
  const clean = value?.trim().toLowerCase();
  return clean === "medium" || clean === "high" ? clean : "low";
}

/**
 * Las opciones de proveedor del turno de venta, listas para `generateText`.
 *
 * **Hoy este objeto no llega al proveedor, y hay que decirlo:** la versión de
 * `@openrouter/ai-sdk-provider` que usa el worker (`6.0.0-alpha.1`) arma el
 * cuerpo de la petición con una lista fija de campos —modelo, mensajes,
 * `maxOutputTokens`, `temperature`, `topP`, herramientas— y descarta tanto las
 * opciones del modelo como las `providerOptions` de la llamada. Se verificó
 * leyendo su `doGenerate`; no es una suposición.
 *
 * Se manda igual, y por la vía canónica del SDK, por tres razones: es donde el
 * valor tiene que estar el día que el proveedor salga de alpha —o que se cambie
 * de proveedor—, es lo que hace que el campo del panel sea un campo de verdad y
 * no un adorno, y deja el hecho documentado en el único lugar donde alguien lo
 * va a buscar. Mientras tanto el vendedor corre con el esfuerzo por defecto del
 * modelo, que para un `mini` de gama media es bajo: la latencia que se midió es
 * la que hay.
 */
export function salesReasoningOptions(settings: {
  reasoningEffort: string | null;
}): {
  providerOptions: { openrouter: { reasoning: { effort: ReasoningEffort } } };
} {
  return {
    providerOptions: {
      openrouter: {
        reasoning: { effort: normalizeReasoningEffort(settings.reasoningEffort) },
      },
    },
  };
}
