/**
 * Qué se guarda de la referencia del anuncio, y qué sobrevive cuando no llega.
 *
 * Todo lo de este archivo es PURO: no toca la base ni el reloj. Recibe la
 * atribución que la conversación ya tiene, la referencia que trajo este mensaje
 * —si trajo alguna— y cuándo llegó, y devuelve **qué escribir** y **con qué
 * queda la conversación**. Quien escribe es el pipeline de entrada.
 *
 * Las dos reglas que este módulo existe para hacer inescribibles:
 *
 * 1. **Un mensaje sin referencia no borra nada.** Es el caso de todos los
 *    mensajes posteriores al primero —incluidas las respuestas de botón y de
 *    lista, que Meta nunca acompaña de `referral`—, y es lo que hace que una
 *    conversación siga sabiendo de qué anuncio vino cuando el cliente ya solo
 *    toca botones.
 * 2. **Una referencia nueva se escribe entera, de una sola vez.** El
 *    identificador de anuncio, el de clic, el copy, la URL, el instante y el
 *    objeto crudo salen todos del mismo `referral`: no se mezclan campos de un
 *    clic con campos de otro. Mezclarlos produciría una atribución que nunca
 *    existió —el anuncio de agosto con el identificador de clic de julio— y le
 *    reportaría a Meta la venta de una pauta que no la produjo, que es peor
 *    que no reportarla.
 *
 * **Sobrescribir es la decisión tomada, y tiene un costo aceptado.** Hay una
 * conversación por contacto para siempre (índice único sobre `contact_id`) y el
 * ruteo quiere «la atribución más reciente»: el recomprador que hace clic en un
 * anuncio nuevo vuelve a ventas. El costo es que la referencia anterior —su
 * `ctwa_clid` incluido— desaparece, y no hay endpoint de Meta para recuperarla.
 * Se acepta porque el clic viejo ya cumplió su función (la venta que produjo,
 * si la hubo, se reportó al cerrarla) y porque el historial de clics, si algún
 * día hace falta, es una tabla append-only aparte y no una columna más aquí.
 */

import type { ParsedAdReferral } from "../kapso/inbound";

/**
 * La atribución de anuncio tal como vive en `conversations`. Es una forma
 * estructural —una fila entera de la tabla la cumple— para que los tests
 * escriban fixtures de dos campos y para no arrastrar el tipo de `@wa/db`
 * a una función que no consulta nada.
 */
export interface StoredAdAttribution {
  /** `referral.source_id`: el identificador del anuncio. */
  adId: string | null;
  adHeadline: string | null;
  adBody: string | null;
  adSourceUrl: string | null;
  /** `referral.ctwa_clid`: el identificador de clic. Lo que CAPI necesita. */
  ctwaClid: string | null;
  /** Cuándo llegó la referencia. Es lo que el ruteo compara contra los pedidos. */
  adReferralAt: Date | null;
  /** El `referral` crudo. La red contra un recorte del proveedor. */
  adReferralRaw: unknown;
  /**
   * El producto que la cascada de reconocimiento resolvió para este anuncio.
   * Va aquí y no aparte porque es **parte de la atribución**: es lo que hace
   * que una respuesta de botón —que no trae referencia— siga sabiendo de qué
   * producto se está hablando.
   */
  productId: string | null;
}

/**
 * Lo que hay que escribir en la conversación. Es la atribución **completa**, no
 * un parche: los siete campos se escriben juntos o no se escribe ninguno.
 *
 * `adReferralAt` no es opcional aquí y sí lo es en {@link StoredAdAttribution}:
 * una escritura siempre sabe cuándo llegó el clic, y una conversación sin clic
 * tiene que quedar en `null` de verdad, sin instante inventado.
 */
export interface AdAttributionWrite extends StoredAdAttribution {
  adReferralAt: Date;
  /**
   * **Siempre `null`**, y por eso el tipo lo fija: un clic nuevo deja la
   * conversación sin producto hasta que la cascada lo resuelva **sobre el
   * anuncio nuevo**. Conservar el anterior dejaría el producto de julio colgado
   * del anuncio de agosto, que es la misma mezcla que el resto del módulo
   * existe para impedir. Quien reconoce escribe el producto justo después, en
   * su propia escritura; si el reconocimiento falla o no resuelve nada, la
   * conversación queda sin producto — que es la verdad, y es lo que hace que
   * el vendedor pregunte.
   */
  productId: null;
}

export interface AdAttributionDecision {
  /** Qué escribir, o `null` cuando no hay nada que escribir. */
  write: AdAttributionWrite | null;
  /** Con qué atribución queda la conversación después de aplicar la decisión. */
  effective: StoredAdAttribution;
  /**
   * La referencia nueva pisó una anterior. Es el único momento en que se pierde
   * un identificador de clic de forma irreversible, así que quien orquesta lo
   * registra en el log — no cambia el comportamiento.
   */
  overwritesPreviousReferral: boolean;
}

/** Cómo queda la conversación cuando llega —o no llega— una referencia. */
export function decideAdAttribution(input: {
  /** Lo que la conversación ya tiene guardado. */
  stored: StoredAdAttribution;
  /** La referencia de **este** mensaje. `null` en todos los que no vienen de un anuncio. */
  referral: ParsedAdReferral | null;
  /** El instante del mensaje que trajo la referencia. */
  receivedAt: Date;
}): AdAttributionDecision {
  const { stored, referral } = input;
  if (!referral) {
    return {
      write: null,
      effective: stored,
      overwritesPreviousReferral: false,
    };
  }
  const write: AdAttributionWrite = {
    adId: referral.adId,
    adHeadline: referral.headline,
    adBody: referral.body,
    adSourceUrl: referral.sourceUrl,
    ctwaClid: referral.ctwaClid,
    adReferralAt: input.receivedAt,
    adReferralRaw: referral.raw,
    productId: null,
  };
  return {
    write,
    effective: write,
    overwritesPreviousReferral: stored.adReferralAt !== null,
  };
}
