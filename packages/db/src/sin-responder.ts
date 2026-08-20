/**
 * **«Sin responder»**: qué conversación está esperando que una persona conteste.
 *
 * Todo lo de este archivo es PURO: no toca la base ni el reloj —el instante
 * entra por parámetro—. Recibe hechos de una conversación y devuelve si entra
 * en la cuenta. Se prueba con fixtures de cinco campos.
 *
 * **Existe porque el número que el panel mostraba no medía esto.** La regla era
 * `!agent_mode && unread_count > 0`, y `unread_count` solo se pone en cero
 * cuando alguien **abre** la conversación en el panel: mide «nadie la abrió acá
 * adentro», no «hay que atenderla». Medido en Guatemala el 19-ago-2026, de las
 * 54 que el panel marcaba «necesita atención» **30 ya habían sido respondidas**,
 * las 54 estaban fuera de la ventana de 24h y la entrante más reciente del grupo
 * era del 26-jul. El 20-ago-2026 la regla vieja daba 90 sobre 1.760
 * conversaciones y esta da 35.
 *
 * El nombre es literalmente la regla que calcula, y es el mismo en la barra
 * lateral y en la tarjeta del Inbox: un nombre por número.
 */

/**
 * **El corte de recencia, fijo en código.**
 *
 * Treinta días y no la ventana de 24h de WhatsApp: con 24h la cuenta da **cero**
 * en producción, y eso es mentira por el otro lado. Un lead que escribió hace
 * treinta horas y al que nadie contestó es una venta perdida, y el panel ya sabe
 * reabrir con plantilla —«Retomar conversación» está en la pantalla—. Que la
 * ventana cerrada **se vea en la fila**, no que saque la conversación de la
 * cuenta.
 *
 * Si algún día hay que configurarlo, este es el sitio: hoy no hay ninguna
 * pantalla que lo pregunte y una columna de configuración sin quien la mueva es
 * una columna que miente.
 */
export const DIAS_SIN_RESPONDER = 30;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Los hechos de una conversación que esta regla necesita. Nada más. */
export interface SinResponderFacts {
  /** `conversations.last_inbound_at`. `null` si el cliente nunca escribió. */
  lastInboundAt: Date | null;
  /**
   * El último saliente **conversacional** hacia este cliente: `agent` o
   * `manual`, según `esSalienteConversacional`. **No es
   * `conversations.last_outbound_at`**, que se estampa con cualquier saliente y
   * convertiría una notificación logística en «ya contestamos» — es la misma
   * decisión que el árbol de diseño tomó para `unread_count` (Q8: *«convertiría
   * cada notificación logística en un "alguien leyó esto", que es falso»*).
   *
   * **`null` cuenta como «no contestamos», y es a propósito.** Hay
   * conversaciones que sí recibieron respuesta por una puerta que no dejó fila
   * en `outbound_messages` —históricas, de antes de que el outbox cubriera todo:
   * el 20-ago-2026 son 24 de las 35, y en una de ellas se lee a una persona
   * contestando—. Contarlas como pendientes es el error conservador: el costo es
   * mirar una conversación vieja de más, y el error contrario es no volver a
   * mirar nunca a un cliente que escribió. **No es un bug de esta regla**, y por
   * eso está escrito acá.
   */
  lastConversationalOutboundAt: Date | null;
  /** `contacts.agent_mode`: si un agente la lleva, no espera a una persona. */
  agentMode: boolean;
  /** `conversations.assigned_user_id`: quién la está trabajando, si alguien. */
  assignedUserId: string | null;
  /**
   * Cuándo el agente escaló la conversación a una persona, la última vez, o
   * `null` si nunca. Sale del aviso al cliente en `outbound_messages` —no hay
   * tabla de escaladas—, que es el único sitio donde el hecho queda fechado.
   */
  lastEscalationAt: Date | null;
  /**
   * La actividad más reciente de la conversación: el mayor entre el último
   * entrante, el último saliente y su nacimiento. Es el mismo `GREATEST` con el
   * que el Inbox ordena la lista, y no un `COALESCE`: una conversación cuyo
   * último mensaje es nuestro se quedaría anclada a la fecha del cliente.
   */
  lastActivityAt: Date;
}

/**
 * La actividad más reciente de una conversación: el mayor de los tres, no el
 * primero no nulo.
 *
 * Con `COALESCE(lastInbound, …)` una conversación cuyo último mensaje es
 * NUESTRO se quedaba anclada a la fecha del cliente. `createdAt` es `NOT NULL`,
 * así que siempre hay valor.
 *
 * Es el gemelo en TypeScript del `GREATEST` con el que el Inbox ordena la
 * lista (`lastActivityAt`, `apps/web/src/lib/queries.ts`). Existían tres copias
 * de esta frase —la del `ORDER BY`, la que arma la fila y la que ahora decide la
 * recencia—; esta es la única que se puede probar, y las otras dos la citan.
 */
export function actividadDe(facts: {
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  createdAt: Date;
}): Date {
  return [facts.lastInboundAt, facts.lastOutboundAt].reduce<Date>(
    (max, d) => (d !== null && d.getTime() > max.getTime() ? d : max),
    facts.createdAt,
  );
}

/** Si un instante cae dentro del corte de recencia. */
function reciente(at: Date, ahora: Date): boolean {
  return ahora.getTime() - at.getTime() <= DIAS_SIN_RESPONDER * MS_POR_DIA;
}

/**
 * **La pelota es nuestra**: el cliente habló después de la última vez que
 * alguien —persona o agente— le contestó.
 *
 * Sin ningún saliente conversacional la pelota es nuestra igual: si el cliente
 * escribió y lo único que salió fueron notificaciones, nadie le contestó. Ver
 * {@link SinResponderFacts.lastConversationalOutboundAt}.
 */
export function pelotaNuestra(
  facts: Pick<SinResponderFacts, "lastInboundAt" | "lastConversationalOutboundAt">,
): boolean {
  if (facts.lastInboundAt === null) return false;
  const respuesta = facts.lastConversationalOutboundAt;
  return respuesta === null || facts.lastInboundAt.getTime() > respuesta.getTime();
}

/**
 * **Las tres condiciones que hacen falta siempre**, pase lo que pase con el
 * resto de la regla:
 *
 * - el agente **no la lleva** (`agent_mode` en `false`) — si la lleva, ya está
 *   siendo atendida y ponerla en rojo es pedirle a una persona que haga lo que
 *   una máquina está haciendo;
 * - hubo actividad en los últimos {@link DIAS_SIN_RESPONDER} días — lo que lleva
 *   dos meses quieto no es trabajo vivo, es historia;
 * - **no está asignada** a nadie — si tomar un chat no lo saca de la lista roja,
 *   el botón «TRABAJARLA YO» no sirve para nada y dos personas siguen viendo el
 *   mismo pendiente. El abandono ya está cubierto: `releaseStaleAssignments` la
 *   suelta sola cuando cambia de bandeja, y vuelve a aparecer al soltarse.
 *
 * Está separada y exportada por un motivo concreto y medido: son las tres que
 * una consulta puede descartar **en la base**, con columnas y sin cruzar nada.
 * Traerse las 1.760 conversaciones de Guatemala para decidirlas acá cuesta 573
 * ms sobre la pantalla que más se abre; descartarlas en el `where` deja 45 filas
 * y 132 ms. `apps/web/src/lib/queries.ts` copia **esta** condición en SQL —tres
 * columnas, ninguna regla— y el resto lo sigue decidiendo {@link sinResponder}
 * sobre lo que sobrevive. Si alguna de las tres deja de ser necesaria, hay que
 * tocar los dos sitios, y el test que ata las dos funciones lo dice.
 */
export function puedeEstarSinResponder(
  facts: Pick<
    SinResponderFacts,
    "agentMode" | "assignedUserId" | "lastActivityAt"
  >,
  ahora: Date,
): boolean {
  if (facts.agentMode) return false;
  if (facts.assignedUserId !== null) return false;
  return reciente(facts.lastActivityAt, ahora);
}

/**
 * ¿Esta conversación está sin responder?
 *
 * Entra si cumple las tres de {@link puedeEstarSinResponder} y además **la
 * pelota es nuestra**.
 *
 * **O bien** si tiene una escalada dentro de los mismos días, aunque el último
 * mensaje sea nuestro: el agente puede escalar *después* de contestar, y una
 * escalada es, textualmente, «hace falta una persona acá». Las otras tres
 * condiciones siguen valiendo — una escalada que el agente ya retomó, o que
 * alguien ya tomó, no es un pendiente de nadie.
 */
export function sinResponder(facts: SinResponderFacts, ahora: Date): boolean {
  if (!puedeEstarSinResponder(facts, ahora)) return false;
  if (pelotaNuestra(facts)) return true;
  return facts.lastEscalationAt !== null && reciente(facts.lastEscalationAt, ahora);
}
