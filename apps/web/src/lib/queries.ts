import { db } from "./db";
import {
  contacts,
  conversations,
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
  escalationReasonFromDedupKey,
  inboxChangedSince,
  parseRecognitionOutcome,
  resolveInbox,
} from "@wa/db";
import type { SQL } from "drizzle-orm";
import type {
  EscalationFacts,
  Inbox,
  InboxFacts,
  Operation,
  OrderFacts,
  SalesContextFacts,
} from "@wa/db";
import { situationByKey } from "@wa/shared";
import {
  contactOfOperation,
  ofOperation,
  rowOfOperation,
  throughConversationOfOperation,
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
 * Lo que el ruteo derivó de una conversación. `null` cuando no se derivó nada,
 * que es el caso de una operación sin vendedor configurado: ahí no hay dos
 * bandejas, hay la de siempre, y calcular la bandeja de cada fila sería pagar
 * tres consultas para no mostrar nada.
 */
export type ConversationRouting = {
  /** La bandeja a la que pertenece hoy, derivada con la regla de `@wa/db`. */
  inbox: Inbox;
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
  routing: ConversationRouting | null;
};

/** El corte de la lista. Es el de siempre y no cambia con la bandeja. */
const CORTE_DE_LISTA = 200;

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
 * Las escaladas a humano que salieron hacia cada cliente.
 *
 * **No hay tabla de escaladas.** `escalateToHuman` apaga el modo agente, encola
 * un aviso al cliente y otro al admin, y no deja fila que lo cuente; lo que
 * queda es ese aviso en `outbound_messages`, con el motivo dentro de su clave
 * de deduplicación. Leerlo de ahí reconstruye un hecho que pasó de verdad.
 *
 * `outbound_messages` no lleva operación y no la necesita: los `wa_id` que
 * recibe salen de una lista de contactos **ya acotada** por la consulta que la
 * llama. Y solo se leen los avisos al cliente, nunca los del admin: esos van al
 * teléfono del administrador y contarlos en el hilo del cliente sería contar
 * dos veces la misma escalada.
 *
 * Quedan fuera las escaladas cuyo motivo no manda aviso al cliente
 * (`manual` y `agent_request`): de esas no queda rastro fechado en ninguna
 * parte, y esta función prefiere no mostrarlas a inventarles una fecha.
 */
async function loadEscalationsByWaId(
  waIds: readonly string[],
): Promise<Map<string, EscalationFacts[]>> {
  const porWaId = new Map<string, EscalationFacts[]>();
  if (waIds.length === 0) return porWaId;

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
      ),
    )
    .orderBy(asc(outboundMessages.createdAt));

  for (const row of rows) {
    const reason = escalationReasonFromDedupKey(row.dedupKey);
    // Sin motivo legible es el aviso al admin (u otra clave que no reconocemos):
    // no es una escalada del cliente y no va a su hilo.
    if (reason === null) continue;
    const actuales = porWaId.get(row.toWaId);
    const hecho: EscalationFacts = { at: row.createdAt, reason };
    if (actuales) actuales.push(hecho);
    else porWaId.set(row.toWaId, [hecho]);
  }
  return porWaId;
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
  inbox: Inbox,
  term: string | undefined,
): Promise<string[]> {
  const candidatas = await db
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      adReferralAt: conversations.adReferralAt,
      assignedUserId: conversations.assignedUserId,
      assignedAt: conversations.assignedAt,
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
    if (resolveInbox(facts).inbox === inbox) elegidas.push(fila.id);
    if (
      fila.assignedUserId !== null &&
      fila.assignedAt !== null &&
      inboxChangedSince(facts, fila.assignedAt)
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
   * La bandeja que se quiere ver. `undefined` **no** significa «las dos»:
   * significa que no hay dos, porque la operación no tiene vendedor
   * configurado. Ahí no se deriva nada y la lista es byte por byte la de
   * siempre — es el interruptor de la no-regresión de `sales_agent_settings`
   * llevado hasta la pantalla.
   */
  inbox?: Inbox;
};

/**
 * Lista del Inbox, ordenada por actividad real y acotada a una bandeja si se
 * pide una.
 */
export async function listConversations(
  op: Operation,
  options: ListConversationsOptions = {},
): Promise<ConversationListItem[]> {
  const { search, pinnedId, inbox } = options;
  const term = search?.trim();
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
    inbox === undefined ? null : await conversationIdsOfInbox(op, inbox, term);
  const alcance =
    deLaBandeja === null
      ? term
        ? conversationSearchFilter(term)
        : undefined
      : deLaBandeja.length === 0
        ? sql`false`
        : inArray(conversations.id, deLaBandeja.slice(0, CORTE_DE_LISTA));

  const rows = await db
    .select(selection)
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .leftJoin(users, eq(users.id, conversations.assignedUserId))
    .where(and(ofOperation(op, conversations.operationId), alcance))
    .orderBy(desc(lastActivityAt))
    .limit(CORTE_DE_LISTA);

  // La conversación anclada también se verifica: el salto desde Pedidos trae un
  // id, y un id de otro país no puede colarse arriba de la lista.
  if (pinnedId && !rows.some((r) => r.conversation.id === pinnedId)) {
    const [pinned] = await db
      .select(selection)
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .leftJoin(users, eq(users.id, conversations.assignedUserId))
      .where(
        rowOfOperation(
          op,
          conversations.id,
          pinnedId,
          conversations.operationId,
        ),
      )
      .limit(1);
    if (pinned) rows.unshift(pinned);
  }

  const contactIds = rows.map((r) => r.contact.id);
  if (contactIds.length === 0) {
    return rows.map((r) => ({
      ...r,
      dropi: null,
      shopify: null,
      assignedTo: assignedToOf(r.assigned),
      routing: null,
    }));
  }

  // Fetch all dropi orders for these contacts, ordered so the most recent
  // wins when we collapse to one summary per contact.
  const dropiRows = await db
    .select()
    .from(dropiOrders)
    .where(
      and(
        ofOperation(op, dropiOrders.operationId),
        inArray(dropiOrders.contactId, contactIds),
      ),
    )
    .orderBy(desc(dropiOrders.updatedAt));

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

  // Most recent Shopify order per contact — feeds the reopen-template options.
  const shopifyRows = await db
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
    .orderBy(desc(shopifyOrders.receivedAt));
  const shopifyByContact = new Map<string, ShopifySummary>();
  for (const o of shopifyRows) {
    if (!o.contactId || shopifyByContact.has(o.contactId)) continue;
    shopifyByContact.set(o.contactId, {
      orderNumber: o.orderId,
      totalPrice: o.totalPrice,
      producto: o.producto || null,
    });
  }

  // Lo derivado solo se calcula cuando hay bandeja: sin vendedor configurado la
  // pantalla no lo muestra, y cobrarle tres consultas a Katherine por un dato
  // que no se dibuja es la definición de regresión de rendimiento.
  const pedidos =
    inbox === undefined
      ? null
      : await loadOrderFactsByContact(op, contactIds);
  const escaladas =
    inbox === undefined
      ? null
      : await loadEscalationsByWaId(
          rows.map((r) => r.contact.waId).filter((w): w is string => w !== null),
        );

  return rows.map((r) => ({
    ...r,
    dropi: byContact.get(r.contact.id) ?? null,
    shopify: shopifyByContact.get(r.contact.id) ?? null,
    assignedTo: assignedToOf(r.assigned),
    routing:
      pedidos === null
        ? null
        : {
            inbox: resolveInbox({
              lastAdClickAt: r.conversation.adReferralAt,
              orders: pedidos.get(r.contact.id) ?? [],
            }).inbox,
            escalations:
              (r.contact.waId ? escaladas?.get(r.contact.waId) : null) ?? [],
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
 * Las tres vistas son las que el Inbox ya nombra: «necesitan atención» es el
 * `!agentMode && unread > 0` que la pantalla ya calcula, y «las lleva
 * Sebastián» es su `automatedCount`. No hay vocabulario nuevo acá.
 */
export type InboxViewCounts = {
  needsAttention: number;
  automated: number;
  all: number;
};

export async function countSalesInboxViews(
  op: Operation,
): Promise<InboxViewCounts> {
  const filas = await db
    .select({
      contactId: conversations.contactId,
      adReferralAt: conversations.adReferralAt,
      agentMode: contacts.agentMode,
      unreadCount: conversations.unreadCount,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(ofOperation(op, conversations.operationId));

  const pedidos = await loadOrderFactsByContact(
    op,
    filas.map((f) => f.contactId),
  );

  const counts: InboxViewCounts = { needsAttention: 0, automated: 0, all: 0 };
  for (const fila of filas) {
    const decision = resolveInbox({
      lastAdClickAt: fila.adReferralAt,
      orders: pedidos.get(fila.contactId) ?? [],
    });
    if (decision.inbox !== "ventas") continue;
    counts.all += 1;
    if (fila.agentMode) counts.automated += 1;
    else if (fila.unreadCount > 0) counts.needsAttention += 1;
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
    ? await loadEscalationsByWaId([row.waId])
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
