/**
 * La persona del vendedor, hecha prompt.
 *
 * Todo lo de este archivo es PURO: recibe la configuración de ventas de una
 * operación y devuelve texto. No toca la base, ni el reloj, ni ningún modelo.
 *
 * La configuración es **híbrida a propósito** (spec de la conversación de
 * venta): estructurado lo que tiene consecuencia —nombre visible, los tres
 * mensajes base, el límite de descuento— y libre lo que es tono. Este archivo
 * es donde las dos mitades se juntan, y el orden importa: primero quién es,
 * después cómo habla, después qué decir en los tres momentos que el admin
 * controla palabra por palabra, y al final las reglas duras, que van últimas
 * porque son las que no se negocian.
 *
 * **Un campo vacío no produce una sección vacía.** La fila puede existir con
 * solo `operation_id` —los textos son `NOT NULL default ''` y el panel la va
 * llenando—, así que un «Saludo:» sin saludo sería ruido que el modelo tiene
 * que interpretar. Lo que no está configurado simplemente no se menciona.
 *
 * **El límite de descuento se menciona, no se aplica.** El prompt lo dice para
 * que Sebastián negocie con criterio; la validación vive en el constructor de
 * orden (spec de cierre) y es la que decide. Aquí no hay clamp ni podría
 * haberlo: esto devuelve un string.
 *
 * Y lo mismo vale para **el borde del límite** (`discount_limit_behavior`, de
 * la `0025`): qué hace Sebastián cuando le piden más de lo autorizado viaja
 * como instrucción y no como candado. Conviene saber exactamente qué significa
 * hoy cada una de las tres, porque la pantalla no puede prometer más que esto:
 *
 * - `consultar` **no dispara el escalamiento por sí sola.** `escalation-triggers`
 *   decide mirando los turnos del *lead*, no lo que Sebastián resuelve, y deja
 *   el descuento fuera a propósito: desde el texto no se sabe cuánto pidió, eso
 *   lo sabe de cierto el constructor de orden. Así que hoy `consultar` es que
 *   Sebastián diga que lo consulta y no conceda nada; el traspaso ocurre cuando
 *   el cliente pide una persona —disparador que ya existe— o cuando el pedido
 *   se arma y `order.ts` recorta el descuento y lo señala para un asesor.
 * - `ofrecer_maximo` y `no_mencionar` sí se agotan en el prompt: no necesitan
 *   que nadie más haga nada.
 *
 * Por eso `consultar` es el valor por defecto de la columna: es el único de los
 * tres que **coincide con lo que el sistema ya hace en el punto donde el límite
 * se hace cumplir de verdad** —recortar y avisar a una persona—, en vez de
 * instruir lo contrario de lo que después va a pasar.
 */

import type { SalesDiscountBehavior } from "@wa/shared";

/**
 * Lo que la persona necesita de la configuración de ventas. Es una forma
 * estructural —no `SalesAgentSettings`— para que los tests escriban fixtures de
 * dos campos, igual que `CatalogProduct` en el reconocimiento. La fila real de
 * `sales_agent_settings` la satisface tal cual.
 */
export interface SalesPersona {
  /** Nombre visible: «Sebastián». */
  displayName: string;
  /** Mensaje base: el saludo con el que abre. */
  greeting: string;
  /** Mensaje base: el empuje al cierre. */
  closingPush: string;
  /** Mensaje base: el mensaje de embudo. */
  funnelMessage: string;
  /** Texto libre: personalidad y tono. */
  toneInstructions: string;
  /** Hasta qué porcentaje puede bajar. `0` prohíbe descuentos. */
  discountLimitPct: number;
  /**
   * Qué hace cuando le piden más de lo autorizado. Con el límite en `0` la
   * pregunta es «cuando insista con un descuento», que sigue teniendo respuesta:
   * prohibir descuentos no evita que se los pidan.
   */
  discountLimitBehavior: SalesDiscountBehavior;
}

// Si la operación tiene vendedor de verdad **ya no se decide acá**: el listón es
// `salesAgentIsConfigured` de `@wa/db`, junto a la tabla que describe, y
// `SalesPersona` encaja en su forma estructural sin conversión. Estaba escrito
// dos veces en el worker y una tercera —distinta— en el panel, y la tercera es
// la que encendió el módulo de ventas de Guatemala sin vendedor: preguntaba si
// la fila existía, y el `upsert` de `/vendedor` la crea con todo en `''`.

/**
 * Las reglas que no salen de la configuración porque no son del admin sino del
 * sistema: lo que el vendedor no puede prometer y lo que tiene que hacer cuando
 * la conversación se le sale de las manos.
 *
 * Las dos primeras son la historia 17 del spec —«que el vendedor no prometa
 * tiempos de entrega ni garantías que yo no ofrezco, para no generar
 * reclamos»—, y no son decorativas: en contraentrega, una fecha prometida que
 * no se cumple es una devolución. La del producto es el borde del ticket 02:
 * mientras no esté identificado, se conversa **sin inventarlo**. La última es
 * la historia 6: quien pide una persona no tiene que insistir.
 */
const HARD_RULES: readonly string[] = [
  "NUNCA prometas una fecha ni un rango de tiempo de entrega. Si preguntan, di que el asesor confirma el tiempo al coordinar el pedido.",
  "NUNCA ofrezcas garantías, devoluciones ni reembolsos que no estén escritos en la información del producto.",
  "NUNCA inventes características, precios ni disponibilidad. Si no está en la información del producto que tienes, dilo y ofrécele confirmarlo.",
  "Si el cliente pide hablar con una persona, no insistas ni intentes retenerlo: dile que lo pasas con un asesor.",
];

/**
 * La línea del borde: qué hace cuando le piden más de lo autorizado.
 *
 * Nueve textos y no tres, porque **con el límite en cero las tres opciones
 * quieren decir otra cosa**. «Ofrecer el máximo» con el máximo en cero no es
 * ofrecer nada, y escribirlo como si lo fuera dejaría al modelo interpretando
 * qué máximo ofrecer. La pregunta también cambia: nadie pide «más del 0%»,
 * insiste con un descuento a secas.
 *
 * Ninguna de las tres le dice al modelo que escale, y no es un olvido: escalar
 * es un acto del sistema —`agent/escalation.ts`, con su cambio de `agent_mode`
 * y su alerta— y el modelo no lo puede disparar desde el texto. Prometerle al
 * cliente que «lo paso con un asesor» cuando nadie lo va a pasar es peor que no
 * ofrecerlo. Lo que sí puede hacer es no conceder y decir que lo consulta.
 */
function discountEdgeLine(persona: SalesPersona): string {
  const prohibido = persona.discountLimitPct <= 0;
  const pide = prohibido
    ? "Si el cliente insiste con un descuento"
    : `Si el cliente pide más de ese ${persona.discountLimitPct}%`;

  switch (persona.discountLimitBehavior) {
    case "consultar":
      return `${pide}, no se lo niegues en seco ni se lo concedas: dile que lo consultas con alguien del equipo y que le confirmas. No prometas que se lo van a dar ni digas cuándo.`;
    case "ofrecer_maximo":
      return prohibido
        ? `${pide}, dile con claridad que el precio es el que es y sigue empujando al cierre con el valor del producto. No consultes con nadie ni ofrezcas nada a cambio.`
        : `${pide}, ofrécele el ${persona.discountLimitPct}% —que es tu máximo— y sigue empujando al cierre. No consultes con nadie ni ofrezcas más.`;
    case "no_mencionar":
      return `${pide}, no sigas la conversación por ahí: no se lo niegues ni se lo concedas, y vuelve a lo que gana con el producto.`;
  }
}

/**
 * El prompt del vendedor para una operación.
 *
 * Es el equivalente de `agent_settings.system_prompt` para Katherine, con una
 * diferencia que es la del ticket: el de ella es **un campo de texto** que el
 * admin escribe entero, y el de él se **compone** de campos estructurados más
 * un campo de tono. Por eso el de ella se lee y el de él se arma aquí.
 */
export function buildSalesPersonaPrompt(persona: SalesPersona): string {
  const name = persona.displayName.trim();
  const lines: string[] = [];

  lines.push("# Quién eres");
  lines.push(
    name
      ? `Eres ${name}, asesor de ventas. Atiendes por WhatsApp a personas que escriben interesadas en un producto.`
      : "Eres un asesor de ventas. Atiendes por WhatsApp a personas que escriben interesadas en un producto.",
  );
  lines.push(
    "Tu objetivo es que la persona compre: resolver sus dudas, manejar sus objeciones y llevarla al cierre. Escribes como se escribe en WhatsApp — mensajes cortos, sin formalismos de correo y sin párrafos largos.",
  );

  const tone = persona.toneInstructions.trim();
  if (tone) {
    lines.push("");
    lines.push("# Tu tono");
    lines.push(tone);
  }

  const greeting = persona.greeting.trim();
  const closingPush = persona.closingPush.trim();
  const funnelMessage = persona.funnelMessage.trim();
  if (greeting || closingPush || funnelMessage) {
    lines.push("");
    lines.push("# Mensajes base");
    lines.push(
      "Son los momentos que el negocio controla palabra por palabra. Úsalos como están; adáptalos solo lo mínimo para que encajen en la conversación.",
    );
    if (greeting) lines.push(`- Saludo inicial: «${greeting}»`);
    if (closingPush) lines.push(`- Empuje al cierre: «${closingPush}»`);
    if (funnelMessage) lines.push(`- Mensaje de embudo: «${funnelMessage}»`);
  }

  lines.push("");
  lines.push("# Descuentos");
  lines.push(
    persona.discountLimitPct > 0
      ? `Puedes negociar hasta un ${persona.discountLimitPct}% de descuento, y solo si hace falta para cerrar. No es un cupón que se ofrece de entrada.`
      : "No puedes ofrecer descuentos. Si el cliente insiste en el precio, defiende el valor del producto; no inventes rebajas ni promociones.",
  );
  lines.push(discountEdgeLine(persona));
  lines.push(
    "El descuento que quede pactado lo valida el sistema al crear el pedido. Nunca prometas un precio como definitivo: di que lo confirmas al armar el pedido.",
  );

  lines.push("");
  lines.push("# Reglas duras — no las rompas");
  for (const rule of HARD_RULES) lines.push(`- ${rule}`);

  return lines.join("\n");
}
