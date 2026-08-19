/**
 * Cuando la tienda rechaza una escritura: ¿se reintenta o se llama a una
 * persona?
 *
 * Todo lo de este archivo es PURO. Es la decisión que separa las dos formas de
 * fallar, y son opuestas:
 *
 * - **Transitorio** — la tienda está saturada, el token venció, se cayó la red.
 *   Reintentar arregla. Llamar a una persona a las 2am no.
 * - **Permanente** — la variante no existe, el país no está habilitado para
 *   envíos, falta un permiso. Reintentar seis veces no lo arregla: lo único que
 *   logra es que el cliente espere seis veces más antes de que alguien mire.
 *
 * Confundirlas cuesta en las dos direcciones. Reintentar un fallo permanente
 * retrasa el aviso al equipo mientras el cliente cree que compró; **no**
 * reintentar un fallo transitorio tira una venta ya pagada en publicidad por un
 * `429`.
 *
 * ## Por qué la señal es el código y no el texto
 *
 * El mensaje de error de la tienda cambia con la versión de la API y con el
 * idioma de la cuenta. Lo que no cambia es el código HTTP y la forma de los
 * errores de la mutación. Por eso {@link classifyStoreFailure} recibe una
 * **señal ya estructurada** y no un `Error` que habría que leer con expresiones
 * regulares — el `Error` con el texto adentro es exactamente cómo se llega a
 * que un cambio de redacción convierta un fallo transitorio en permanente sin
 * que nadie se entere.
 */

/** Qué se hace con el fallo. */
export type FailureDisposition = "retry" | "human";

/** Lo que se sabe del fallo, sin interpretarlo. */
export type StoreFailureSignal =
  /** No hubo respuesta: DNS, timeout, socket cortado. */
  | { kind: "network" }
  /** Hubo respuesta HTTP. */
  | { kind: "http"; status: number }
  /**
   * La consulta llegó y la API contestó con errores de GraphQL (no de la
   * mutación). `THROTTLED` viaja acá con `200`, que es la trampa clásica.
   */
  | { kind: "graphql"; codes: readonly string[] }
  /**
   * La mutación corrió y **rechazó el pedido**: variante inexistente, país sin
   * envío, campo inválido. Es un juicio sobre los datos, no una falla del
   * transporte, y no mejora con el tiempo.
   */
  | { kind: "user_errors"; messages: readonly string[] };

export interface StoreFailure {
  disposition: FailureDisposition;
  /** Una línea para el log y para la alerta al equipo. */
  reason: string;
}

/** El código de GraphQL que la tienda usa cuando pide bajar el ritmo. */
const THROTTLED = "throttled";

/**
 * Los códigos HTTP que se reintentan, y **solo** esos.
 *
 * `408` tiempo agotado, `429` demasiadas peticiones, y `5xx` la tienda de mal
 * humor. Todo lo demás —`401` token muerto, `403` permiso que falta, `404`
 * tienda que no existe, `422` datos rechazados— es un problema que un humano
 * tiene que resolver, y esperar solo lo esconde.
 *
 * `401` merece una nota: parece transitorio («el token se refrescará») y no lo
 * es. Los tokens de app privada de la tienda no rotan solos; un `401` significa
 * que alguien lo revocó o lo cambió, y eso se arregla en el panel de conexión.
 */
function httpDisposition(status: number): FailureDisposition {
  if (status === 408 || status === 429) return "retry";
  return status >= 500 ? "retry" : "human";
}

/** Qué hacer con un fallo de la tienda, y cómo contarlo. */
export function classifyStoreFailure(signal: StoreFailureSignal): StoreFailure {
  switch (signal.kind) {
    case "network":
      return {
        disposition: "retry",
        reason: "no hubo respuesta de la tienda",
      };
    case "http": {
      const disposition = httpDisposition(signal.status);
      return {
        disposition,
        reason:
          disposition === "retry"
            ? `la tienda respondió ${signal.status}`
            : `la tienda rechazó la petición con ${signal.status}`,
      };
    }
    case "graphql": {
      const codes = signal.codes.map((c) => c.trim().toLowerCase());
      const throttled = codes.includes(THROTTLED);
      return {
        disposition: throttled ? "retry" : "human",
        reason: throttled
          ? "la tienda pidió bajar el ritmo"
          : `la tienda devolvió errores: ${signal.codes.join(", ") || "sin código"}`,
      };
    }
    case "user_errors":
      return {
        disposition: "human",
        reason: `la tienda rechazó el pedido: ${
          signal.messages.join(" · ") || "sin detalle"
        }`,
      };
  }
}

/**
 * Un fallo que no vino de la tienda sino de nuestro lado (una excepción
 * inesperada). Se reintenta: si es un error nuestro, el reintento lo repetirá y
 * la cola lo mandará a una persona al agotarse — que es mejor que descartar una
 * venta por un fallo que nadie clasificó todavía.
 */
export function unexpectedFailure(err: unknown): StoreFailure {
  return {
    disposition: "retry",
    reason: `fallo inesperado al crear el pedido: ${
      err instanceof Error ? err.message : String(err)
    }`,
  };
}
