export type WaConnectionStatus =
  | "disconnected"
  | "connecting"
  | "qr"
  | "connected";

export type MessageDirection = "in" | "out";

export type MessageStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

/**
 * Lo que la fila de la lista dibuja de una conversación, tal cual quedó
 * después del cambio que dispara el evento.
 *
 * Existe para que el panel pueda **repintar una fila en vez de pedir la
 * pantalla entera**: hasta ahora `WaEvent` llevaba dos identificadores, y con
 * dos identificadores lo único que el cliente puede hacer es volver a
 * preguntar. Medido el 20-ago-2026, esa vuelta son diez viajes a la base y 2,0
 * s por cada mensaje entrante, de los cuales Postgres piensa 20 ms.
 *
 * Los tres campos son los que la fila muestra y por los que la lista ordena, ni
 * uno más: lo que falte obliga a un viaje, y lo que sobre engorda cada mensaje
 * del stream. El resto de la fila —el pedido, el dueño, la bandeja— no cambia
 * con un mensaje nuevo, así que no viaja.
 *
 * **Nada de esto cuesta una consulta.** Los tres salen de lo que el worker
 * acaba de escribir en la conversación, una línea antes de emitir.
 */
export type ConversationSnapshot = {
  /** Vista previa del último mensaje, ya recortada a 200 como en la base. */
  lastMessagePreview: string | null;
  /** El contador de no leídos **después** del cambio, no el delta. */
  unreadCount: number;
  /**
   * La actividad más reciente en ISO-8601, que es por lo que la lista ordena.
   *
   * Es el mayor de entrante, saliente y nacimiento —la misma frase que
   * `actividadDe` (`@wa/db`) y el `GREATEST` del `ORDER BY`—, no la fecha del
   * mensaje que provocó el evento: un saliente que no es respuesta mueve la
   * fila igual, y un evento que no mueve la fecha tiene que decir la fecha
   * vieja para que el cliente no la adelante.
   *
   * Viaja como texto y no como `Date` porque el evento cruza la red serializado
   * a JSON: tipar `Date` describiría un valor que el cliente nunca recibe.
   */
  lastActivityAt: string;
};

/**
 * Lo que el worker le cuenta al panel por SSE.
 *
 * Es una unión discriminada **a propósito**: ampliarla hace que el compilador
 * señale los cinco sitios de emisión del worker y ninguno quede a medias.
 *
 * ## La operación no es opcional
 *
 * Los tres eventos de conversación la llevan porque sin ella el stream no puede
 * filtrar, y hoy no filtra en ninguna parte: un inbox de Guatemala se refresca
 * con tráfico de Colombia. No se ve todavía porque hay una sola operación con
 * datos; se va a ver el día que abra la segunda. Quien decide con este campo es
 * {@link WaEvent} en la ruta del stream, no el cliente.
 *
 * `null` es un valor legítimo y no un descuido: `conversations.operation_id` es
 * nullable a propósito —un mensaje que entra por un número que no reconocemos
 * se procesa igual antes que perderse—, y un evento sin operación no se puede
 * probar ajeno, así que llega a todos los paneles.
 *
 * ## Por qué la instantánea puede faltar
 *
 * `conversation` es **obligatorio de escribir y nullable de valor**: el
 * compilador obliga a cada emisor a decidir, y `null` significa «este evento no
 * vuelve a enunciar el resumen de la fila», que es distinto de «no me molesté
 * en averiguarlo». Pasa en dos sitios y en los dos es la verdad: espejar un
 * envío que murió no cambia ni la vista previa ni el contador, y el aviso que
 * el panel manda por `/api/events/notify` —tomar la conversación, marcar la
 * confirmación— tampoco. Inventar valores ahí le haría al cliente pisar la fila
 * con datos viejos; resolverlos con un `select` le sumaría un viaje a cada
 * aviso.
 *
 * `message.status` no la lleva en absoluto: un acuse de entrega o de lectura no
 * toca ninguno de los tres campos.
 */
export type WaEvent =
  | { type: "qr"; qr: string }
  | { type: "status"; status: WaConnectionStatus; phone?: string }
  | {
      type: "message.created";
      operationId: string | null;
      conversationId: string;
      messageId: string;
      conversation: ConversationSnapshot | null;
    }
  | {
      type: "message.status";
      operationId: string | null;
      conversationId: string;
      messageId: string;
      status: MessageStatus;
    }
  | {
      type: "conversation.updated";
      operationId: string | null;
      conversationId: string;
      conversation: ConversationSnapshot | null;
    };
