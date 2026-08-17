/**
 * A qué operación pertenece un mensaje.
 *
 * Todo lo de este archivo es PURO: no toca la base ni el reloj. La regla que
 * decide de quién es un mensaje entrante se prueba con fixtures y no con una
 * conexión a producción. Los accesores que sí van a la base viven en
 * `./index.ts`, y la conexión de WhatsApp en `../kapso/connection.ts`.
 */

/** El uuid de una fila de `operations`. */
export type OperationId = string;

/**
 * La operación que un llamador pide.
 *
 * `null` no significa "no importa": significa **la operación única** — el
 * llamador no tiene una conversación de la que sacarla (un endpoint de estado,
 * el arranque del worker) y atiende la operación que existe mientras exista una
 * sola. Es el mismo comportamiento de antes de la migración, escrito de forma
 * que el contract lo pueda encontrar y borrar.
 *
 * El parámetro es obligatorio en todos los accesores a propósito: con
 * `strict: true`, volverlo obligatorio es lo que hace que el compilador liste
 * los llamadores que faltan por migrar.
 */
export type OperationRef = OperationId | null;

/**
 * Clave de caché de la operación única. Ninguna operación puede tener este
 * id porque los ids son uuid, así que no colisiona con una entrada real.
 */
export const SINGLE_OPERATION_CACHE_KEY = "__operacion_unica__";

/** La clave con la que se cachea lo que cuelga de una operación. */
export function operationCacheKey(operationId: OperationRef): string {
  return operationId ?? SINGLE_OPERATION_CACHE_KEY;
}

/**
 * Lo mínimo que hace falta de una conexión de WhatsApp para saber a qué
 * operación rutea. Es una forma estructural y no la fila entera para que los
 * tests puedan escribir fixtures de dos campos.
 */
export interface OperationConnectionRef {
  operationId: OperationId | null;
  phoneNumberId: string | null;
}

/**
 * La operación dueña del número que recibió el mensaje.
 *
 * **Estricta a propósito**: un `phone_number_id` que no corresponde a ninguna
 * conexión conocida devuelve `null` — nunca cae en una operación por defecto.
 * Atribuir un mensaje a la operación equivocada es peor que no atribuirlo:
 * lo mandaría a responder por el número de otro país.
 *
 * Quien necesite seguir procesando pese a no reconocer el número usa
 * {@link decideInboundOperation}, que es la versión con red.
 */
export function resolveOperationIdByPhoneNumberId(
  phoneNumberId: string,
  connections: readonly OperationConnectionRef[],
): OperationId | null {
  const wanted = phoneNumberId.trim();
  if (!wanted) return null;
  for (const conn of connections) {
    if (conn.phoneNumberId?.trim() === wanted && conn.operationId) {
      return conn.operationId;
    }
  }
  return null;
}

/** Si el número entrante corresponde a alguna conexión que conocemos. */
function isKnownConnection(
  phoneNumberId: string,
  connections: readonly OperationConnectionRef[],
): boolean {
  const wanted = phoneNumberId.trim();
  if (!wanted) return false;
  return connections.some((c) => c.phoneNumberId?.trim() === wanted);
}

/**
 * Si un llamador que no encontró la conexión de su operación puede atenderse
 * con la fila singleton — la red de seguridad de la migración.
 *
 * Solo cuando la operación pedida **es** la única activa que existe. Ahí la
 * fila singleton no puede ser de nadie más, así que caer en ella es exacto: el
 * estado que cubre es una operación viva cuya conexión quedó sin etiquetar, y
 * dejar de enviar por eso sería peor.
 *
 * `false` en todo lo demás, y en particular cuando la operación pedida no es la
 * única: mandar el mensaje de un país por el número de otro es peor que no
 * mandarlo. Ese es el escenario que aparece en cuanto exista Colombia, y por
 * eso la red se desarma sola en vez de tener que acordarse de quitarla.
 *
 * `operationId: null` también da `false`: quien pide la operación única ya lee
 * la fila singleton de frente, no tiene de dónde caer.
 */
export function canUseSingleOperationFallback(
  operationId: OperationRef,
  singleOperationId: OperationId | null,
): boolean {
  if (operationId === null || singleOperationId === null) return false;
  return operationId === singleOperationId;
}

/**
 * Lo que el pipeline de entrada decide hacer con un mensaje.
 *
 * No existe un caso "descartar", y eso es deliberado: mientras haya una sola
 * operación, un entrante que no se logra atribuir **se procesa igual**. Un
 * mensaje descartado en silencio es la operación muda sin que salte ninguna
 * alarma, y ningún test lo ve porque el sistema "funciona".
 */
export interface InboundOperationDecision {
  /** La operación que se guarda en la conversación. `null` = ninguna conocida. */
  operationId: OperationId | null;
  /** El número por el que entró no pertenece a ninguna conexión conocida. */
  connectionIsUnknown: boolean;
  /** Se atendió con la operación única por no haber podido resolver. */
  usedSingleOperationFallback: boolean;
}

/**
 * La operación de un mensaje entrante, con red.
 *
 * Resuelve estricto primero ({@link resolveOperationIdByPhoneNumberId}). Si no
 * reconoce el número, **no descarta el mensaje**: lo atiende con la operación
 * única y marca `connectionIsUnknown` para que el pipeline deje un error en el
 * log. En cuanto exista una segunda operación, `singleOperationId` llega en
 * `null` y la red se desarma sola: la conversación queda sin operación en vez
 * de quedar atribuida al país equivocado.
 */
export function decideInboundOperation(input: {
  phoneNumberId: string;
  connections: readonly OperationConnectionRef[];
  singleOperationId: OperationId | null;
}): InboundOperationDecision {
  const resolved = resolveOperationIdByPhoneNumberId(
    input.phoneNumberId,
    input.connections,
  );
  if (resolved) {
    return {
      operationId: resolved,
      connectionIsUnknown: false,
      usedSingleOperationFallback: false,
    };
  }
  return {
    operationId: input.singleOperationId,
    connectionIsUnknown: !isKnownConnection(
      input.phoneNumberId,
      input.connections,
    ),
    usedSingleOperationFallback: input.singleOperationId !== null,
  };
}
