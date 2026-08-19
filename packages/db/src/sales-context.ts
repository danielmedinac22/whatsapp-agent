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
 * ## «Ambiguo» ya se puede decir, y hasta la `0026` no se podía
 *
 * El spec pide distinguir **reconocido / ambiguo / escalado**, y hasta agosto
 * del 2026 del esquema salían solo dos: `conversations.product_id` decía si el
 * reconocimiento **resolvió**, y con `null` «el matcher dudó entre cuatro
 * REVITALHAIR» y «el matcher no encontró nada» dejaban exactamente la misma
 * huella. Este archivo llamaba a las dos «sin identificar» porque era lo único
 * que constaba.
 *
 * La `0026` persiste **cómo terminó la cascada** —`conversations.product_recognition`,
 * con el vocabulario de la propia cascada— y, cuando quedó ambigua, **cuáles
 * eran los candidatos**. Con eso, las dos situaciones se separan aquí; y hacía
 * falta separarlas porque **piden cosas opuestas del asesor**: ante *ambiguo*
 * tiene que desempatar, ante *sin candidatos* tiene que ir a cargar el anuncio
 * al catálogo, que es otra pantalla.
 *
 * Lo que sigue sin poder decirse es *cuándo* se reconoció: el reconocimiento no
 * tiene fecha propia en el esquema y se sigue fechando con el clic del anuncio.
 * Ver {@link salesThreadEvents}.
 */

/**
 * Cómo terminó la cascada de reconocimiento, tal como queda escrito en
 * `conversations.product_recognition` (migración `0026`).
 *
 * **Es el vocabulario de la cascada** (`apps/worker/src/sales/recognition.ts`),
 * no una traducción: una copia con otras palabras sería una lista más que
 * mantener de acuerdo. `null` —la ausencia de valor— es la tercera historia y
 * la única que no es un resultado: la cascada **todavía no corrió**, que es el
 * estado de toda conversación que no llegó por un anuncio.
 */
export type RecognitionOutcome = "resolved" | "ambiguous" | "unknown";

/**
 * La columna leída como lo que es. Es `text` con un `check` que la cierra a
 * esos tres valores —igual que `discount_limit_behavior` de la `0025`—, y este
 * es el borde donde ese texto se vuelve el tipo del panel.
 *
 * Un valor que este código no conozca se lee como **«no consta»**, y es lo
 * único honesto: la pantalla dice entonces lo que decía antes de la `0026` en
 * vez de inventarle un estado a una fila que alguien escribió por otra vía.
 */
export function parseRecognitionOutcome(
  value: string | null,
): RecognitionOutcome | null {
  return value === "resolved" || value === "ambiguous" || value === "unknown"
    ? value
    : null;
}

/**
 * Cómo quedó el reconocimiento del producto en una conversación.
 *
 * - `sin_anuncio`: la conversación no llegó por un anuncio. No hay nada que
 *   reconocer y no es un problema: es el caso de los 1.725 chats de hoy.
 * - `identificado`: hay un producto resuelto para la conversación.
 * - `ambiguo`: la cascada encontró varios candidatos y ninguno con confianza.
 *   El asesor tiene que **desempatar**, y para eso la pantalla le muestra entre
 *   qué dudó.
 * - `sin_identificar`: llegó por un anuncio y no hubo ni un candidato. El
 *   asesor tiene que **cargar el anuncio** en el catálogo, que es otro trabajo
 *   y otra pantalla.
 */
export type ProductRecognition =
  | "sin_anuncio"
  | "identificado"
  | "ambiguo"
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
  /**
   * `conversations.product_recognition`: cómo terminó la cascada, o `null` si
   * no corrió — que es el caso de toda conversación que no llegó por un
   * anuncio, incluidas las 1.736 de hoy.
   */
  recognitionOutcome: RecognitionOutcome | null;
  /**
   * Los candidatos que quedaron registrados cuando la cascada dudó, **por
   * nombre y en el orden en que ella los presenta**. Una entrada por cada id
   * registrado, y `null` en la que no se pudo nombrar: el producto ya no está
   * en el catálogo de la operación, o es de los conectados a la tienda, cuyo
   * nombre vive en Shopify y no en `products.name`.
   *
   * Se conserva la entrada sin nombre en vez de descartarla porque **cuántos
   * eran es parte del hecho**: «dudó entre tres» sigue siendo verdad aunque uno
   * de los tres no se pueda nombrar.
   */
  candidates: readonly (string | null)[];
  /** Las escaladas que salieron, en cualquier orden. */
  escalations: readonly EscalationFacts[];
}

/**
 * Cómo quedó el reconocimiento. Mira el clic, el producto y lo que la cascada
 * dejó registrado; nunca las escaladas: se puede escalar una conversación con
 * el producto ya identificado —el cliente pidió hablar con una persona— y eso
 * no deshace el reconocimiento.
 *
 * **El producto resuelto manda sobre el registro**, y el orden importa en un
 * caso real: el recomprador. Hay una conversación por contacto para siempre, y
 * un clic nuevo en un anuncio que la cascada no sabe reconocer deja
 * `product_recognition = 'unknown'` encima de un `product_id` que sigue siendo
 * el producto que esa persona compró. Decir «sin identificar» ahí sería borrar
 * de la pantalla algo que la conversación sí sabe.
 */
export function resolveProductRecognition(
  facts: Pick<
    SalesContextFacts,
    "adReferralAt" | "productIdentified" | "recognitionOutcome"
  >,
): ProductRecognition {
  if (facts.productIdentified) return "identificado";
  if (facts.recognitionOutcome === "ambiguous") return "ambiguo";
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
 * `escalada` gana sobre los otros dos porque es lo que le toca hacer a un
 * humano ahora; el producto sin identificar es el motivo más frecuente de la
 * escalada y repetirlo al lado sería decir dos veces lo mismo.
 *
 * `ambiguo` y `sin_identificar` son marcas distintas y **no un matiz**: la
 * primera pide desempatar entre los candidatos, ahí mismo, en el chat; la
 * segunda pide ir a cargar el anuncio al catálogo, que es otra pantalla.
 * Mostrarlas iguales manda al asesor a hacer lo que no es, y es exactamente lo
 * que pasaba antes de la `0026`.
 *
 * Solo mira los hechos que decide, y no la ficha entera, para que la lista del
 * Inbox no tenga que resolver nombres de candidatos que la fila no dibuja.
 */
export type RowMark = "escalada" | "ambiguo" | "sin_identificar";

export function resolveRowMark(
  facts: Pick<
    SalesContextFacts,
    "adReferralAt" | "productIdentified" | "recognitionOutcome" | "escalations"
  >,
): RowMark | null {
  if (facts.escalations.length > 0) return "escalada";
  const recognition = resolveProductRecognition(facts);
  if (recognition === "ambiguo") return "ambiguo";
  return recognition === "sin_identificar" ? "sin_identificar" : null;
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
      /**
       * La cascada encontró varios y no pudo elegir. Lleva los candidatos
       * porque **entre qué dudó es la información útil**: sin ellos, el evento
       * diría lo mismo que «no encontré nada», que es justo lo que la `0026`
       * vino a separar.
       */
      kind: "producto_ambiguo";
      at: Date;
      adId: string | null;
      adHeadline: string | null;
      candidates: readonly (string | null)[];
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
    const at = facts.adReferralAt;
    const recognition = resolveProductRecognition(facts);
    events.push(
      recognition === "identificado"
        ? {
            kind: "producto_identificado",
            at,
            productName: facts.productName,
            adId: facts.adId,
          }
        : recognition === "ambiguo"
          ? {
              kind: "producto_ambiguo",
              at,
              adId: facts.adId,
              adHeadline: facts.adHeadline,
              candidates: facts.candidates,
            }
          : {
              kind: "producto_sin_identificar",
              at,
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
