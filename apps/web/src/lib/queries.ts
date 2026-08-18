import { db } from "./db";
import {
  contacts,
  conversations,
  messages,
  templates,
  shopifyOrders,
  dropiOrders,
  waTemplates,
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  or,
  sql,
} from "@wa/db";
import type { SQL } from "drizzle-orm";
import type { Operation } from "@wa/db";
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

export type ConversationListItem = {
  conversation: typeof conversations.$inferSelect;
  contact: typeof contacts.$inferSelect;
  /** El último mensaje que enviamos no llegó — señal de número malo. */
  lastOutboundFailed: boolean;
  dropi: DropiSummary | null;
  shopify: ShopifySummary | null;
};

/**
 * Lista del Inbox, ordenada por actividad real. `search` busca sobre TODAS las
 * conversaciones (no solo las 200 que se muestran), que es el punto: encontrar
 * a alguien de hace meses sin scrollear.
 */
export async function listConversations(
  op: Operation,
  search?: string,
  /** Conversación que debe aparecer aunque quede fuera del corte o del filtro
   *  (el salto desde Pedidos apunta a una concreta, que puede ser vieja). */
  pinnedId?: string,
): Promise<ConversationListItem[]> {
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
  };
  const rows = await db
    .select(selection)
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(
      and(
        ofOperation(op, conversations.operationId),
        term ? conversationSearchFilter(term) : undefined,
      ),
    )
    .orderBy(desc(lastActivityAt))
    .limit(200);

  // La conversación anclada también se verifica: el salto desde Pedidos trae un
  // id, y un id de otro país no puede colarse arriba de la lista.
  if (pinnedId && !rows.some((r) => r.conversation.id === pinnedId)) {
    const [pinned] = await db
      .select(selection)
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
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
    return rows.map((r) => ({ ...r, dropi: null, shopify: null }));
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

  return rows.map((r) => ({
    ...r,
    dropi: byContact.get(r.contact.id) ?? null,
    shopify: shopifyByContact.get(r.contact.id) ?? null,
  }));
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
