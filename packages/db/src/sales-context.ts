/**
 * El contexto de venta de una conversación: qué reconoció el vendedor, y qué
 * pasó después.
 *
 * Todo lo de este archivo es PURO: no toca la base ni el reloj. Recibe hechos
 * —la atribución del anuncio, el producto que quedó resuelto, las escaladas
 * que salieron— y devuelve **lo que la pantalla cuenta**. Se prueba con
 * fixtures, no con una conexión a producción.
 *
 * ## Por qué esto es un hilo de eventos y no un panel de atributos
 *
 * Decisión 2 del nivel 2 (`.scratch/ventas-pulido-ui/issues/02`): *el producto
 * y el anuncio no son atributos que se consulten, son algo que pasó en un
 * momento del chat*, y el evento lo fecha. Por eso lo que sale de aquí lleva
 * `at` y se intercala con los mensajes, en vez de vivir en una tercera columna.
 *
 * ## Lo que NO se puede derivar hoy, y por qué se dice acá
 *
 * El spec pide distinguir **reconocido / ambiguo / escalado**. Del esquema solo
 * salen dos de los tres: `conversations.product_id` dice si el reconocimiento
 * **resolvió**, pero la cascada de `apps/worker/src/sales/recognition.ts` no
 * persiste su forma —`resolved`, `ambiguous` con candidatos, o `unknown`—, así
 * que «ambiguo» y «no encontré nada» dejan exactamente la misma huella: un
 * `product_id` en `null`. Llamarle «ambiguo» a eso sería afirmar más de lo que
 * se sabe, así que este archivo lo llama **«sin identificar»**, que es lo que
 * de verdad consta y además es como ya lo nombra el motivo de escalada
 * `sales_product_unidentified` («dos intentos sin lograr identificar de qué
 * producto habla»). Distinguir «ambiguo» exigiría persistir el resultado de la
 * cascada, que es una columna nueva y por lo tanto otro ticket.
 */

/**
 * Cómo quedó el reconocimiento del producto en una conversación.
 *
 * - `sin_anuncio`: la conversación no llegó por un anuncio. No hay nada que
 *   reconocer y no es un problema: es el caso de los 1.725 chats de hoy.
 * - `identificado`: hay un producto resuelto para la conversación.
 * - `sin_identificar`: llegó por un anuncio y el producto sigue sin resolver.
 */
export type ProductRecognition =
  | "sin_anuncio"
  | "identificado"
  | "sin_identificar";

/** Una escalada a humano que de verdad salió, con su instante y su motivo. */
export interface EscalationFacts {
  /** Cuándo se encoló el aviso al cliente. Es lo que fecha el evento. */
  at: Date;
  /**
   * El motivo, tal como lo escribió quien escaló. Texto libre a propósito: el
   * vocabulario lo define `apps/worker/src/agent/escalation.ts` y copiarlo aquí
   * sería tener dos listas que se desincronizan. Lo que este archivo hace con
   * un motivo que no conoce es nombrarlo, no esconderlo.
   */
  reason: string | null;
}

/** Los hechos de venta de una conversación. Nada más. */
export interface SalesContextFacts {
  /** `conversations.ad_referral_at`: cuándo llegó el clic del anuncio. */
  adReferralAt: Date | null;
  /** `conversations.ad_id`: el identificador del anuncio en Meta. */
  adId: string | null;
  /** `conversations.ad_headline`: el titular, para nombrar el anuncio sin id. */
  adHeadline: string | null;
  /**
   * El nombre del producto que quedó resuelto, o `null` si no hay producto o
   * si el producto es de la tienda y su nombre vive allá (`products.name` es
   * nullable justamente para los conectados).
   */
  productName: string | null;
  /** Si la conversación tiene producto resuelto, tenga nombre local o no. */
  productIdentified: boolean;
  /** Las escaladas que salieron, en cualquier orden. */
  escalations: readonly EscalationFacts[];
}

/**
 * Cómo quedó el reconocimiento. Mira el clic y el producto, nunca las
 * escaladas: se puede escalar una conversación con el producto ya identificado
 * —el cliente pidió hablar con una persona— y eso no deshace el reconocimiento.
 */
export function resolveProductRecognition(
  facts: Pick<SalesContextFacts, "adReferralAt" | "productIdentified">,
): ProductRecognition {
  if (facts.productIdentified) return "identificado";
  return facts.adReferralAt === null ? "sin_anuncio" : "sin_identificar";
}

/**
 * Lo que la **fila** de la bandeja marca del reconocimiento, o `null` si no
 * marca nada.
 *
 * Decisión 3 del nivel 2, textual: *la fila solo marca el reconocimiento cuando
 * NO es limpio; marcar todo es no marcar nada*. Por eso `identificado` y
 * `sin_anuncio` devuelven `null`: una bandeja donde todas las filas llevan
 * insignia es una bandeja sin insignias.
 *
 * `escalada` gana sobre `sin_identificar` porque es lo que le toca hacer a un
 * humano ahora; el producto sin identificar es el motivo más frecuente de la
 * escalada y repetirlo al lado sería decir dos veces lo mismo.
 */
export type RowMark = "escalada" | "sin_identificar";

export function resolveRowMark(facts: SalesContextFacts): RowMark | null {
  if (facts.escalations.length > 0) return "escalada";
  return resolveProductRecognition(facts) === "sin_identificar"
    ? "sin_identificar"
    : null;
}

/**
 * Un momento del contexto de venta, para intercalar en el hilo.
 *
 * No hay evento para «la automatización está pausada» **a propósito**, aunque
 * el prototipo lo dibujaba: `contacts.agent_mode` es un booleano sin fecha, y
 * un evento sin instante en un hilo ordenado por instante es una mentira sobre
 * cuándo pasó. El estado ya se ve donde siempre se vio —la etiqueta
 * «Respuesta manual» de la cabecera del hilo— y ese es el vocabulario que el
 * panel ya usa en producción.
 */
export type SalesThreadEvent =
  | {
      kind: "producto_identificado";
      at: Date;
      productName: string | null;
      adId: string | null;
    }
  | {
      kind: "producto_sin_identificar";
      at: Date;
      adId: string | null;
      adHeadline: string | null;
    }
  | { kind: "escalada"; at: Date; reason: string | null };

/**
 * Los eventos de venta de una conversación, del más viejo al más nuevo.
 *
 * El evento de reconocimiento se fecha con `ad_referral_at` —cuándo llegó el
 * clic— y no con un instante propio, porque **el reconocimiento no tiene fecha
 * propia en el esquema**: la cascada corre al recibir el mensaje del anuncio y
 * escribe `product_id` sin sellar cuándo. Fecharlo con el clic lo deja en el
 * lugar correcto del hilo (justo antes del primer mensaje del cliente) y no
 * inventa un instante que nadie guardó.
 *
 * Una conversación sin clic de anuncio no produce evento de reconocimiento, ni
 * siquiera uno que diga «no vino de un anuncio»: el hilo de Katherine tiene que
 * quedar exactamente como estaba.
 */
export function salesThreadEvents(
  facts: SalesContextFacts,
): SalesThreadEvent[] {
  const events: SalesThreadEvent[] = [];
  if (facts.adReferralAt !== null) {
    events.push(
      facts.productIdentified
        ? {
            kind: "producto_identificado",
            at: facts.adReferralAt,
            productName: facts.productName,
            adId: facts.adId,
          }
        : {
            kind: "producto_sin_identificar",
            at: facts.adReferralAt,
            adId: facts.adId,
            adHeadline: facts.adHeadline,
          },
    );
  }
  for (const escalation of facts.escalations) {
    events.push({
      kind: "escalada",
      at: escalation.at,
      reason: escalation.reason,
    });
  }
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * El motivo de una escalada, sacado de la clave de deduplicación con la que se
 * encoló el aviso al cliente.
 *
 * **Es el único sitio donde el motivo sobrevive.** `escalateToHuman` apaga el
 * modo agente, encola un aviso al cliente y otro al admin, y no escribe ninguna
 * fila que diga por qué; lo único que queda es
 * `outbound_messages.dedup_key = escalation-customer-<contactId>-<motivo>-<hora>`.
 * Leerlo de ahí es reconstruir un hecho que sí pasó, no adivinar.
 *
 * Solo lee la clave del aviso **al cliente**: la del admin viaja al teléfono del
 * administrador y contarla en el hilo del cliente sería contar dos veces la
 * misma escalada.
 *
 * El corte es posicional y no contra una lista de motivos conocidos: el
 * vocabulario es del worker y una copia aquí envejecería en silencio el día que
 * gane un motivo. Un motivo desconocido sale tal cual y la pantalla lo nombra.
 */
const CLAVE_DE_AVISO_AL_CLIENTE = "escalation-customer-";

/** Largo de un UUID con guiones. El contacto ocupa exactamente esto. */
const LARGO_DE_UUID = 36;

export function escalationReasonFromDedupKey(dedupKey: string): string | null {
  if (!dedupKey.startsWith(CLAVE_DE_AVISO_AL_CLIENTE)) return null;
  const resto = dedupKey.slice(CLAVE_DE_AVISO_AL_CLIENTE.length);
  // La hora es el último tramo y es numérica; el contacto es el primero y mide
  // lo que mide un UUID. Lo de en medio es el motivo, sea cual sea.
  const sinHora = resto.replace(/-\d+$/, "");
  if (sinHora.length <= LARGO_DE_UUID || sinHora[LARGO_DE_UUID] !== "-") {
    return null;
  }
  return sinHora.slice(LARGO_DE_UUID + 1) || null;
}

/**
 * Cómo se cuenta en el hilo por qué la conversación pasó a un asesor.
 *
 * Devuelve la mitad de la frase que va después del nombre del vendedor:
 * «Sebastián **escaló tras dos intentos sin identificar el producto**». Un
 * motivo que este código no conozca devuelve `null` y la pantalla dice solo que
 * escaló — que es verdad y es lo que importa.
 *
 * Las frases son las de `REASON_LABEL` en el worker dichas en pasado. No se
 * importan de allá porque `apps/web` no depende de `@wa/worker`; si alguna vez
 * se separan, lo que se pierde es una frase, no una decisión.
 */
const FRASE_POR_MOTIVO: Readonly<Record<string, string>> = {
  audio_message: "porque el cliente mandó un audio",
  agent_request: "porque el agente lo pidió",
  manual: "por decisión de un asesor",
  sales_human_requested: "porque el cliente pidió hablar con una persona",
  sales_out_of_rules: "porque el cliente pidió algo fuera de las reglas",
  sales_repeated_objection: "porque el cliente repitió la misma objeción",
  sales_product_unidentified:
    "tras dos intentos sin identificar el producto",
};

export function escalationPhrase(reason: string | null): string | null {
  if (reason === null) return null;
  return FRASE_POR_MOTIVO[reason] ?? null;
}

/**
 * Si la escalada la decidió el vendedor.
 *
 * Importa para **no atribuirle a Sebastián lo que no hizo**: el motivo
 * `audio_message` es del agente que confirma y existe desde mucho antes que el
 * módulo de ventas; contarlo en el hilo como «Sebastián escaló» sería poner su
 * nombre en una decisión que no tomó, en conversaciones que además son de la
 * bandeja de operaciones. Los motivos del vendedor son los cuatro que
 * `escalation.ts` prefija `sales_`, y ese prefijo es la marca, no una lista.
 */
export function isSalesEscalation(reason: string | null): boolean {
  return reason !== null && reason.startsWith("sales_");
}
