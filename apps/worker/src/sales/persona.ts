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
 */

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
}

/**
 * Si la operación tiene vendedor de verdad.
 *
 * **No basta con que exista la fila.** Los textos son `NOT NULL default ''`, así
 * que una fila recién creada por el panel —o sembrada por una migración— tiene
 * nombre vacío, tono vacío y mensajes vacíos: un vendedor sin persona, que
 * contestaría con el esqueleto del prompt y nada más. Tomar la existencia de la
 * fila como «hay vendedor» convertiría un `INSERT` a medio llenar en el momento
 * en que Guatemala deja de ser atendida por Katherine, sin que nadie lo pidiera.
 *
 * El listón es el nombre visible porque es el primer campo que el admin llena y
 * el único que el cliente ve: sin él no hay a quién presentar.
 *
 * Es la puerta del riesgo R8 de la no-regresión —«la lógica nueva solo se activa
 * cuando hay un vendedor configurado para esa operación»— y `null` la deja
 * cerrada, que es como está producción hoy.
 */
export function isSalesAgentConfigured(
  settings: Pick<SalesPersona, "displayName"> | null,
): boolean {
  return Boolean(settings && settings.displayName.trim().length > 0);
}

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
  lines.push(
    "El descuento que quede pactado lo valida el sistema al crear el pedido. Nunca prometas un precio como definitivo: di que lo confirmas al armar el pedido.",
  );

  lines.push("");
  lines.push("# Reglas duras — no las rompas");
  for (const rule of HARD_RULES) lines.push(`- ${rule}`);

  return lines.join("\n");
}
