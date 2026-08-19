/**
 * Cuando el reporte a Meta no sale: ¿se reintenta, se para, o no sabemos?
 *
 * Todo lo de este archivo es PURO. Es la decisión más delicada del ticket,
 * porque las dos formas de equivocarse cuestan cosas distintas y una de ellas
 * no se puede deshacer:
 *
 * - **No reintentar un fallo temporal** pierde una conversión. Molesta, se
 *   nota, y la pauta aprende un poco menos.
 * - **Reintentar un evento que Meta ya recibió** produce **dos conversiones de
 *   una venta**. El algoritmo aprende que ese perfil convierte el doble de lo
 *   que convierte, y eso —dice el riesgo R7 de la no-regresión— **no se
 *   revierte borrando datos**.
 *
 * Por eso la clasificación tiene **tres** salidas y no dos. La tercera es la
 * que este módulo existe para poder tener.
 *
 * ## Las tres disposiciones
 *
 * - **`retry`** — sabemos que Meta *no* lo procesó. La petición no llegó a
 *   salir, o Meta contestó «no lo tomé». Reintentar es seguro y correcto.
 * - **`stop`** — Meta lo rechazó por algo que no mejora con el tiempo: el
 *   token no sirve, falta el permiso, el evento está mal formado. Reintentar
 *   seis veces no arregla nada y solo llena el log; queda registrado y
 *   visible, y **no escala a una persona** — es telemetría, no una venta.
 * - **`unconfirmed`** — la petición salió y **nunca llegó respuesta**. Puede
 *   que Meta lo haya tomado y se haya cortado el cable de vuelta. No se
 *   reintenta: es exactamente cómo se fabrica el duplicado que no se puede
 *   deshacer. Queda a la vista para que una persona decida.
 *
 * ## Por qué el corte está en «salió o no salió», y no en «hubo error o no»
 *
 * La clasificación clásica —red = temporal, HTTP 4xx = permanente— trata
 * «no me pude conectar» y «me colgué esperando la respuesta» como lo mismo, y
 * no lo son en absoluto: en el primer caso Meta no vio nada, en el segundo
 * puede tener el evento adentro. Con un destino que **no deduplica**, esa
 * diferencia es la única que importa. Por eso {@link capiNetworkSignal} mira el
 * código de error de Node —no el mensaje, que cambia entre versiones— y separa
 * los que ocurren *antes* de escribir en el socket de los que ocurren después.
 *
 * **Lo que no se reconoce se trata como indeterminado**, no como reintentable.
 * Es al revés de lo habitual y es la misma dirección segura del interruptor: si
 * no sabemos qué pasó, la opción barata es perder una conversión.
 *
 * ## Un lugar donde el diseño elige «al menos una vez», y se dice
 *
 * Los `429` y los `5xx` **sí** se reintentan. Un código así viene del borde de
 * la Graph API, que rechaza la petición antes de que llegue al dataset, y es lo
 * que la propia documentación de CAPI recomienda hacer. No es una certeza
 * absoluta —un `502` podría ser un cuelgue después de procesar—, así que queda
 * escrito acá: es el único punto del camino donde se acepta la posibilidad
 * remota de un duplicado a cambio de no tirar una conversión cada vez que Meta
 * hipa. Todo lo demás está del lado conservador.
 */

/** Qué se hace con el fallo. */
export type CapiDisposition = "retry" | "stop" | "unconfirmed";

export interface CapiFailure {
  disposition: CapiDisposition;
  /** Una línea para el log y para el estado del reporte. */
  reason: string;
}

/**
 * Un error de Meta, tal como viene en `error` de la respuesta. Los nombres son
 * los de Meta —es formato de cable— para poder compararlos a ojo con la
 * documentación.
 */
export interface MetaGraphError {
  code?: number | null;
  error_subcode?: number | null;
  message?: string | null;
  type?: string | null;
}

/** Lo que se sabe del fallo, sin interpretarlo. */
export type CapiFailureSignal =
  /** La petición **nunca salió**: DNS, conexión rechazada, TLS. */
  | { kind: "not_sent"; detail: string }
  /** Salió y **no hubo respuesta**: tiempo agotado, socket cortado. */
  | { kind: "no_answer"; detail: string }
  /** Meta contestó. `error` viene del cuerpo cuando se pudo leer. */
  | { kind: "http"; status: number; error?: MetaGraphError | null }
  /** Meta contestó `200` con un cuerpo que no dice que lo haya recibido. */
  | { kind: "unreadable"; detail: string };

/**
 * Los códigos de error de la Graph API que significan «volvé a intentar».
 *
 * `1` y `2` son los transitorios genéricos de Meta; el resto son las distintas
 * familias de límite de tasa —por aplicación, por usuario, por página, por
 * cuenta publicitaria y el de mensajería—, que existen justamente para que uno
 * espere y vuelva.
 */
const RETRYABLE_META_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80004]);

/**
 * Los códigos de Node que significan que **la petición nunca salió**.
 *
 * No hay resolución de nombre, no hay a quién conectarse, el certificado no
 * cuadra, o el intento de conexión venció **antes** de establecerse. En los
 * cinco casos Meta no vio nada y reintentar es seguro.
 */
const NEVER_SENT_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/**
 * De una excepción de `fetch` a una señal. Puro: solo mira la forma del error.
 *
 * Distingue lo único que importa —si la petición llegó a salir— por el código
 * del error y no por su texto, que cambia entre versiones de Node y de undici.
 * Lo que no está en la lista de «nunca salió» se trata como indeterminado,
 * incluida cualquier excepción inesperada: preferimos perder una conversión
 * antes que arriesgar la segunda.
 */
export function capiNetworkSignal(err: unknown): CapiFailureSignal {
  const code = errorCode(err);
  const detail = code ? `${code}: ${errorMessage(err)}` : errorMessage(err);
  return NEVER_SENT_CODES.has(code ?? "")
    ? { kind: "not_sent", detail }
    : { kind: "no_answer", detail };
}

/** Qué hacer con un fallo del reporte, y cómo contarlo. */
export function classifyCapiFailure(signal: CapiFailureSignal): CapiFailure {
  switch (signal.kind) {
    case "not_sent":
      return {
        disposition: "retry",
        reason: `la petición no llegó a salir (${signal.detail})`,
      };

    case "no_answer":
      return {
        disposition: "unconfirmed",
        // El texto dice explícitamente lo que pasó, porque es el estado que
        // alguien va a tener que interpretar en el panel dentro de seis meses.
        reason: `la petición salió y Meta no respondió (${signal.detail}): no se sabe si la conversión quedó reportada, y no se reintenta para no contarla dos veces`,
      };

    case "http":
      return classifyHttp(signal.status, signal.error ?? null);

    case "unreadable":
      return {
        disposition: "unconfirmed",
        reason: `Meta respondió 200 con un cuerpo que no confirma la recepción (${signal.detail})`,
      };
  }
}

function classifyHttp(
  status: number,
  error: MetaGraphError | null,
): CapiFailure {
  const code = error?.code ?? null;
  const detalle = describeMetaError(status, error);

  if (code !== null && RETRYABLE_META_CODES.has(code)) {
    return { disposition: "retry", reason: `Meta pidió esperar — ${detalle}` };
  }

  // Ver el encabezado: es el único punto donde se acepta «al menos una vez».
  if (status === 408 || status === 429 || status >= 500) {
    return { disposition: "retry", reason: `Meta no lo tomó — ${detalle}` };
  }

  // Un código de Meta que no está en la lista de reintentables llegó con un
  // 4xx: token muerto (190), permiso que falta (200/10/3) o evento mal formado
  // (100). Los tres los arregla una persona, no el tiempo.
  return { disposition: "stop", reason: `Meta lo rechazó — ${detalle}` };
}

function describeMetaError(
  status: number,
  error: MetaGraphError | null,
): string {
  const partes = [`HTTP ${status}`];
  if (error?.code != null) partes.push(`código ${error.code}`);
  if (error?.error_subcode != null) partes.push(`subcódigo ${error.error_subcode}`);
  const mensaje = error?.message?.trim();
  if (mensaje) partes.push(mensaje);
  return partes.join(" · ");
}

/**
 * El código de un error de Node, mirando también su `cause` — `fetch` envuelve
 * el error real de undici ahí, y sin desenvolverlo todo `ECONNREFUSED` se vería
 * como «TypeError: fetch failed» y caería en indeterminado.
 */
function errorCode(err: unknown): string | null {
  const visto = new Set<unknown>();
  let actual: unknown = err;
  while (actual && typeof actual === "object" && !visto.has(actual)) {
    visto.add(actual);
    const code = (actual as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    const name = (actual as { name?: unknown }).name;
    // `AbortError` y `TimeoutError` no traen `code` y son la forma en que se ve
    // un tiempo agotado nuestro: salió y no esperamos más. Indeterminados.
    if (name === "AbortError" || name === "TimeoutError") return String(name);
    actual = (actual as { cause?: unknown }).cause;
  }
  return null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
