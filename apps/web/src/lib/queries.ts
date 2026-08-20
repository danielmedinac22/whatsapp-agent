import { db } from "./db";
import {
  contacts,
  conversations,
  dropiConnection,
  messages,
  outboundMessages,
  products,
  templates,
  shopifyOrders,
  dropiOrders,
  users,
  waTemplates,
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  actividadDe,
  DIAS_SIN_RESPONDER,
  escalationReasonFromDedupKey,
  inboxChangedSince,
  parseRecognitionOutcome,
  plantillasAprobadasCache,
  resolveInbox,
  sinResponder,
  urlDeArchivosCache,
  SALIENTES_CONVERSACIONALES,
} from "@wa/db";
import type { SQL } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import type {
  EscalationFacts,
  Inbox,
  InboxFacts,
  Operation,
  OrderFacts,
  SalesAgentSettings,
  SalesContextFacts,
  SalesCutoff,
} from "@wa/db";
import { situationByKey } from "@wa/shared";
import {
  contactOfOperation,
  ofOperation,
  rowOfOperation,
  throughConversationOfOperation,
  waIdOfOperation,
} from "./operation-scope";

/**
 * Las doce consultas del panel, todas con la operación por parámetro.
 *
 * **Ninguna resuelve la operación por su cuenta**, y eso es deliberado: la
 * resuelve la pantalla con `resolvePanelOperation()` y la pasa. Una consulta
 * que va a buscar la cookie por dentro esconde de qué depende, y son las
 * pantallas las que tienen que poder decir «esta pantalla es de este país».
 * Es el mismo mecanismo del contract (ticket 06) sobre los accesores de
 * `@wa/db`: el parámetro obligatorio es lo que hace que el compilador encuentre
 * a quien falte.
 *
 * Lo que el compilador **no** puede ver es una consulta nueva que reciba `op` y
 * no lo use en el `where`. Para eso está `./operation-scope` y la prueba que lo
 * vigila; ver el encabezado de ese archivo.
 */

/**
 * Actividad más reciente de una conversación. GREATEST y no COALESCE: con
 * COALESCE(lastInbound, …) una conversación donde el último mensaje es NUESTRO
 * se quedaba anclada a la fecha del cliente y nunca subía al tope de la lista.
 * GREATEST ignora los NULL y createdAt es NOT NULL, así que siempre hay valor.
 *
 * Es el `ORDER BY` de la lista. La misma frase dicha en TypeScript es
 * `actividadDe` (`@wa/db`), que es la que decide la recencia de «sin responder»;
 * si una de las dos cambia, la otra tiene que cambiar con ella.
 */
const lastActivityAt = sql`GREATEST(${conversations.lastInboundAt}, ${conversations.lastOutboundAt}, ${conversations.createdAt})`;

/**
 * Filtro del buscador del Inbox: nombre, teléfono y contenido de los mensajes.
 * El teléfono se compara sobre solo-dígitos en ambos lados para que "+502 3689"
 * y "5023689" encuentren lo mismo.
 */
function conversationSearchFilter(term: string): SQL | undefined {
  const like = `%${term}%`;
  const parts: Array<SQL | undefined> = [
    ilike(contacts.name, like),
    ilike(contacts.pushName, like),
    sql`exists (select 1 from ${messages} where ${messages.conversationId} = ${conversations.id} and ${messages.body} ilike ${like})`,
  ];
  const digits = term.replace(/\D/g, "");
  if (digits.length >= 3) {
    const digitsLike = `%${digits}%`;
    parts.push(
      sql`regexp_replace(coalesce(${contacts.phone}, ''), '[^0-9]', '', 'g') like ${digitsLike}`,
    );
    parts.push(sql`coalesce(${contacts.waId}, '') like ${digitsLike}`);
  }
  return or(...parts);
}

export type DropiSummary = {
  status: typeof dropiOrders.$inferSelect.status;
  hasNovedad: boolean;
  guideNumber: string | null;
  carrier: string | null;
  guidePdfPath: string | null;
  novedadReason: string | null;
  updatedAt: Date;
};

export type ShopifySummary = {
  orderNumber: string;
  totalPrice: string | null;
  producto: string | null;
};

/** Quién está trabajando la conversación, como se le nombra al equipo. */
export type AssignedTo = {
  id: string;
  /** El nombre si lo tiene; si no, el correo. Nunca un id crudo en pantalla. */
  label: string;
};

/**
 * Lo que se sabe de una conversación más allá de sus columnas.
 *
 * `inbox` es `null` cuando no hay dos bandejas —la operación no tiene vendedor
 * configurado—: ahí derivar la bandeja de cada fila sería pagar dos consultas
 * para no dibujar nada.
 *
 * Las escaladas **no** se apagan con él, y esa es la diferencia con la versión
 * anterior de este tipo: son un hecho de la conversación, no del módulo de
 * ventas, y la conversación que un agente pasó a una persona hace falta verla
 * exista o no vendedor.
 */
export type ConversationRouting = {
  /** La bandeja a la que pertenece hoy, o `null` si la operación tiene una sola. */
  inbox: Inbox | null;
  /** Las escaladas a humano que salieron, de la más vieja a la más nueva. */
  escalations: EscalationFacts[];
};

export type ConversationListItem = {
  conversation: typeof conversations.$inferSelect;
  contact: typeof contacts.$inferSelect;
  /** El último mensaje que enviamos no llegó — señal de número malo. */
  lastOutboundFailed: boolean;
  dropi: DropiSummary | null;
  shopify: ShopifySummary | null;
  assignedTo: AssignedTo | null;
  /**
   * Está esperando que una persona conteste. Lo decide `sinResponder`
   * (`@wa/db`) sobre los hechos de la conversación, en el servidor y una sola
   * vez: la fila, la tarjeta y el contador de la barra leen este mismo booleano,
   * que es lo que hace que digan el mismo número.
   */
  sinResponder: boolean;
  routing: ConversationRouting;
};

/** El corte de la lista. Es el de siempre y no cambia con la bandeja. */
const CORTE_DE_LISTA = 200;

/**
 * **La bandeja que se quiere ver, con la línea de corte del vendedor pegada.**
 *
 * Los dos datos viajan juntos porque son el mismo hecho —hay vendedor— dicho de
 * dos maneras, y separarlos fue el agujero que dejó abierto el ticket 01:
 * `resolveInbox` recibe el corte como parámetro **opcional**, así que omitirlo
 * compila y significa «no hay vendedor», o sea bandeja de ventas vacía. Cuatro
 * consultas de este archivo lo omitían y encender a Sebastián habría dejado su
 * bandeja permanentemente en cero, sin que nada dejara de compilar.
 *
 * Con este tipo eso ya no se puede escribir: pedir la bandeja es pasar el corte.
 */
export type BandejaPedida = {
  /** Cuál de las dos bandejas. */
  inbox: Inbox;
  /**
   * `sales_agent_settings.activated_at` — cuándo se encendió el vendedor de la
   * operación. `null` es «nunca se encendió», y entonces nada cae en ventas por
   * no tener pedido. En producción hoy es `null`, y por eso la bandeja de
   * ventas ni siquiera se ofrece.
   */
  activatedAt: Date | null;
};

/**
 * La línea de corte tal como {@link resolveInbox} la espera: la activación de la
 * operación y el nacimiento de **esta** conversación.
 *
 * Se arma por fila porque el nacimiento es de la fila; el `activated_at` es uno
 * solo para toda la operación y se lee una vez.
 */
function corteDelVendedor(activatedAt: Date | null, bornAt: Date): SalesCutoff {
  return { activatedAt, bornAt };
}

/**
 * Los pedidos de **un conjunto** de contactos, en la forma que el ruteo espera.
 *
 * Es la versión de conjunto de `apps/worker/src/inbox/facts.ts`, que carga un
 * contacto por vez: para las 200 filas del Inbox eso sería una consulta por
 * fila. Son dos implementaciones de la **carga**, no de la regla — la regla
 * (`resolveInbox`) es una sola y vive en `@wa/db`, que es lo que impide que se
 * desincronicen. Y el tipo las ata: las dos devuelven `OrderFacts`, así que el
 * día que el ruteo necesite un hecho más, las dos dejan de compilar juntas.
 *
 * Un pedido puede existir en la tienda, en la logística, o en las dos; el cruce
 * lo hace `dropi_orders.shopify_order_row_id`. Se cargan los tres casos por la
 * misma razón que allá: dejar fuera los que solo existen en logística haría que
 * un cliente con pedido en curso pareciera un lead sin nada.
 */
export async function loadOrderFactsByContact(
  op: Operation,
  contactIds: readonly string[],
): Promise<Map<string, OrderFacts[]>> {
  const porContacto = new Map<string, OrderFacts[]>();
  if (contactIds.length === 0) return porContacto;
  const ids = [...contactIds];

  const [fromStore, onlyLogistics] = await Promise.all([
    db
      .select({
        contactId: shopifyOrders.contactId,
        createdAt: shopifyOrders.receivedAt,
        pipelineStatus: shopifyOrders.status,
        logisticsStatus: dropiOrders.status,
      })
      .from(shopifyOrders)
      .leftJoin(dropiOrders, eq(dropiOrders.shopifyOrderRowId, shopifyOrders.id))
      .where(
        and(
          ofOperation(op, shopifyOrders.operationId),
          inArray(shopifyOrders.contactId, ids),
        ),
      ),
    db
      .select({
        contactId: dropiOrders.contactId,
        createdAt: dropiOrders.createdAt,
        logisticsStatus: dropiOrders.status,
      })
      .from(dropiOrders)
      .where(
        and(
          ofOperation(op, dropiOrders.operationId),
          inArray(dropiOrders.contactId, ids),
          isNull(dropiOrders.shopifyOrderRowId),
        ),
      ),
  ]);

  const agregar = (contactId: string | null, order: OrderFacts): void => {
    if (!contactId) return;
    const actuales = porContacto.get(contactId);
    if (actuales) actuales.push(order);
    else porContacto.set(contactId, [order]);
  };
  for (const row of fromStore) {
    agregar(row.contactId, {
      createdAt: row.createdAt,
      pipelineStatus: row.pipelineStatus,
      logisticsStatus: row.logisticsStatus,
    });
  }
  for (const row of onlyLogistics) {
    agregar(row.contactId, {
      createdAt: row.createdAt,
      pipelineStatus: null,
      logisticsStatus: row.logisticsStatus,
    });
  }
  return porContacto;
}

/**
 * **Los salientes de la operación que el Inbox necesita, en un solo viaje.**
 *
 * Son dos hechos distintos leídos de la misma tabla: *cuándo fue la última vez
 * que le contestamos a cada cliente* —lo que decide si está esperando— y *qué
 * escaladas a humano se le avisaron*, que es lo que marca la fila. Antes eran
 * tres consultas: las dos de `loadSinResponderIds` más una tercera que volvía a
 * pedir las escaladas, ya filtradas por los `wa_id` que la lista iba a mostrar.
 *
 * **La tercera sobraba entera.** La segunda ya traía *todas* las escaladas de la
 * operación —93 filas en producción, sin filtro por `wa_id`—, así que la lista
 * de una conversación cualquiera ya estaba en memoria antes de que nadie la
 * pidiera. Pedirla otra vez era pagar la distancia por filas que ya estaban acá.
 *
 * Las otras dos viajan juntas con un `union all` y no fusionadas en una sola
 * consulta con `case`: cada mitad conserva su `from`, su `where` y su filtro por
 * operación a la vista, que es lo que la red de alcance sabe leer. Una consulta
 * que la red no puede ver pasa en verde sin mirar nada.
 *
 * **No hay tabla de escaladas.** `escalateToHuman` apaga el modo agente, encola
 * un aviso al cliente y otro al admin, y no deja fila que lo cuente; lo que
 * queda es ese aviso en `outbound_messages`, con el motivo dentro de su clave
 * de deduplicación. Leerlo de ahí reconstruye un hecho que pasó de verdad.
 *
 * `outbound_messages` no lleva operación, así que la acota `waIdOfOperation` en
 * las dos mitades. Y solo se leen los avisos al cliente, nunca los del admin:
 * esos van al teléfono del administrador —los 36 de producción, todos al mismo
 * número— y contarlos en el hilo del cliente sería contar dos veces la misma
 * escalada. Quedan fuera las escaladas cuyo motivo no manda aviso al cliente
 * (`manual` y `agent_request`): de esas no queda rastro fechado en ninguna
 * parte, y esta función prefiere no mostrarlas a inventarles una fecha.
 *
 * La última respuesta se agrupa por `to_wa_id` y **no por `conversation_id`**:
 * esa columna está en `null` en 316 de los 352 salientes manuales de producción,
 * así que agrupar por ella cuenta como «nadie contestó» conversaciones donde una
 * persona sí contestó —cuatro el 20-ago-2026, con el texto de la respuesta
 * visible en la fila—.
 */
export interface SalientesDelInbox {
  /** El último saliente conversacional hacia cada cliente. */
  respuestaPorWaId: Map<string, Date>;
  /** Las escaladas avisadas al cliente, de la más vieja a la más nueva. */
  escaladasPorWaId: Map<string, EscalationFacts[]>;
}

async function loadSalientesDelInbox(
  op: Operation,
): Promise<SalientesDelInbox> {
  const ultimaRespuesta = db
    .select({
      clase: sql<string>`'respuesta'::text`.as("clase"),
      toWaId: outboundMessages.toWaId,
      at: sql<Date>`max(${outboundMessages.createdAt})`.as("at"),
      dedupKey: sql<string | null>`null::text`.as("dedup_key"),
    })
    .from(outboundMessages)
    .where(
      and(
        inArray(outboundMessages.source, [...SALIENTES_CONVERSACIONALES]),
        waIdOfOperation(op, outboundMessages.toWaId),
      ),
    )
    .groupBy(outboundMessages.toWaId);

  const avisosDeEscalada = db
    .select({
      clase: sql<string>`'escalada'::text`.as("clase"),
      toWaId: outboundMessages.toWaId,
      at: outboundMessages.createdAt,
      dedupKey: outboundMessages.dedupKey,
    })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.source, "escalation"),
        waIdOfOperation(op, outboundMessages.toWaId),
      ),
    );

  const filas = await unionAll(ultimaRespuesta, avisosDeEscalada);

  const respuestaPorWaId = new Map<string, Date>();
  const escaladas: AvisoDeEscalada[] = [];
  for (const fila of filas) {
    if (fila.clase === "respuesta") {
      respuestaPorWaId.set(fila.toWaId, new Date(fila.at));
      continue;
    }
    // El `null` es el de la mitad de arriba, que no tiene clave: no llega acá.
    if (fila.dedupKey === null) continue;
    escaladas.push({
      toWaId: fila.toWaId,
      dedupKey: fila.dedupKey,
      createdAt: new Date(fila.at),
    });
  }
  return { respuestaPorWaId, escaladasPorWaId: escaladasPorWaId(escaladas) };
}

/** Un aviso de escalada tal como quedó en `outbound_messages`. */
interface AvisoDeEscalada {
  toWaId: string;
  dedupKey: string;
  createdAt: Date;
}

/**
 * **Qué avisos cuentan como escalada del cliente, y en qué orden van.** Pura.
 *
 * Está aparte porque los avisos se cargan de dos formas —todos los de la
 * operación en el viaje del Inbox, o los de un solo cliente al abrir su hilo— y
 * eso son dos cargas, no dos reglas. Es la misma división que
 * `loadOrderFactsByContact` tiene con `apps/worker/src/inbox/facts.ts`, y por el
 * mismo motivo: el día que cambie qué clave cuenta, cambia en un sitio.
 *
 * De la más vieja a la más nueva, que es como el hilo las narra y como
 * {@link sinResponderEntre} espera encontrar la última al final.
 */
function escaladasPorWaId(
  avisos: readonly AvisoDeEscalada[],
): Map<string, EscalationFacts[]> {
  const porWaId = new Map<string, EscalationFacts[]>();
  for (const aviso of avisos) {
    const reason = escalationReasonFromDedupKey(aviso.dedupKey);
    // Sin motivo legible es el aviso al admin (u otra clave que no reconocemos):
    // no es una escalada del cliente y no va a su hilo.
    if (reason === null) continue;
    const actuales = porWaId.get(aviso.toWaId);
    const hecho: EscalationFacts = { at: aviso.createdAt, reason };
    if (actuales) actuales.push(hecho);
    else porWaId.set(aviso.toWaId, [hecho]);
  }
  for (const lista of porWaId.values()) {
    lista.sort((a, b) => a.at.getTime() - b.at.getTime());
  }
  return porWaId;
}

/**
 * Las escaladas avisadas a **un puñado de clientes**, para el hilo abierto.
 *
 * Es la otra carga de la misma regla. El Inbox no pasa por acá —sus escaladas
 * vienen en el viaje de {@link loadSalientesDelInbox}, que ya las trae todas—;
 * esto lo usa el contexto de venta de una conversación, donde pedir las 93 de
 * la operación para mirar una sería traer de más por no filtrar.
 */
async function loadEscalationsByWaId(
  op: Operation,
  waIds: readonly string[],
): Promise<Map<string, EscalationFacts[]>> {
  if (waIds.length === 0) return new Map();
  const rows = await db
    .select({
      toWaId: outboundMessages.toWaId,
      dedupKey: outboundMessages.dedupKey,
      createdAt: outboundMessages.createdAt,
    })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.source, "escalation"),
        inArray(outboundMessages.toWaId, [...waIds]),
        waIdOfOperation(op, outboundMessages.toWaId),
      ),
    );
  return escaladasPorWaId(rows);
}

/**
 * **Las tres condiciones de `puedeEstarSinResponder`, dichas en SQL.**
 *
 * Es la única copia de la regla que existe fuera de `@wa/db`, y está acotada a
 * propósito: son tres columnas —el modo agente, la asignación y la actividad—,
 * ninguna decisión. Lo que decide sigue siendo la función pura, que corre sobre
 * lo que esta consulta deja pasar; si esta se equivoca de más, la función lo
 * corrige, y si se equivoca de menos deja fuera una conversación, que es por lo
 * que están las tres condiciones escritas igual en los dos sitios.
 *
 * Existe porque decidir esto en TypeScript obliga a traerse las 1.760
 * conversaciones de Guatemala en cada carga del Inbox: 573 ms contra 132, sobre
 * la pantalla que Katherine abre todo el día.
 *
 * El `GREATEST` es el mismo de {@link lastActivityAt}, y el corte de días es la
 * constante de `@wa/db`: acá no hay ningún 30 escrito a mano.
 */
function puedeEstarEnSQL(ahora: Date): SQL {
  const desde = new Date(
    ahora.getTime() - DIAS_SIN_RESPONDER * 24 * 60 * 60 * 1000,
  );
  return and(
    eq(contacts.agentMode, false),
    isNull(conversations.assignedUserId),
    // En texto y con el `cast` puesto: en un `sql` crudo el parámetro viaja sin
    // el tipo de la columna, y el driver no sabe serializar un `Date` suelto.
    sql`${lastActivityAt} >= ${desde.toISOString()}::timestamptz`,
  )!;
}

/**
 * Los hechos de una conversación que la regla de «sin responder» mira. Es lo
 * que `puedeEstarEnSQL` deja pasar, con el `wa_id` de su contacto pegado.
 */
interface CandidataSinResponder {
  id: string;
  waId: string | null;
  agentMode: boolean;
  assignedUserId: string | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  createdAt: Date;
}

/**
 * **La regla de `sinResponder` aplicada a lo que ya se trajo. No consulta nada.**
 *
 * Está partida de la carga a propósito y no por gusto de simetría: los dos
 * llamadores cargan las candidatas de forma distinta —el Inbox las trae en el
 * mismo viaje que su lista, el contador de la barra las trae solas— y con la
 * regla adentro de la carga, partir la carga habría partido la regla. Es la
 * misma frase de siempre: una decisión, un sitio.
 */
function sinResponderEntre(
  candidatas: readonly CandidataSinResponder[],
  salientes: SalientesDelInbox,
  ahora: Date,
): Set<string> {
  const ids = new Set<string>();
  for (const fila of candidatas) {
    const esperando = sinResponder(
      {
        lastInboundAt: fila.lastInboundAt,
        lastConversationalOutboundAt: fila.waId
          ? salientes.respuestaPorWaId.get(fila.waId) ?? null
          : null,
        agentMode: fila.agentMode,
        assignedUserId: fila.assignedUserId,
        // La regla compara contra la escalada más reciente, que es la última de
        // la lista porque `loadSalientesDelInbox` las deja en orden.
        lastEscalationAt: fila.waId
          ? salientes.escaladasPorWaId.get(fila.waId)?.at(-1)?.at ?? null
          : null,
        lastActivityAt: actividadDe(fila),
      },
      ahora,
    );
    if (esperando) ids.add(fila.id);
  }
  return ids;
}

/**
 * **Qué conversaciones de la operación están sin responder**, todas, no las que
 * se ven.
 *
 * Se calcula sobre las 1.760 y no sobre las 200 que la lista carga, y esa es la
 * diferencia entre un número y un adorno: el 20-ago-2026 las 200 más recientes
 * por actividad cubren cinco días —del 15 al 20 de agosto— y **solo una de ellas
 * tiene el agente apagado**. La conversación sin responder mejor rankeada está
 * en el puesto 668. Contando sobre lo cargado, la tarjeta del Inbox decía 0
 * mientras 35 clientes esperaban respuesta.
 *
 * La regla es de `@wa/db` y acá solo se cargan los hechos: dos consultas —las
 * conversaciones con su contacto, y los salientes de la operación—, ninguna por
 * fila. Eran tres hasta PRO-16; ver {@link loadSalientesDelInbox}.
 *
 * **La usa el contador de la barra lateral, no el Inbox.** `listConversations`
 * no llama acá porque sus candidatas vienen en el mismo viaje que su lista: la
 * regla que aplica es la misma —{@link sinResponderEntre}—, lo que cambia es de
 * dónde salieron las filas.
 */
async function loadSinResponderIds(
  op: Operation,
  ahora: Date,
): Promise<Set<string>> {
  const [candidatas, salientes] = await Promise.all([
    db
      .select({
        id: conversations.id,
        waId: contacts.waId,
        agentMode: contacts.agentMode,
        assignedUserId: conversations.assignedUserId,
        lastInboundAt: conversations.lastInboundAt,
        lastOutboundAt: conversations.lastOutboundAt,
        createdAt: conversations.createdAt,
      })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(
        and(
          ofOperation(op, conversations.operationId),
          puedeEstarEnSQL(ahora),
        ),
      ),
    loadSalientesDelInbox(op),
  ]);
  return sinResponderEntre(candidatas, salientes, ahora);
}

/**
 * Suelta las conversaciones cuya asignación quedó vieja porque cambiaron de
 * bandeja. Las dos columnas a `null`, que es lo que el ticket 04 llama soltar.
 *
 * **Escribe desde una lectura, y es a propósito.** El cambio de bandeja no
 * tiene un momento propio en el que engancharse: nadie mueve la conversación,
 * la mueve un pedido que nació o un clic que llegó, y eso se descubre al volver
 * a derivar. El ticket lo dice con esas palabras —«al detectar el cambio, las
 * dos columnas a null»— y detectarlo es esto. Es idempotente y solo corre
 * cuando hay algo que soltar.
 */
async function releaseStaleAssignments(
  op: Operation,
  conversationIds: readonly string[],
): Promise<void> {
  if (conversationIds.length === 0) return;
  await db
    .update(conversations)
    .set({ assignedUserId: null, assignedAt: null })
    .where(
      and(
        ofOperation(op, conversations.operationId),
        inArray(conversations.id, [...conversationIds]),
      ),
    );
}

/**
 * Qué conversaciones de la operación caen en una bandeja, por actividad.
 *
 * Deriva sobre **todas** las conversaciones y no sobre las 200 más recientes:
 * cortar antes de filtrar dejaría la bandeja de ventas vacía cuando las 200
 * últimas sean de operaciones, que es exactamente lo que pasa hoy en Guatemala.
 * El corte se aplica después, sobre lo que ya es de la bandeja.
 *
 * Aprovecha el viaje para soltar las asignaciones que quedaron viejas: los
 * hechos que deciden si cambió de bandeja son los mismos que acaba de cargar.
 */
async function conversationIdsOfInbox(
  op: Operation,
  { inbox, activatedAt }: BandejaPedida,
  term: string | undefined,
): Promise<string[]> {
  const candidatas = await db
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      adReferralAt: conversations.adReferralAt,
      assignedUserId: conversations.assignedUserId,
      assignedAt: conversations.assignedAt,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(
      and(
        ofOperation(op, conversations.operationId),
        term ? conversationSearchFilter(term) : undefined,
      ),
    )
    .orderBy(desc(lastActivityAt));

  const pedidos = await loadOrderFactsByContact(
    op,
    candidatas.map((c) => c.contactId),
  );

  const elegidas: string[] = [];
  const soltar: string[] = [];
  for (const fila of candidatas) {
    const facts: InboxFacts = {
      lastAdClickAt: fila.adReferralAt,
      orders: pedidos.get(fila.contactId) ?? [],
    };
    const corte = corteDelVendedor(activatedAt, fila.createdAt);
    if (resolveInbox(facts, corte).inbox === inbox) elegidas.push(fila.id);
    if (
      fila.assignedUserId !== null &&
      fila.assignedAt !== null &&
      inboxChangedSince(facts, fila.assignedAt, corte)
    ) {
      soltar.push(fila.id);
    }
  }
  await releaseStaleAssignments(op, soltar);
  return elegidas;
}

/** Lo que la fila necesita del asignado, sin exponer más del usuario. */
function assignedToOf(
  assigned: { id: string; name: string | null; email: string } | null,
): AssignedTo | null {
  if (!assigned) return null;
  return { id: assigned.id, label: assigned.name ?? assigned.email };
}

export type ListConversationsOptions = {
  /** Busca sobre TODAS las conversaciones, no solo sobre las que se muestran. */
  search?: string;
  /**
   * Conversación que debe aparecer aunque quede fuera del corte, del filtro o
   * **de la bandeja**: el salto desde Pedidos apunta a una concreta, y quien la
   * pidió por id tiene derecho a verla venga de donde venga.
   */
  pinnedId?: string;
  /**
   * La bandeja que se quiere ver, con la línea de corte del vendedor.
   * `undefined` **no** significa «las dos»: significa que no hay dos, porque la
   * operación no tiene vendedor configurado. Ahí no se deriva nada y la lista es
   * byte por byte la de siempre — es el interruptor de la no-regresión de
   * `sales_agent_settings` llevado hasta la pantalla.
   */
  bandeja?: BandejaPedida;
};

/**
 * Lista del Inbox, ordenada por actividad real y acotada a una bandeja si se
 * pide una.
 *
 * **Trae las 200 más recientes y, además, todas las que están sin responder.**
 * Las dos cosas, porque el corte por actividad las esconde: el 20-ago-2026 las
 * 200 más recientes cubren cinco días y la conversación sin responder mejor
 * rankeada está en el puesto 668. Sin esta unión, la tarjeta puede decir 35 y el
 * filtro mostrar una sola fila — que es la misma clase de mentira que este lote
 * vino a sacar del panel. Con ella, el número y las filas son el mismo conjunto.
 *
 * La unión **no se aplica al buscar**: buscando, la lista es el resultado de la
 * búsqueda y nada más.
 */
export async function listConversations(
  op: Operation,
  options: ListConversationsOptions = {},
): Promise<ConversationListItem[]> {
  const { search, pinnedId, bandeja } = options;
  const term = search?.trim();
  const ahora = new Date();
  const selection = {
    conversation: conversations,
    contact: contacts,
    // "Lo último que le mandamos no llegó", no "alguna vez falló algo":
    // un fallo viejo ya resuelto no debe marcar la conversación.
    lastOutboundFailed: sql<boolean>`coalesce((
      select m.status = 'failed'
      from ${messages} m
      where m.conversation_id = ${conversations.id} and m.direction = 'out'
      order by m.created_at desc
      limit 1
    ), false)`,
    assigned: {
      id: users.id,
      name: users.name,
      email: users.email,
    },
  };

  // Con bandeja, el conjunto se decide derivando y el `where` solo trae esos
  // ids; sin bandeja, es el filtro de siempre.
  const deLaBandeja =
    bandeja === undefined ? null : await conversationIdsOfInbox(op, bandeja, term);
  const alcance =
    deLaBandeja === null
      ? term
        ? conversationSearchFilter(term)
        : undefined
      : deLaBandeja.length === 0
        ? sql`false`
        : inArray(conversations.id, deLaBandeja.slice(0, CORTE_DE_LISTA));

  /**
   * **Las 200 del corte, como subconsulta de ids y no como consulta aparte.**
   *
   * El `LIMIT` tiene que quedarse en SQL: sin él, «traeme el corte y además las
   * que puedan estar sin responder» se convierte en traer la operación entera
   * —1.725 filas con su contacto— para tirar 1.500 en memoria. Lo que sube en
   * bytes es peor que lo que baja en viajes.
   *
   * No lleva el `leftJoin` de usuarios que sí lleva la consulta de afuera, y eso
   * no cambia qué ids trae: `users.id` es clave primaria, así que ese join
   * empareja como mucho una fila y no puede multiplicar ni perder ninguna.
   */
  const delCorte = db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(and(ofOperation(op, conversations.operationId), alcance))
    .orderBy(desc(lastActivityAt))
    .limit(CORTE_DE_LISTA)
    .as("del_corte");

  const estaEnElCorte = sql<boolean>`${delCorte.id} is not null`;
  const puedeEstarSinResponder = puedeEstarEnSQL(ahora);
  // La conversación anclada se pide **dentro de esta misma consulta**, y no
  // aparte: el salto desde Pedidos trae un id que muchas veces ya está en la
  // lista, y cuando no está era un viaje entero por una fila. El `and` con la
  // operación es el mismo de siempre —lo pone el `where` de abajo—, así que un
  // id de otro país sigue sin poder colarse arriba de la lista.
  const esLaAnclada = pinnedId
    ? eq(conversations.id, pinnedId)
    : undefined;

  // **Un viaje para las tres listas de conversaciones que el Inbox necesita.**
  //
  // Eran tres consultas con la misma forma: el corte, las candidatas a estar sin
  // responder —que se calculan sobre TODAS y no sobre las 200, o el número
  // miente— y las rezagadas, que son las candidatas que quedaron fuera del corte
  // por viejas y que la lista tiene que mostrar igual. Las tres leen
  // `conversations` con su contacto y su asignado; lo único que las distinguía
  // era el `where`. Ahora el `where` es la unión de los tres y cada fila dice a
  // cuál pertenece.
  //
  // Y va en paralelo con los salientes: la lista no depende de quién contestó, y
  // encadenarlas le sumaría un viaje entero a la pantalla que más se abre.
  const [traidas, salientes] = await Promise.all([
    db
      .select({
        ...selection,
        estaEnElCorte,
        puedeEstarSinResponder,
      })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .leftJoin(users, eq(users.id, conversations.assignedUserId))
      .leftJoin(delCorte, eq(delCorte.id, conversations.id))
      .where(
        and(
          ofOperation(op, conversations.operationId),
          or(estaEnElCorte, puedeEstarSinResponder, esLaAnclada),
        ),
      )
      .orderBy(desc(lastActivityAt)),
    loadSalientesDelInbox(op),
  ]);

  /** La fila como la lista la devuelve, sin las banderas que solo sirvieron para traerla. */
  const sinBanderas = ({
    estaEnElCorte: _corte,
    puedeEstarSinResponder: _candidata,
    ...fila
  }: (typeof traidas)[number]) => fila;

  const sinResponderDeLaOperacion = sinResponderEntre(
    traidas
      .filter((r) => r.puedeEstarSinResponder)
      .map((r) => ({
        id: r.conversation.id,
        waId: r.contact.waId,
        agentMode: r.contact.agentMode,
        assignedUserId: r.conversation.assignedUserId,
        lastInboundAt: r.conversation.lastInboundAt,
        lastOutboundAt: r.conversation.lastOutboundAt,
        createdAt: r.conversation.createdAt,
      })),
    salientes,
    ahora,
  );

  // Las que están esperando respuesta y quedaron fuera del corte por viejas.
  // Con bandeja se acotan a la bandeja: una conversación de operaciones no
  // aparece en la de ventas por estar sin responder.
  //
  // La unión **no se aplica al buscar**: buscando, la lista es el resultado de
  // la búsqueda y nada más.
  const deLaBandejaSet = deLaBandeja === null ? null : new Set(deLaBandeja);
  const muestra = new Set<string>();
  for (const fila of traidas) {
    const id = fila.conversation.id;
    if (fila.estaEnElCorte) muestra.add(id);
    else if (
      !term &&
      sinResponderDeLaOperacion.has(id) &&
      (deLaBandejaSet === null || deLaBandejaSet.has(id))
    ) {
      muestra.add(id);
    }
  }

  // El orden lo pone la actividad, que es el `ORDER BY` con el que vinieron: las
  // rezagadas son viejas y caen al final solas. Filtrar conserva ese orden, así
  // que acá no hay que volver a ordenar nada.
  const rows = traidas
    .filter((r) => muestra.has(r.conversation.id))
    .map(sinBanderas);

  // La anclada va arriba de todo, venga de donde venga: quien la pidió por id
  // tiene derecho a verla aunque quede fuera del corte, del filtro o de la
  // bandeja. Ya vino en el mismo viaje; acá solo se la pone en su sitio.
  if (pinnedId && !muestra.has(pinnedId)) {
    const anclada = traidas.find((r) => r.conversation.id === pinnedId);
    if (anclada) rows.unshift(sinBanderas(anclada));
  }

  const contactIds = rows.map((r) => r.contact.id);
  if (contactIds.length === 0) {
    return rows.map((r) => ({
      ...r,
      dropi: null,
      shopify: null,
      assignedTo: assignedToOf(r.assigned),
      sinResponder: sinResponderDeLaOperacion.has(r.conversation.id),
      routing: { inbox: null, escalations: [] },
    }));
  }

  // Los viajes que faltan van juntos: ninguno depende del otro, y en fila india
  // cada uno le suma su ida y vuelta a la carga del Inbox.
  //
  // La bandeja de cada fila solo se deriva cuando hay bandeja: sin vendedor
  // configurado la pantalla no la muestra, y cobrarle una consulta a Katherine
  // por un dato que no se dibuja es la definición de regresión de rendimiento.
  //
  // **Las escaladas ya no están acá y siguen cargándose siempre**: vinieron en
  // el viaje de los salientes, que se hace con bandeja o sin ella. Es lo que
  // hace que Katherine vea marcadas las conversaciones en las que un agente
  // pidió expresamente que mirara una persona, y desde PRO-16 sale gratis.
  const [dropiRows, shopifyRows, pedidos] = await Promise.all([
    // Ordenados para que al colapsar a un resumen por contacto gane el más
    // reciente.
    db
      .select()
      .from(dropiOrders)
      .where(
        and(
          ofOperation(op, dropiOrders.operationId),
          inArray(dropiOrders.contactId, contactIds),
        ),
      )
      .orderBy(desc(dropiOrders.updatedAt)),
    // El pedido de tienda más reciente por contacto — de ahí salen las opciones
    // de la plantilla para reabrir.
    db
      .select({
        contactId: shopifyOrders.contactId,
        orderId: shopifyOrders.orderId,
        totalPrice: shopifyOrders.totalPrice,
        receivedAt: shopifyOrders.receivedAt,
        producto: sql<string>`coalesce(${shopifyOrders.rawPayload}->'line_items'->0->>'title', '')`,
      })
      .from(shopifyOrders)
      .where(
        and(
          ofOperation(op, shopifyOrders.operationId),
          inArray(shopifyOrders.contactId, contactIds),
        ),
      )
      .orderBy(desc(shopifyOrders.receivedAt)),
    bandeja === undefined ? null : loadOrderFactsByContact(op, contactIds),
  ]);

  const byContact = new Map<string, DropiSummary>();
  for (const o of dropiRows) {
    if (!o.contactId) continue;
    const cur = byContact.get(o.contactId);
    if (!cur) {
      byContact.set(o.contactId, {
        status: o.status,
        hasNovedad: o.status === "novedad",
        guideNumber: o.guideNumber,
        carrier: o.carrier,
        guidePdfPath: o.guidePdfPath,
        novedadReason: o.novedadReasonRaw,
        updatedAt: o.updatedAt,
      });
    } else if (o.status === "novedad") {
      cur.hasNovedad = true;
    }
  }

  const shopifyByContact = new Map<string, ShopifySummary>();
  for (const o of shopifyRows) {
    if (!o.contactId || shopifyByContact.has(o.contactId)) continue;
    shopifyByContact.set(o.contactId, {
      orderNumber: o.orderId,
      totalPrice: o.totalPrice,
      producto: o.producto || null,
    });
  }

  return rows.map((r) => ({
    ...r,
    dropi: byContact.get(r.contact.id) ?? null,
    shopify: shopifyByContact.get(r.contact.id) ?? null,
    assignedTo: assignedToOf(r.assigned),
    sinResponder: sinResponderDeLaOperacion.has(r.conversation.id),
    routing: {
      inbox:
        pedidos === null
          ? null
          : resolveInbox(
              {
                lastAdClickAt: r.conversation.adReferralAt,
                orders: pedidos.get(r.contact.id) ?? [],
              },
              corteDelVendedor(
                bandeja?.activatedAt ?? null,
                r.conversation.createdAt,
              ),
            ).inbox,
      escalations:
        (r.contact.waId
          ? salientes.escaladasPorWaId.get(r.contact.waId)
          : null) ?? [],
    },
  }));
}

/**
 * Cuántas conversaciones hay en cada vista de la bandeja de ventas.
 *
 * Vive aquí y no en la pantalla porque **el contador tiene que verse desde
 * afuera de la bandeja** (decisión 1 del nivel 2): lo pinta la barra lateral,
 * que se dibuja en todas las pantallas del panel. Si solo apareciera estando ya
 * dentro, no serviría para que entres.
 *
 * **Las tres vistas dicen su regla en el nombre**, que es de lo que trata el
 * ticket 03. «Sin responder» es `sinResponder` (`@wa/db`), el mismo booleano que
 * marca la fila y que cuenta la tarjeta del Inbox — un nombre por número. «En
 * automático» es el agente llevando la conversación, y solo puede existir con
 * vendedor encendido: es el opuesto exacto de «Respuesta manual», que la
 * cabecera del hilo ya dice.
 */
export type InboxViewCounts = {
  sinResponder: number;
  enAutomatico: number;
  todas: number;
};

/**
 * **Solo se llama con vendedor encendido.** El parámetro es la fila entera y no
 * su `activated_at` justamente por eso: quien la llama tuvo que pasar antes por
 * `salesAgentIsConfigured`, que es el único listón de «hay vendedor» del
 * monorepo, y de ahí sale la fila que se pasa acá. Sin vendedor no hay bandeja
 * de ventas, no hay vistas y esta consulta no corre.
 *
 * Es lo que le da sentido a «En automático»: `contacts.agent_mode` es un solo
 * booleano que los flujos de Katherine también prenden —1.579 conversaciones de
 * ella lo tienen en `true`—, así que contar el modo agente a secas contaría el
 * trabajo de Katherine como trabajo del vendedor. Acotado a la bandeja de
 * ventas, y existiendo la bandeja solo con vendedor encendido, el número dice lo
 * que su nombre dice. No se parte la columna en dos: derivar alcanza mientras
 * solo un agente esté encendido sobre el número.
 */
export async function countSalesInboxViews(
  op: Operation,
  vendedor: SalesAgentSettings,
): Promise<InboxViewCounts> {
  const ahora = new Date();
  const [filas, sinResponderIds] = await Promise.all([
    db
      .select({
        id: conversations.id,
        contactId: conversations.contactId,
        adReferralAt: conversations.adReferralAt,
        createdAt: conversations.createdAt,
        agentMode: contacts.agentMode,
      })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(ofOperation(op, conversations.operationId)),
    loadSinResponderIds(op, ahora),
  ]);

  const pedidos = await loadOrderFactsByContact(
    op,
    filas.map((f) => f.contactId),
  );

  const counts: InboxViewCounts = { sinResponder: 0, enAutomatico: 0, todas: 0 };
  for (const fila of filas) {
    const decision = resolveInbox(
      {
        lastAdClickAt: fila.adReferralAt,
        orders: pedidos.get(fila.contactId) ?? [],
      },
      corteDelVendedor(vendedor.activatedAt, fila.createdAt),
    );
    if (decision.inbox !== "ventas") continue;
    counts.todas += 1;
    if (fila.agentMode) counts.enAutomatico += 1;
    // No es `else`: una conversación en automático no está sin responder —el
    // agente la lleva—, y `sinResponder` ya lo dice por su cuenta. Escribirlo
    // dos veces es cómo las dos reglas se separan.
    if (sinResponderIds.has(fila.id)) counts.sinResponder += 1;
  }
  return counts;
}

/**
 * El contexto de venta de una conversación, para narrarlo en el hilo.
 *
 * El nombre del producto sale de `products.name`, que es nulo para los
 * conectados a la tienda —ahí el nombre vive en Shopify y se lee en tiempo de
 * uso, que es una decisión del catálogo—. Cuando falta, el evento nombra el
 * anuncio en vez del producto: decir «reconoció» sin decir qué sería peor que
 * decir de qué anuncio vino.
 */
export async function getSalesContext(
  op: Operation,
  conversationId: string,
): Promise<SalesContextFacts | null> {
  const [row] = await db
    .select({
      adReferralAt: conversations.adReferralAt,
      adId: conversations.adId,
      adHeadline: conversations.adHeadline,
      productId: conversations.productId,
      productName: products.name,
      productRecognition: conversations.productRecognition,
      productCandidateIds: conversations.productCandidateIds,
      waId: contacts.waId,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .leftJoin(products, eq(products.id, conversations.productId))
    .where(
      rowOfOperation(
        op,
        conversations.id,
        conversationId,
        conversations.operationId,
      ),
    )
    .limit(1);
  if (!row) return null;

  const escaladas = row.waId
    ? await loadEscalationsByWaId(op, [row.waId])
    : new Map<string, EscalationFacts[]>();

  return {
    adReferralAt: row.adReferralAt,
    adId: row.adId,
    adHeadline: row.adHeadline,
    productName: row.productName,
    productIdentified: row.productId !== null,
    recognitionOutcome: parseRecognitionOutcome(row.productRecognition),
    candidates: await candidateNames(op, row.productCandidateIds),
    escalations: (row.waId ? escaladas.get(row.waId) : null) ?? [],
  };
}

/**
 * Los nombres de los candidatos registrados, **uno por id y en su orden**, con
 * `null` en el que ya no se puede nombrar: borrado del catálogo, de otra
 * operación, o conectado a la tienda —donde el nombre vive en Shopify y este
 * paquete no la consulta, igual que ya pasa con el producto identificado—.
 *
 * Se conserva el hueco en vez de descartarlo porque **cuántos eran es parte del
 * hecho**: «dudó entre tres» sigue siendo verdad aunque uno no se pueda nombrar.
 */
async function candidateNames(
  op: Operation,
  candidateIds: string[] | null,
): Promise<(string | null)[]> {
  const ids = (candidateIds ?? []).filter((id) => UUID.test(id));
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(and(ofOperation(op, products.operationId), inArray(products.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return ids.map((id) => byId.get(id)?.trim() || null);
}

/** Un uuid con guiones, que es lo que la `0026` guarda en la lista. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * «Esta la estoy trabajando yo», y su contrario.
 *
 * Escritura por id con la pertenencia dentro del `where`, como las otras tres:
 * asignarse la conversación de otro país sería decirle al equipo vecino que
 * alguien que no conocen la está atendiendo.
 *
 * **No toca `contacts.agent_mode` y no puede.** Asignarse y pausar al vendedor
 * son cosas distintas e independientes —se puede estar asignado sin haber
 * pausado a Sebastián—, y unirlas es el error que los dos tickets 04 se
 * molestan en prohibir por separado. Tomar es escribir las dos columnas;
 * soltar es ponerlas en `null`.
 */
export async function setAssignment(
  op: Operation,
  conversationId: string,
  userId: string | null,
): Promise<boolean> {
  const written = await db
    .update(conversations)
    .set({
      assignedUserId: userId,
      assignedAt: userId === null ? null : new Date(),
    })
    .where(
      rowOfOperation(
        op,
        conversations.id,
        conversationId,
        conversations.operationId,
      ),
    )
    .returning({ id: conversations.id });
  return written.length > 0;
}

/**
 * Las plantillas que Meta aprobó para la WABA de esta operación.
 *
 * Filtra por operación y no por WABA teniendo las dos a mano: la operación es
 * lo que el panel tiene en la mano, y traducir operación → conexión → WABA
 * sería una consulta más para llegar al mismo sitio. La columna existe desde la
 * `0024` justamente para esto.
 */
export async function listApprovedWaTemplates(
  op: Operation,
): Promise<string[]> {
  // **Cacheada desde PRO-15.** Es una de las cuatro lecturas que el Inbox pagaba
  // en cada render para traer lo mismo: las plantillas las aprueba Meta y el
  // catálogo se mueve una vez al mes. La invalida quien las escribe —
  // `ensureKapsoTemplates` y `refreshKapsoTemplateStatuses`, en el worker—, y lo
  // que acota el desfase entre procesos es el TTL. La consulta se queda acá
  // adentro, con su filtro por operación a la vista de la red de alcance.
  return plantillasAprobadasCache.recordar(op.id, async () => {
    const rows = await db
      .select({ name: waTemplates.name })
      .from(waTemplates)
      .where(
        and(
          ofOperation(op, waTemplates.operationId),
          eq(waTemplates.status, "approved"),
        ),
      );
    return rows.map((r) => r.name);
  });
}

/**
 * **De dónde cuelgan los PDF de las guías de esta operación**, ya sin la barra
 * final.
 *
 * Vivía suelta dentro de `inbox/page.tsx` y sube acá por dos motivos. El
 * primero es la red de alcance: la red lee `queries.ts`, así que una consulta a
 * `dropi_connection` escrita en la pantalla es una consulta que nadie vigila —y
 * esta es justamente la que, leída por `id = 1`, le habría puesto el CDN
 * guatemalteco a las guías colombianas. El segundo es que hace falta un sitio
 * donde poner la caché de PRO-15: la URL la escribe la pantalla de Conexión, o
 * sea una vez al mes, y se leía en cada render del Inbox.
 *
 * Normaliza acá y no en la pantalla porque normalizar dos veces el mismo dato es
 * cómo se separan: quien lo lea recibe la forma con la que se usa.
 */
export async function getAssetsBaseUrl(op: Operation): Promise<string> {
  return urlDeArchivosCache.recordar(op.id, async () => {
    const [row] = await db
      .select({ assetsBaseUrl: dropiConnection.assetsBaseUrl })
      .from(dropiConnection)
      .where(ofOperation(op, dropiConnection.operationId))
      .limit(1);
    return (row?.assetsBaseUrl ?? "").replace(/\/$/, "");
  });
}

/** Una conversación **de esta operación**. La de otra no existe para el panel. */
export async function getConversationById(op: Operation, id: string) {
  const [row] = await db
    .select({ conversation: conversations, contact: contacts })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(rowOfOperation(op, conversations.id, id, conversations.operationId))
    .limit(1);
  return row ?? null;
}

/**
 * El historial de un chat. `messages` no lleva operación —cuelga de la
 * conversación— pero el id llega desde la URL, así que la pertenencia se
 * verifica igual: sin esto, pegar el id de una conversación colombiana en la
 * URL abre el historial completo del cliente.
 */
export async function listMessages(
  op: Operation,
  conversationId: string,
  limit = 200,
) {
  return db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        throughConversationOfOperation(op, messages.conversationId),
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(limit);
}

/**
 * Marca el chat como leído. **Escritura por id: verifica pertenencia dentro del
 * `where`.** Es la más inocua de las tres —perder un contador de no leídos no
 * le cuesta nada a nadie— y va igual, porque la regla tiene que ser una sola:
 * si una escritura por id puede saltarse la verificación, la siguiente que
 * alguien copie de aquí también.
 *
 * Devuelve **si escribió**. Las tres lo hacen: un `ok: true` sobre una fila que
 * no se tocó es la forma de que el bug quede invisible en la pantalla del
 * asesor, que es donde tiene que verse.
 */
export async function markRead(
  op: Operation,
  conversationId: string,
): Promise<boolean> {
  const written = await db
    .update(conversations)
    .set({ unreadCount: 0 })
    .where(
      rowOfOperation(
        op,
        conversations.id,
        conversationId,
        conversations.operationId,
      ),
    )
    .returning({ id: conversations.id });
  return written.length > 0;
}

/**
 * Las plantillas de esta operación. De aquí salen las opciones de las seis FK
 * de plantilla de `agent_settings`, que es una fila por operación: ofrecer las
 * de otro país sería ofrecer que la configuración apunte al texto equivocado.
 */
export async function listTemplates(op: Operation) {
  return db
    .select()
    .from(templates)
    .where(ofOperation(op, templates.operationId))
    .orderBy(asc(templates.name));
}

/**
 * La configuración de agente ya no se lee aquí: el accesor único vive en
 * `@wa/db` y obliga a decir de qué operación se la quiere. Se re-exporta para
 * que las páginas lo sigan importando desde `@/lib/queries`.
 */
export { getAgentSettings } from "@wa/db";

/**
 * Conversaciones recientes para el selector del banco de pruebas del prompt:
 * permite probar el prompt sobre el historial real de un cliente.
 */
export async function listRecentConversationOptions(
  op: Operation,
  limit = 25,
) {
  const rows = await db
    .select({
      id: conversations.id,
      name: contacts.name,
      waId: contacts.waId,
      phone: contacts.phone,
      lastInboundAt: conversations.lastInboundAt,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(ofOperation(op, conversations.operationId))
    .orderBy(desc(lastActivityAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    label: r.name ?? (r.phone || r.waId || "sin nombre"),
  }));
}

/**
 * «Contesta el bot o contesto yo», sobre un contacto que **esta** operación
 * atiende.
 *
 * Es la escritura por id más peligrosa de las tres: apagar el modo agente de la
 * conversación de otro país deja a ese cliente esperando una respuesta que no
 * llega, y no hay nada en pantalla que lo diga. `contacts` no lleva operación
 * —una persona puede existir en las dos— así que el alcance se resuelve por su
 * conversación.
 */
export async function setAgentMode(
  op: Operation,
  contactId: string,
  on: boolean,
): Promise<boolean> {
  const written = await db
    .update(contacts)
    .set({ agentMode: on })
    .where(contactOfOperation(op, contactId))
    .returning({ id: contacts.id });
  return written.length > 0;
}

export type ConfirmationStatus =
  | "unknown"
  | "pending"
  | "confirmed"
  | "not_confirmed";

/**
 * *La* decisión de Katherine: confirmado o no confirmado. Escritura por id, con
 * la pertenencia dentro del `where` — marcar confirmado el pedido de otro país
 * dispara la confirmación a su logística.
 */
export async function setConfirmationStatus(
  op: Operation,
  conversationId: string,
  status: ConfirmationStatus,
): Promise<boolean> {
  const written = await db
    .update(conversations)
    .set({
      confirmationStatus: status,
      confirmationSource: "manual",
      confirmationUpdatedAt: new Date(),
    })
    .where(
      rowOfOperation(
        op,
        conversations.id,
        conversationId,
        conversations.operationId,
      ),
    )
    .returning({ id: conversations.id });
  return written.length > 0;
}

export async function listShopifyOrders(op: Operation, limit = 50) {
  return db
    .select()
    .from(shopifyOrders)
    .where(ofOperation(op, shopifyOrders.operationId))
    .orderBy(desc(shopifyOrders.receivedAt))
    .limit(limit);
}

export type OrderFilters = {
  /** Texto libre: número de pedido, nombre o teléfono. */
  q?: string;
  shopifyStatus?: string;
  dropiStatus?: string;
  carrier?: string;
  match?: string;
  /** Clave de LOGISTIC_SITUATIONS. */
  situacion?: string;
};

/**
 * Pedidos con su cruce de Dropi, filtrados EN EL SERVIDOR: son 1 195 y la
 * página solo puede mostrar unos cientos, así que un filtro en el cliente
 * dejaría fuera justo lo que se busca. Tampoco se envían los rawPayload de
 * Shopify y Dropi, que hacían el payload enorme sin que la tabla los use.
 */
export async function listShopifyOrdersWithDropi(
  op: Operation,
  filters: OrderFilters = {},
  limit = 300,
) {
  const where: Array<SQL | undefined> = [];

  const term = filters.q?.trim();
  if (term) {
    const like = `%${term}%`;
    const digits = term.replace(/\D/g, "");
    const parts: Array<SQL | undefined> = [
      ilike(shopifyOrders.orderId, like),
      ilike(shopifyOrders.customerName, like),
      ilike(dropiOrders.customerName, like),
      sql`coalesce(${dropiOrders.guideNumber}, '') ilike ${like}`,
    ];
    if (digits.length >= 3) {
      const digitsLike = `%${digits}%`;
      parts.push(
        sql`regexp_replace(${shopifyOrders.customerPhone}, '[^0-9]', '', 'g') like ${digitsLike}`,
      );
      parts.push(sql`${dropiOrders.dropiOrderId}::text like ${digitsLike}`);
    }
    where.push(or(...parts));
  }
  if (filters.shopifyStatus) {
    where.push(sql`${shopifyOrders.status}::text = ${filters.shopifyStatus}`);
  }
  if (filters.dropiStatus) {
    where.push(sql`${dropiOrders.status}::text = ${filters.dropiStatus}`);
  }
  if (filters.carrier) {
    where.push(eq(dropiOrders.carrier, filters.carrier));
  }
  if (filters.match) {
    where.push(
      filters.match === "none"
        ? sql`${dropiOrders.id} is null`
        : sql`${dropiOrders.matchConfidence}::text = ${filters.match}`,
    );
  }
  const situation = filters.situacion
    ? situationByKey(filters.situacion)
    : null;
  if (situation) {
    // La lista se arma con sql.join: interpolar el array directo hace que
    // drizzle lo expanda como placeholders sueltos ($1, $2…) y Postgres
    // rechaza tanto `IN $1, $2` como `any($1, $2)`.
    const movements = sql.join(
      situation.movements.map((m) => sql`${m}`),
      sql`, `,
    );
    where.push(
      sql`upper(coalesce(${dropiOrders.lastMovementRaw}, '')) in (${movements})`,
    );
  }

  return db
    .select({
      shopify: {
        id: shopifyOrders.id,
        orderId: shopifyOrders.orderId,
        customerName: shopifyOrders.customerName,
        customerPhone: shopifyOrders.customerPhone,
        receivedAt: shopifyOrders.receivedAt,
        status: shopifyOrders.status,
      },
      dropi: {
        id: dropiOrders.id,
        dropiOrderId: dropiOrders.dropiOrderId,
        status: dropiOrders.status,
        guideNumber: dropiOrders.guideNumber,
        carrier: dropiOrders.carrier,
        matchConfidence: dropiOrders.matchConfidence,
        confirmPutAt: dropiOrders.confirmPutAt,
        confirmDryRunAt: dropiOrders.confirmDryRunAt,
        guidePdfPath: dropiOrders.guidePdfPath,
        lastMovementRaw: dropiOrders.lastMovementRaw,
        lastMovementAt: dropiOrders.lastMovementAt,
      },
      // Salto directo al chat del cliente desde el pedido.
      conversationId: conversations.id,
    })
    .from(shopifyOrders)
    .leftJoin(dropiOrders, eq(dropiOrders.shopifyOrderRowId, shopifyOrders.id))
    .leftJoin(conversations, eq(conversations.contactId, shopifyOrders.contactId))
    // El alcance de operación va **aquí y no en el arreglo de arriba**: los
    // filtros de esa lista son todos opcionales y este no, y escribirlo sobre
    // la consulta es lo que deja verlo sin seguirle la pista a una variable.
    // La red de `consultas-del-panel` lo pedía y tenía razón.
    .where(and(ofOperation(op, shopifyOrders.operationId), ...where))
    .orderBy(desc(shopifyOrders.receivedAt))
    .limit(limit);
}

/** Transportadoras presentes en los datos, para poblar el filtro. */
export async function listCarriers(op: Operation): Promise<string[]> {
  const rows = await db
    .selectDistinct({ carrier: dropiOrders.carrier })
    .from(dropiOrders)
    .where(
      and(
        ofOperation(op, dropiOrders.operationId),
        isNotNull(dropiOrders.carrier),
      ),
    );
  return rows
    .map((r) => r.carrier)
    .filter((c): c is string => Boolean(c))
    .sort();
}
