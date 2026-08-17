/**
 * Cuándo la conversación de venta deja de ser de Sebastián y pasa a un asesor.
 *
 * **Esto no escala a nadie.** Escalar es `agent/escalation.ts` —el módulo que ya
 * existe, con su transición de `agent_mode`, su aviso al cliente, su alerta al
 * admin de *esa* operación y su idempotencia por hora—, y ahí no se duplicó ni
 * una línea: solo ganó cuatro motivos. Este archivo es la mitad que faltaba,
 * la que **decide**, y por eso el nombre dice `triggers` y no `escalation`.
 *
 * Todo lo de aquí es PURO: recibe los turnos del lead y dos hechos del
 * reconocimiento, y devuelve un disparador o `null`.
 *
 * Los cuatro disparadores son los del ticket 04, más el que llega de la otra
 * mitad (fallbacks del reconocimiento): palabra clave de petición de humano,
 * petición fuera de las reglas, objeción repetida sin avance, y dos intentos sin
 * identificar el producto.
 *
 * **El descuento fuera de rango no está aquí, y es a propósito.** El límite se
 * aplica al construir la orden —el prompt propone, la validación decide— y ese
 * es el punto donde se sabe que se pasó; escalarlo desde la conversación sería
 * adivinar por el texto lo que el constructor de orden sabe de cierto. El ticket
 * 04 lo dice con todas las letras.
 *
 * ## Por qué es léxico y no un modelo
 *
 * Preguntarle a un modelo «¿este cliente pidió un humano?» agrega una llamada,
 * su latencia y su costo a cada turno, para decidir algo que en WhatsApp se dice
 * con cuatro frases. Y agrega su propio modo de fallar: un clasificador que
 * alucina un «sí» apaga al vendedor en una conversación que iba bien. La
 * dirección segura aquí no es simétrica —no escalar cuando había que escalar
 * deja a un cliente esperando; escalar de más le cuesta a un asesor un vistazo—,
 * pero un falso positivo silencioso sobre el 100% de las conversaciones sí es
 * caro. Reglas legibles, con sus tests, y el que las lee sabe qué hacen.
 */

/**
 * Los cuatro motivos por los que una venta pasa a manos humanas.
 *
 * Son valores distintos y no un booleano porque el asesor los lee en la alerta:
 * «pidió hablar con alguien» y «no logramos saber qué producto quiere» son dos
 * conversaciones distintas antes de abrirlas.
 */
export type SalesEscalationTrigger =
  /** Pidió hablar con una persona. */
  | "human_requested"
  /** Pidió algo que las reglas del negocio no conceden. */
  | "out_of_rules_request"
  /** Repitió la misma objeción sin que la conversación avanzara. */
  | "repeated_objection"
  /** Dos intentos sin lograr identificar de qué producto habla. */
  | "product_unidentified";

/**
 * Cuántos turnos del lead se pueden procesar sin saber de qué producto habla
 * antes de pasarlo a un asesor.
 *
 * **Constante del sistema, no campo del panel**, igual que el umbral de
 * confianza del reconocimiento y por el mismo motivo: cada perilla es superficie
 * de falla y soporte no cotizado. Dos es lo que el spec de ingesta fijó — una
 * pregunta, una respuesta que no resuelve, y a un humano; seguir preguntando es
 * lo que hace que el lead abandone.
 */
export const MAX_PRODUCT_ATTEMPTS = 2;

/** Los hechos de la conversación de venta que deciden el escalamiento. */
export interface SalesEscalationFacts {
  /**
   * Los turnos del lead, del más antiguo al más reciente. Solo los suyos: lo
   * que se mide es lo que él pidió y en qué insistió, no lo que el vendedor
   * contestó.
   */
  inbound: readonly string[];
  /** Si el reconocimiento ya resolvió el producto de la conversación. */
  productIdentified: boolean;
  /**
   * Cuántos turnos del lead se procesaron sin lograr identificar el producto.
   * Se compara contra {@link MAX_PRODUCT_ATTEMPTS}.
   */
  productAttempts: number;
}

/**
 * Sin acentos, en minúscula y con los espacios colapsados. Lo que llega por
 * WhatsApp viene tecleado en un teléfono: «asesór», «ASESOR» y «asesor» son la
 * misma palabra, y ninguna regla debería tener que saberlo.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Petición de humano. Dos formas: la que nombra a la persona junto a un verbo de
 * pedir —«quiero hablar con un asesor»— y la que no hace falta calificar porque
 * ya lo dice todo —«eres un bot».
 *
 * El verbo es obligatorio en la primera forma justamente porque Sebastián *es*
 * un asesor de ventas: «gracias asesor» no es una petición de escalar, y sin el
 * verbo lo sería.
 */
const HUMAN_REQUEST_PATTERNS: readonly RegExp[] = [
  /\b(hablar|comunicar|comunicarme|pasar|pasame|paseme|contactar|atienda|atenderme|llamar|llame|marcar)\b[^.!?]{0,40}\b(persona|humano|humana|asesor|asesora|agente|alguien|encargado|encargada|supervisor|supervisora|dueno|duena|vendedor real)\b/,
  /\b(quiero|necesito|puedo|podria|pueden|prefiero)\b[^.!?]{0,25}\b(una persona|un humano|un asesor|una asesora|un agente|un encargado|un supervisor)\b/,
  /\b(eres|sos|es|esto es|estoy hablando con)\b[^.!?]{0,20}\b(un bot|una maquina|un robot|una ia|inteligencia artificial)\b/,
  /\batencion al cliente\b/,
  /\bservicio al cliente\b/,
];

/**
 * Peticiones que el vendedor no puede conceder.
 *
 * **Hoy es un catálogo fijo y no una configuración, porque no hay dónde
 * configurarlo**: la `0022` le dio al vendedor nombre, mensajes base, tono,
 * límite de descuento, modelo y esfuerzo — ninguna lista de reglas. Lo que hay
 * son las promesas que el negocio no hace, que son las mismas de las reglas
 * duras del prompt: fechas de entrega, garantías y devoluciones, crédito y
 * facturación, y venta al por mayor. Cuando el panel gane un campo de reglas,
 * esta lista es su valor por defecto, no un competidor suyo.
 *
 * El descuento no está: se valida al construir la orden, no aquí.
 */
const OUT_OF_RULES_PATTERNS: readonly RegExp[] = [
  // Garantía, devolución, reembolso.
  /\b(garantia|garantias|devolucion|devoluciones|reembolso|reembolsos|me devuelven el dinero|devolver el dinero)\b/,
  // Crédito, cuotas, facturación.
  /\b(credito|a cuotas|en cuotas|financiamiento|financiado|fiado|pagar despues|pago despues|factura|facturacion|nit de la empresa)\b/,
  // Compromiso de fecha u hora exacta. Es una **exigencia**, no una pregunta:
  // «¿llega mañana?» es la duda de cualquiera y el prompt ya prohíbe
  // contestarla con una fecha; escalar cada una llenaría la bandeja del asesor
  // de conversaciones que iban bien.
  /\b(fecha exacta|hora exacta|dia exacto)\b/,
  /\b(necesito|urge|urgente|tiene que llegar|debe llegar|si no llega)\b[^.!?]{0,30}\b(hoy mismo|hoy|manana)\b/,
  // Mayoreo, reventa, distribución.
  /\b(al por mayor|por mayoreo|mayoreo|distribuidor|distribuidora|revender|reventa|franquicia)\b/,
  // Envío fuera de la operación.
  /\b(envio internacional|envian fuera del pais|mandan a otro pais)\b/,
];

/**
 * Las objeciones que se cuentan cuando se repiten. Cada categoría es una razón
 * distinta para no comprar; repetir *la misma* es lo que significa que el
 * vendedor no la está resolviendo. Cambiar de objeción no es insistir, es
 * avanzar por la lista.
 */
const OBJECTION_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  [
    "precio",
    // Sin comodines: «está muy» habría convertido «está muy bueno» en una
    // objeción de precio, y la conversación que mejor va en la que más escala.
    /\b(caro|cara|carisimo|costoso|muy alto|muy elevado|no me alcanza|no tengo tanto|mucho dinero|precio alto)\b/,
  ],
  [
    "desconfianza",
    /\b(estafa|estafan|fraude|me van a robar|no confio|desconfio|es original|sera original|es real|sera real|es seguro comprar)\b/,
  ],
  [
    "entrega",
    /\b(se demora mucho|muy demorado|tarda mucho|se tarda|muy lento|no llega a mi|no llegan a mi|nunca llega)\b/,
  ],
  [
    "pago",
    /\b(no tengo tarjeta|solo efectivo|no puedo pagar|sin dinero|no tengo como pagar|no manejo tarjeta)\b/,
  ],
  [
    "decision",
    /\b(lo voy a pensar|lo pienso|despues te escribo|luego te escribo|no estoy seguro|no estoy segura|tal vez despues|lo consulto|tengo que consultar)\b/,
  ],
];

/**
 * Que el lead haya movido la conversación hacia el cierre. Es lo que convierte
 * una objeción repetida en una objeción normal: si entre las dos veces que la
 * dijo pidió el precio total o dio su dirección, la conversación avanzó y él
 * simplemente volvió sobre el tema.
 */
const ADVANCE_PATTERNS: readonly RegExp[] = [
  /\b(lo quiero|la quiero|los quiero|lo llevo|me lo llevo|lo compro|quiero comprar|quiero pedir|hagamos el pedido|haganme el pedido|ya lo quiero)\b/,
  /\b(como pago|donde pago|donde te pago|como te pago|como hago el pago|contra entrega|contraentrega)\b/,
  /\b(mi direccion|mi nombre es|mi telefono|vivo en|envialo a|mandalo a|mandenlo a)\b/,
  /\b(cuanto es el total|cuanto seria en total|dame el total|si acepto|de acuerdo, lo)\b/,
];

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/** Las categorías de objeción presentes en un turno. */
function objectionsIn(text: string): string[] {
  return OBJECTION_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
    ([category]) => category,
  );
}

/**
 * Si alguna objeción se repitió en dos turnos distintos sin que el lead avanzara
 * entre medias.
 *
 * «Sin avance» se mide desde el turno de la primera aparición hasta el de la
 * última, ambos incluidos: si en esa ventana el lead pidió el total, dijo que lo
 * quería o dio su dirección, la conversación se movió y esto no es un
 * atascamiento.
 */
function hasRepeatedObjection(turns: readonly string[]): boolean {
  const seenAt = new Map<string, number[]>();
  turns.forEach((turn, index) => {
    for (const category of objectionsIn(turn)) {
      const list = seenAt.get(category) ?? [];
      list.push(index);
      seenAt.set(category, list);
    }
  });

  for (const indexes of seenAt.values()) {
    const first = indexes[0];
    const last = indexes[indexes.length - 1];
    if (first === undefined || last === undefined || indexes.length < 2) continue;
    const advanced = turns
      .slice(first, last + 1)
      .some((turn) => matchesAny(turn, ADVANCE_PATTERNS));
    if (!advanced) return true;
  }
  return false;
}

/**
 * El disparador que corresponde a esta conversación, o `null` si no hay que
 * escalar.
 *
 * El orden es de precedencia y solo decide **qué se reporta**, porque los cuatro
 * hacen lo mismo: una petición explícita de humano gana siempre —el lead ya dijo
 * qué quiere—, después lo que pidió y no se le puede dar, después que insista sin
 * avanzar, y al final el estado de no saber de qué producto habla.
 *
 * **Una conversación que avanza normal devuelve `null`**, y eso importa tanto
 * como los cuatro disparadores: un vendedor que escala ante la primera objeción
 * no vende nada y le llena la bandeja al asesor.
 */
export function evaluateSalesEscalation(
  facts: SalesEscalationFacts,
): SalesEscalationTrigger | null {
  const turns = facts.inbound.map(normalize).filter((t) => t.length > 0);
  const last = turns[turns.length - 1];

  if (last && matchesAny(last, HUMAN_REQUEST_PATTERNS)) return "human_requested";
  if (last && matchesAny(last, OUT_OF_RULES_PATTERNS)) return "out_of_rules_request";
  if (hasRepeatedObjection(turns)) return "repeated_objection";
  if (!facts.productIdentified && facts.productAttempts >= MAX_PRODUCT_ATTEMPTS) {
    return "product_unidentified";
  }
  return null;
}
