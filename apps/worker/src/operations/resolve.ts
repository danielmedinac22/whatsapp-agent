/**
 * A qué operación pertenece un mensaje entrante.
 *
 * Todo lo de este archivo es PURO: no toca la base ni el reloj. La regla que
 * decide de quién es un mensaje se prueba con fixtures y no con una conexión a
 * producción. Los accesores de la tabla `operations` viven en `@wa/db`
 * (`operations.ts`) y la conexión de WhatsApp en `../kapso/connection.ts`.
 *
 * **Lo que el contract (ticket 06) borró de aquí:** el tipo `OperationRef`, que
 * era `OperationId | null` y donde `null` significaba «la operación única» y
 * leía la fila singleton `id = 1`. Era la última puerta para pedir una conexión
 * sin decir de qué operación, y resolvía siempre a Guatemala. Con ella se fue
 * `canUseSingleOperationFallback`: cubría el estado «operación viva cuya
 * conexión quedó sin etiquetar», que la `0021` volvió imposible al hacer
 * `operation_id` obligatoria. Una red que ya no puede atrapar nada es peor que
 * ninguna, porque promete una garantía que nadie prueba.
 */

import type { OperationId } from "@wa/db";

export type { OperationId };

/**
 * Lo mínimo que hace falta de una conexión de WhatsApp para saber a qué
 * operación rutea. Es una forma estructural y no la fila entera para que los
 * tests puedan escribir fixtures de dos campos.
 */
export interface OperationConnectionRef {
  operationId: OperationId;
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
    if (conn.phoneNumberId?.trim() === wanted) {
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
 * log. En cuanto exista una segunda operación activa, `singleOperationId` llega
 * en `null` y la red se desarma sola: la conversación queda sin operación en
 * vez de quedar atribuida al país equivocado.
 *
 * Es la única red que el contract conservó, y por eso `conversations.operation_id`
 * sigue siendo nullable: es el estado que esta decisión puede producir.
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
