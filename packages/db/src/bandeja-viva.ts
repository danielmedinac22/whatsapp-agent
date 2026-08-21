/**
 * **Qué le hace a la lista de la bandeja un evento del stream.**
 *
 * Todo lo de este archivo es PURO: no toca la base, ni la red, ni el reloj.
 * Recibe la lista tal como el panel la está mostrando y un {@link WaEvent}, y
 * devuelve qué hacer con él. Se prueba con fixtures de cuatro campos, desde el
 * worker, igual que `resolveInbox` y `sinResponder`.
 *
 * **Existe porque hasta hoy la respuesta era siempre la misma: pedir la
 * pantalla entera.** Cada evento del stream disparaba un `router.refresh()`, y
 * medido el 20-ago-2026 un render del Inbox son **23 idas y vueltas a la base y
 * 1.256 filas leídas** — de las cuales Postgres piensa 20 ms de los ~2.000 que
 * tarda; el resto es que el panel corre en Virginia y la base en la otra costa.
 * Con la operación viva de Guatemala (1.764 conversaciones, 27.572 mensajes)
 * eso es un render por mensaje entrante.
 *
 * El evento ya trae lo que la fila dibuja —`ConversationSnapshot`, en
 * producción desde PRO-6—, así que la respuesta normal pasa a ser **repintar la
 * fila donde está**.
 *
 * ## Las tres respuestas, y por qué son tres
 *
 * - `parchear`: el evento dice lo que cambió y la fila lo puede escribir sola.
 * - `ignorar`: no hay nada que hacer, y el motivo dice por qué —el llamador lo
 *   necesita: «es de otra operación» se descarta y ya, pero «es de una
 *   conversación que no está en la lista» es una novedad que hay que avisar.
 * - `refrescar`: **algo cambió y el evento no alcanza para decir qué.** No es
 *   un cajón de sastre: son dos casos nombrados y los dos son raros al lado del
 *   tráfico de mensajes, que es lo que este archivo vino a sacar del camino del
 *   servidor.
 *
 * ## Reordenar no es cosa del evento
 *
 * `aplicarEvento` **nunca mueve una fila de puesto**: escribe lo que cambió
 * donde está y dice, en `desordena`, si la lista quedó fuera de orden. Quien
 * decide cuándo reordenar es el usuario, con {@link reordenarPorActividad}. La
 * razón es un bug real: la lista se reordena por última actividad mientras el
 * cursor va bajando, entra un mensaje de otro cliente, todo baja un puesto y el
 * asesor abre la conversación equivocada.
 */

import type { ConversationSnapshot, WaEvent } from "@wa/shared";

/**
 * Lo que este archivo necesita leer y escribir de una fila de la lista.
 *
 * Es una forma estructural y no la fila entera del panel (`ChatItem`, en
 * `inbox-client.tsx`) para que los tests escriban fixtures de cuatro campos, y
 * para que `packages/db` no tenga que saber cómo se dibuja una fila. El resto
 * de la fila viaja intacto: {@link aplicarEvento} es genérico y devuelve el
 * mismo tipo que recibió.
 */
export interface FilaDeLaLista {
  id: string;
  /** Vista previa del último mensaje. */
  preview: string | null;
  /** Contador de no leídos. */
  unread: number;
  /** La actividad más reciente en ISO-8601. Es por lo que la lista ordena. */
  lastAt: string;
  /** `contacts.agent_mode`: si un agente la lleva. */
  agentMode: boolean;
  /**
   * Quién la está trabajando, o `null` si nadie. Acá **solo se mira si es
   * `null`**; qué hay dentro es cosa de quien dibuja la fila.
   */
  assignedTo: object | null;
  /**
   * Si está esperando que una persona conteste. Lo deriva el servidor con
   * `sinResponder` (`./sin-responder`), y acá se toca con pinzas — ver
   * {@link quedaSinResponder}.
   */
  sinResponder: boolean;
  /** El último mensaje que enviamos no se entregó. */
  deliveryFailed: boolean;
}

/** Por qué un evento no le hace nada a la lista. */
export type MotivoDeIgnorar =
  /** `qr` y `status` hablan de la conexión, no de una conversación. */
  | "no-es-de-una-conversacion"
  /** El evento es de otra operación: un entrante de Colombia no mueve Guatemala. */
  | "otra-operacion"
  /**
   * Un acuse de entrega o de lectura. La fila no dibuja ninguno: lo único que
   * un acuse puede mover de la lista es el aviso de «no entregado», y ese sale
   * del `failed`, que se trata aparte.
   */
  | "acuse"
  /**
   * La conversación **no está en la lista**, así que no hay fila que parchear.
   * No se inventa una: la fila lleva veinte campos —el pedido, la guía, el
   * dueño, la marca del reconocimiento— y el evento trae tres. Es una novedad
   * que solo el servidor puede traer, y el llamador la avisa.
   */
  | "fuera-de-la-lista"
  /**
   * El evento no cambia ninguno de los campos que la fila dibuja. Hoy es un
   * `message.created` sin instantánea cuya conversación no está en la lista.
   */
  | "sin-cambio";

/** Por qué hay que volver a pedirle la fila al servidor. */
export type MotivoDeRefrescar =
  /**
   * `conversation.updated`: **cambió algo de la conversación y el evento no
   * dice qué.** Sus dos emisores lo prueban: el clasificador de confirmación
   * manda la instantánea intacta y lo que movió fue `confirmation_status`, que
   * no viaja en ella; y el aviso que el propio panel manda al tomar una
   * conversación o marcarla llega con la instantánea en `null` a propósito.
   *
   * Es raro al lado del tráfico de mensajes —el clasificador solo emite cuando
   * el estado **cambia**, y lo otro es un clic de un asesor—, y es justo lo que
   * hace que el resto del equipo vea quién tomó una conversación antes de
   * ponerse a escribirle al mismo cliente.
   */
  | "cambio-no-descrito"
  /**
   * La fila estaba **sin responder** y el contador de no leídos quedó en cero:
   * alguien pudo haber contestado, y si contestó deja de estar sin responder.
   *
   * El evento no alcanza para decidirlo y **calcularlo al revés hace mentir al
   * contador**, que es el error que este repo ya pagó una vez. Faltan tres
   * cosas: si el mensaje fue entrante o saliente, si el saliente fue una
   * respuesta o una notificación (`esSalienteConversacional`), y si hay una
   * escalada reciente —que deja la conversación sin responder aunque le
   * hayamos contestado—. Ninguna viaja en la instantánea.
   *
   * El costo está acotado por cuántas filas están en rojo: 35 de 1.760 en
   * producción el 20-ago-2026.
   */
  | "pudo-dejar-de-estar-sin-responder";

/** Qué hacer con un evento. */
export type DecisionDeLaLista<F extends FilaDeLaLista> =
  | {
      accion: "ignorar";
      motivo: MotivoDeIgnorar;
      /** La conversación del evento, o `null` si el evento no es de ninguna. */
      conversationId: string | null;
    }
  | { accion: "refrescar"; motivo: MotivoDeRefrescar; conversationId: string }
  | {
      accion: "parchear";
      /** La lista con la fila reescrita **en su puesto**. */
      filas: F[];
      conversationId: string;
      /**
       * Si la fila parcheada quedó fuera de orden: hay alguna por encima con
       * actividad más vieja que la suya. Es lo que el panel convierte en el
       * aviso de novedades, y lo que {@link reordenarPorActividad} arregla
       * cuando el usuario lo pide.
       */
      desordena: boolean;
    };

/** La bandeja que está mirando quien recibe el evento. */
export interface BandejaQueMira {
  /**
   * La operación del panel, o `null` si no se pudo resolver.
   *
   * `null` **deja pasar todo**, y es la misma decisión que toma el stream en el
   * worker (`esParaElPanel`): con `null` no se puede probar que el evento sea
   * ajeno, y cambiar una pantalla degradada por una pantalla muerta es peor.
   */
  operationId: string | null;
}

/**
 * Si el evento le corresponde a esta bandeja.
 *
 * Los dos `null` pasan, y en los dos casos por lo mismo: **no se puede probar
 * que el evento sea ajeno.** Un evento sin operación es la conversación que
 * entró por un número que no reconocemos —el pipeline la procesa igual antes
 * que perderla—, y descartarla la volvería invisible en todos los paneles a la
 * vez.
 *
 * Es la misma frase que `esParaElPanel` en el worker, y no una copia: aquella
 * la llama. El stream ya filtra en el servidor —un evento que no sale no hay
 * que confiar en que nadie lo mire—, y esto es el cinturón del cliente, que
 * también hace falta: una pestaña puede quedar abierta mientras la barra cambia
 * de operación sin que el `EventSource` se vuelva a abrir.
 */
export function esDeLaOperacion(
  ev: WaEvent,
  operationId: string | null,
): boolean {
  if (!("operationId" in ev)) return true;
  if (operationId === null || ev.operationId === null) return true;
  return ev.operationId === operationId;
}

/**
 * **La única dirección en la que un evento puede encender «sin responder».**
 *
 * El contador de no leídos sube en un solo sitio de todo el worker —la ingesta
 * de un mensaje entrante (`inbound/pipeline.ts`)—, así que verlo subir es la
 * prueba de que el cliente acaba de escribir. Con eso, las cuatro condiciones
 * de `sinResponder` (`./sin-responder`) quedan resueltas sin salir de la fila:
 *
 * - `agentMode` en `false` y sin asignar: los dos están en la fila.
 * - actividad reciente: el mensaje es de ahora.
 * - la pelota es nuestra: el cliente escribió después de cualquier respuesta
 *   anterior, porque acaba de escribir.
 *
 * Hacia el otro lado no se toca nunca, y ese es el punto: apagar el rojo con lo
 * que el evento trae exigiría saber si el saliente fue una respuesta o una
 * notificación, y si hay una escalada reciente. Ahí decide el servidor
 * ({@link MotivoDeRefrescar}).
 */
function quedaSinResponder(
  antes: FilaDeLaLista,
  instantanea: ConversationSnapshot,
): boolean {
  if (antes.sinResponder) return true;
  if (instantanea.unreadCount <= antes.unread) return false;
  if (antes.agentMode) return false;
  return antes.assignedTo === null;
}

/** El puesto de una conversación en la lista, o `-1`. */
function puestoDe(filas: readonly FilaDeLaLista[], id: string): number {
  return filas.findIndex((f) => f.id === id);
}

/**
 * Si la fila del puesto `i` quedó fuera de orden: hay alguna **por encima** con
 * actividad más vieja.
 *
 * Se mira solo hacia arriba a propósito. La lista del servidor viene ordenada
 * por actividad salvo la conversación anclada por `?c=`, que se pone primera
 * aunque sea vieja; comparar contra la lista entera diría «desordenada» desde
 * el primer evento por culpa del ancla, y el aviso de novedades dejaría de
 * significar «llegó algo».
 */
function quedoFueraDeOrden(filas: readonly FilaDeLaLista[], i: number): boolean {
  const suya = filas[i]!.lastAt;
  return filas.slice(0, i).some((f) => f.lastAt < suya);
}

/**
 * La lista ordenada por actividad, de la más reciente a la más vieja.
 *
 * Es el mismo criterio que el `ORDER BY` del servidor (`GREATEST` de entrante,
 * saliente y nacimiento — ver `actividadDe`), aplicado sobre lo que la lista ya
 * tiene. **Es una acción del usuario, no del tráfico**: reordenar bajo el
 * cursor es lo que hace abrir la conversación equivocada.
 */
export function reordenarPorActividad<F extends FilaDeLaLista>(
  filas: readonly F[],
): F[] {
  return [...filas].sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}

/** La fila con lo que el evento trae escrito encima, en su mismo puesto. */
function conLaInstantanea<F extends FilaDeLaLista>(
  antes: F,
  instantanea: ConversationSnapshot,
): F {
  return {
    ...antes,
    preview: instantanea.lastMessagePreview,
    unread: instantanea.unreadCount,
    lastAt: instantanea.lastActivityAt,
    sinResponder: quedaSinResponder(antes, instantanea),
  };
}

/** La lista con una fila reemplazada en su puesto. */
function reemplazando<F extends FilaDeLaLista>(
  filas: readonly F[],
  i: number,
  fila: F,
): F[] {
  const copia = [...filas];
  copia[i] = fila;
  return copia;
}

/**
 * Qué hacer con un evento del stream.
 *
 * La lista entra tal como se está mostrando y sale con la fila reescrita **en
 * su puesto**, o no sale: ver {@link DecisionDeLaLista}.
 */
export function aplicarEvento<F extends FilaDeLaLista>(
  filas: readonly F[],
  ev: WaEvent,
  bandeja: BandejaQueMira,
): DecisionDeLaLista<F> {
  if (!("conversationId" in ev)) {
    return {
      accion: "ignorar",
      motivo: "no-es-de-una-conversacion",
      conversationId: null,
    };
  }
  if (!esDeLaOperacion(ev, bandeja.operationId)) {
    return {
      accion: "ignorar",
      motivo: "otra-operacion",
      conversationId: ev.conversationId,
    };
  }

  const conversationId = ev.conversationId;
  const i = puestoDe(filas, conversationId);

  // **Lo que cambia una conversación sin decir qué cambió.** Se pregunta antes
  // que por el puesto: puede ser de una conversación que todavía no está en la
  // lista —la acaban de asignar y estaba fuera del corte— y el servidor la trae.
  if (ev.type === "conversation.updated") {
    return { accion: "refrescar", motivo: "cambio-no-descrito", conversationId };
  }

  if (ev.type === "message.status") {
    // El chulo de la lista solo cambia con un fallo. Los otros cuatro estados
    // son del hilo, que los reescribe en memoria por su cuenta.
    if (ev.status !== "failed") {
      return { accion: "ignorar", motivo: "acuse", conversationId };
    }
    if (i === -1) {
      return { accion: "ignorar", motivo: "fuera-de-la-lista", conversationId };
    }
    const antes = filas[i]!;
    if (antes.deliveryFailed) {
      return { accion: "ignorar", motivo: "sin-cambio", conversationId };
    }
    return {
      accion: "parchear",
      filas: reemplazando(filas, i, { ...antes, deliveryFailed: true }),
      conversationId,
      // Un fallo no mueve la actividad de la conversación: el chulo cambia y la
      // fila se queda donde está.
      desordena: false,
    };
  }

  // `message.created` sin instantánea es **un envío que murió**, y no es un
  // olvido de quien emite: `huellaDelSaliente` devuelve `null` sin `wa_id`, así
  // que un mensaje que nunca salió no le deja huella a la conversación —ni
  // vista previa, ni contador, ni fecha—. Lo único que cambia de la fila es el
  // aviso de «no entregado».
  // `?? null` y no `=== null`: el tipo obliga a **escribir** la clave, pero lo
  // que llega por el stream es JSON, y tratar «no vino» igual que «vino en
  // null» es lo mismo que decir «este evento no enuncia el resumen de la fila».
  const instantanea = ev.conversation ?? null;
  if (instantanea === null) {
    if (i === -1) {
      return { accion: "ignorar", motivo: "fuera-de-la-lista", conversationId };
    }
    const antes = filas[i]!;
    if (antes.deliveryFailed) {
      return { accion: "ignorar", motivo: "sin-cambio", conversationId };
    }
    return {
      accion: "parchear",
      filas: reemplazando(filas, i, { ...antes, deliveryFailed: true }),
      conversationId,
      desordena: false,
    };
  }

  if (i === -1) {
    return { accion: "ignorar", motivo: "fuera-de-la-lista", conversationId };
  }

  const antes = filas[i]!;
  if (antes.sinResponder && instantanea.unreadCount === 0) {
    return {
      accion: "refrescar",
      motivo: "pudo-dejar-de-estar-sin-responder",
      conversationId,
    };
  }

  const parcheadas = reemplazando(filas, i, conLaInstantanea(antes, instantanea));
  return {
    accion: "parchear",
    filas: parcheadas,
    conversationId,
    desordena: quedoFueraDeOrden(parcheadas, i),
  };
}
