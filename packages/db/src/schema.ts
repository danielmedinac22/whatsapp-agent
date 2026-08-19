import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
  unique,
  check,
  customType,
} from "drizzle-orm/pg-core";

/** bytea — drizzle no trae helper para binarios. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// ────────────────────────────────────────────────────────────────────────────
// enums
// ────────────────────────────────────────────────────────────────────────────

/**
 * `sales` y `operations` entran en la `0022` (expand): ventas alcanza el módulo
 * del vendedor, operaciones el de confirmación, admin ambos. `operator` es el
 * valor heredado —nadie lo tiene en producción, los tres usuarios son `admin`—
 * y se conserva porque un valor de enum no se quita sin recrear el tipo. Los
 * valores nuevos **no se usan en la misma migración que los agrega**: Postgres
 * lo rechaza dentro de una transacción, y el migrator corre en una.
 *
 * `operations` es el equipo que confirma pedidos, no la tabla `operations`
 * (el país): la colisión es del lenguaje del negocio —«ventas» y
 * «operaciones»— y se prefirió respetarlo a inventar un sinónimo.
 */
export const userRole = pgEnum("user_role", [
  "admin",
  "operator",
  "sales",
  "operations",
]);

export const waStatus = pgEnum("wa_status", [
  "disconnected",
  "connecting",
  "qr",
  "connected",
]);

export const messageDirection = pgEnum("message_direction", ["in", "out"]);

export const messageStatus = pgEnum("message_status", [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
]);

export const orderStatus = pgEnum("order_status", [
  "received",
  "followup_scheduled",
  "followup_sent",
  "confirmed",
  "no_response",
  "cancelled",
]);

export const outboundStatus = pgEnum("outbound_status", [
  "pending",
  "sending",
  "sent",
  "acked",
  "dead",
  "failed",
]);

export const outboundSource = pgEnum("outbound_source", [
  "followup",
  "remarketing",
  "agent",
  "manual",
  "confirmation_ack",
  "dropi_status",
  "dropi_2fa",
  "escalation",
]);

export const outboundErrorKind = pgEnum("outbound_error_kind", [
  "transient",
  "permanent",
]);

export const confirmationStatus = pgEnum("confirmation_status", [
  "unknown",
  "pending",
  "confirmed",
  "not_confirmed",
]);

export const confirmationSource = pgEnum("confirmation_source", [
  "auto",
  "manual",
]);

export const dropiStatus = pgEnum("dropi_status", [
  "unknown",
  "pendiente_confirmacion",
  "pendiente",
  "guia_generada",
  "preparado_transportadora",
  "recolectado",
  "en_transito",
  "con_mensajero",
  // El paquete llegó a la oficina de la transportadora y espera que el cliente
  // lo reclame. Dropi lo reporta como ENTREGADO a nivel de pedido, así que sin
  // este estado propio le decíamos "ya fue entregado" a quien no lo tiene.
  "en_oficina",
  "entregado",
  "novedad",
  // "NOVEDAD SOLUCIONADA": estado propio a propósito — mapearlo a `novedad`
  // dispararía la escalación de una novedad que ya se resolvió.
  "novedad_solucionada",
  "devolucion",
  "rechazado",
  "retornado",
  "anulada",
]);

export const templateType = pgEnum("template_type", [
  "general",
  "followup",
  "remarketing",
  "confirmation_ack",
  "dropi_guia_generada",
  "dropi_recolectado",
  "dropi_en_transito",
  "dropi_con_mensajero",
  "dropi_entregado",
  "dropi_en_oficina",
]);

export const dropiMatchConfidence = pgEnum("dropi_match_confidence", [
  "high",
  "low",
  "manual",
]);

export const waTemplateStatus = pgEnum("wa_template_status", [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "paused",
]);

/**
 * `inactive` es la operación que existe pero no atiende: se usa para dar de
 * alta un país antes de que abra (Colombia) sin que nada empiece a operar por
 * el solo hecho de existir la fila.
 */
export const operationStatus = pgEnum("operation_status", [
  "active",
  "inactive",
]);

/**
 * De dónde sale la información de un producto del catálogo de ventas:
 * `shopify` la lee de la tienda en tiempo de uso (no la copia), `native` la
 * guarda el panel porque el producto todavía no existe en la tienda.
 */
export const productSource = pgEnum("product_source", ["shopify", "native"]);

// ────────────────────────────────────────────────────────────────────────────
// operations — un país donde el negocio opera
// ────────────────────────────────────────────────────────────────────────────

/**
 * De cada operación cuelgan su número de WhatsApp, su tienda, su logística y
 * su configuración de agente. Desde el contract (`0021`) esa referencia es
 * obligatoria y única en las cuatro tablas de configuración: no existe forma de
 * guardar ni de pedir «la» conexión sin decir de qué operación es.
 */
export const operations = pgTable(
  "operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Nombre visible en el panel: "Guatemala". */
    name: text("name").notNull(),
    /** ISO 3166-1 alfa-2 en mayúsculas: "GT", "CO". */
    countryCode: text("country_code").notNull(),
    /** ISO 4217: "GTQ", "COP". Mismo vocabulario que `shopify_orders.currency`. */
    currency: text("currency").notNull(),
    status: operationStatus("status").notNull().default("active"),
    /**
     * A qué **dataset** de Meta reporta esta operación sus conversiones (CAPI).
     * Migración `0023`. Nullable: nace vacío y lo configura el panel; una
     * operación sin dataset simplemente no reporta (`buildPurchaseEvent`
     * devuelve `no-event`), nunca reporta al de otra.
     *
     * **No es el píxel del sitio web, aunque el ticket lo llamara así.** Medido
     * contra la documentación de Meta el 17-ago-2026: las conversiones de
     * anuncios de clic a WhatsApp van por *Conversions API for Business
     * Messaging*, cuyo destino es un dataset que se crea **desde la cuenta de
     * WhatsApp** (`POST /{whatsapp_business_account_id}/dataset`, y el `GET`
     * devuelve el que ya exista) y al que se postea en `/{dataset_id}/events`.
     * El identificador del píxel publicitario de la cuenta no es ese valor y
     * ponerlo aquí manda los eventos a otro lado.
     *
     * Se queda en `operations` —y no junto a `business_account_id` en
     * `kapso_connection`, de donde sale la otra mitad del `user_data`— porque es
     * configuración de negocio de la operación, hermana de `currency`: las dos
     * cosas que el evento necesita saber del país viven en la misma fila y las
     * edita la misma pantalla.
     */
    capiDatasetId: text("capi_dataset_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Una operación es un país: el índice único evita la segunda "Guatemala" que
  // partiría en dos la operación que hoy factura.
  (t) => [uniqueIndex("operations_country_code_idx").on(t.countryCode)],
);

// ────────────────────────────────────────────────────────────────────────────
// users
// ────────────────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name"),
    role: userRole("role").notNull().default("operator"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

// ────────────────────────────────────────────────────────────────────────────
// whatsapp session (singleton row, id=1)
// ────────────────────────────────────────────────────────────────────────────

export const waSession = pgTable("wa_session", {
  id: integer("id").primaryKey().default(1),
  status: waStatus("status").notNull().default("disconnected"),
  phone: text("phone"),
  // encrypted Baileys auth state (creds + keys)
  authState: text("auth_state"),
  qr: text("qr"),
  lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// kapso connection (una por operación; `id` entero heredado del singleton)
// ────────────────────────────────────────────────────────────────────────────

export const kapsoConnection = pgTable(
  "kapso_connection",
  {
    id: integer("id").primaryKey().default(1),
    /**
     * Obligatoria desde el contract (`0021`). El `id` entero con `default 1` es
     * la clave primaria heredada del singleton; la clave del modelo es esta, y
     * el índice único de abajo la hace cumplir: una conexión por operación.
     */
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "restrict" }),
    phoneNumberId: text("phone_number_id"),
    businessAccountId: text("business_account_id"),
    displayPhoneNumber: text("display_phone_number"),
    displayName: text("display_name"),
    // "sandbox" | "dedicated" — sandbox numbers can't submit Meta templates
    kind: text("kind"),
    webhookRegisteredAt: timestamp("webhook_registered_at", {
      withTimezone: true,
    }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("kapso_connection_operation_idx").on(t.operationId)],
);

// ────────────────────────────────────────────────────────────────────────────
// webhook events (idempotency ledger for inbound webhooks)
// ────────────────────────────────────────────────────────────────────────────

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    eventId: text("event_id").notNull(),
    event: text("event"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("webhook_events_source_event_idx").on(t.source, t.eventId)],
);

// ────────────────────────────────────────────────────────────────────────────
// wa templates (Meta-approved WhatsApp templates, per current WABA)
// ────────────────────────────────────────────────────────────────────────────

export const waTemplates = pgTable(
  "wa_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /**
     * La operación dueña del catálogo. Migración `0024`.
     *
     * **Obligatoria**, y por la regla de la `0021`: quien escribe aquí es el
     * aprovisionamiento de Meta (`kapso/provisioning.ts`), que somete el
     * catálogo contra la WABA **de una operación concreta** y por tanto la sabe
     * siempre. No hay ningún camino que escriba una plantilla sin saber de
     * quién es.
     *
     * Redundante con `business_account_id` mientras haya una WABA por
     * operación, y a propósito: el panel filtra por operación —es lo único que
     * tiene en la mano— y sin la columna tendría que ir a buscar la conexión
     * para traducir. `listApprovedWaTemplates` es la consulta que la usa.
     */
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    language: text("language").notNull().default("es"),
    category: text("category").notNull().default("UTILITY"),
    // canonical BODY text with {{n}} placeholders, mirrors what Meta approved
    bodyText: text("body_text").notNull(),
    buttons: jsonb("buttons").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    businessAccountId: text("business_account_id"),
    metaTemplateId: text("meta_template_id"),
    status: waTemplateStatus("status").notNull().default("draft"),
    statusReason: text("status_reason"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // El único sigue siendo (nombre, WABA) y no (nombre, operación): Meta
    // aprueba por WABA, así que es la WABA la que define qué nombre puede
    // repetirse. Cambiarlo obligaría a tocar los cuatro `onConflictDoUpdate`
    // del aprovisionamiento sin comprar nada.
    uniqueIndex("wa_templates_name_waba_idx").on(t.name, t.businessAccountId),
    index("wa_templates_operation_idx").on(t.operationId, t.status),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// contacts & conversations
// ────────────────────────────────────────────────────────────────────────────

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Canonical WhatsApp address: E.164 digits (Cloud API wa_id), no "+".
    waId: text("wa_id"),
    // Legacy Baileys identifiers — kept for historical rows, no longer written.
    jid: text("jid").notNull(),
    lid: text("lid"),
    pnJid: text("pn_jid"),
    phone: text("phone"),
    name: text("name"),
    pushName: text("push_name"),
    agentMode: boolean("agent_mode").notNull().default(false),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Único TOTAL (no parcial): ON CONFLICT (wa_id) necesita inferir este
    // índice como árbitro y Postgres no infiere índices parciales (42P10).
    // Los NULL no chocan entre sí, así que los contactos legacy sin wa_id caben.
    uniqueIndex("contacts_wa_id_idx").on(t.waId),
    index("contacts_jid_idx").on(t.jid),
    uniqueIndex("contacts_lid_idx")
      .on(t.lid)
      .where(sql`${t.lid} is not null`),
    uniqueIndex("contacts_pn_jid_idx")
      .on(t.pnJid)
      .where(sql`${t.pnJid} is not null`),
    index("contacts_phone_idx").on(t.phone),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    /**
     * La operación de la conversación, resuelta en la ingesta por el número que
     * recibió el mensaje y conservada de principio a fin.
     *
     * **Sigue nullable después del contract, a propósito.** Quien la escribe
     * —el pipeline de entrada y el webhook de la tienda— puede legítimamente no
     * saberla: un mensaje que entra por un número que no reconocemos, o un
     * pedido web cuando exista una segunda tienda que distinguir (ticket 08).
     * Volverla obligatoria convertiría «no sé de qué operación es» en «pierdo
     * el mensaje» o «pierdo el pedido», que es justo lo contrario de lo que el
     * lote 02 decidió al no darle al pipeline ninguna forma de descartar.
     *
     * `restrict` y no `cascade`: dar de baja una operación no puede llevarse por
     * delante el historial de conversaciones.
     */
    operationId: uuid("operation_id").references(() => operations.id, {
      onDelete: "restrict",
    }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    lastMessagePreview: text("last_message_preview"),
    unreadCount: integer("unread_count").notNull().default(0),
    confirmationStatus: confirmationStatus("confirmation_status")
      .notNull()
      .default("unknown"),
    confirmationSource: confirmationSource("confirmation_source"),
    confirmationUpdatedAt: timestamp("confirmation_updated_at", {
      withTimezone: true,
    }),

    // ── Atribución del anuncio (CTWA) · expand `0022` ──────────────────────
    //
    // La referencia del anuncio llega **solo en el primer mensaje** de la
    // conversación, nunca en respuestas de botón o lista. Se persiste aquí, en
    // la conversación y no en el mensaje, y el resto del sistema la lee de
    // aquí. Como hay una conversación por contacto para siempre (índice único
    // sobre `contact_id`), un clic nuevo **sobrescribe** la anterior: es lo
    // que quiere el ruteo —«atribución más reciente que el último pedido» va
    // a ventas—, y por eso `ad_referral_at` es columna y no se infiere del
    // mensaje. Todo nullable: 1.692 filas existentes no tienen anuncio.
    //
    // No existe endpoint de Meta para recuperar la referencia después del
    // hecho: lo que no se guarde aquí se pierde. Por eso además de las columnas
    // tipadas va el objeto crudo — el serializador del proveedor ya recortó
    // campos que Meta sí manda, y la ruta exacta del `referral` en su payload
    // no está documentada.

    /** `referral.source_id`: el identificador del anuncio. Clave del mapeo `product_ads`. */
    adId: text("ad_id"),
    /** `referral.headline`: titular del anuncio. */
    adHeadline: text("ad_headline"),
    /** `referral.body`: cuerpo del anuncio. */
    adBody: text("ad_body"),
    /** `referral.source_url`: URL de origen del anuncio. */
    adSourceUrl: text("ad_source_url"),
    /**
     * `referral.ctwa_clid`: el identificador de clic. Distinto del de anuncio:
     * el de anuncio reconoce el producto; este es lo que después permite
     * reportarle la venta a Meta (CAPI). Va con el nombre exacto de Meta porque
     * así se llama el parámetro que CAPI recibe.
     */
    ctwaClid: text("ctwa_clid"),
    /** Cuándo llegó la referencia (timestamp del mensaje que la trajo). */
    adReferralAt: timestamp("ad_referral_at", { withTimezone: true }),
    /** El objeto `referral` completo, tal cual llegó. Seguro contra recortes. */
    adReferralRaw: jsonb("ad_referral_raw"),

    /**
     * El producto que el reconocimiento resolvió para esta conversación —por
     * id de anuncio, por match semántico o preguntando—, para que una respuesta
     * de botón, que no trae referencia, siga sabiendo de qué producto se habla.
     * `null` mientras no esté identificado. `set null` al borrar el producto:
     * la conversación sobrevive al catálogo.
     */
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),

    // ── Asignación · expand `0022` ─────────────────────────────────────────
    //
    // Lo único que se **guarda** del ruteo: quién está trabajando la
    // conversación, porque eso el sistema no lo puede deducir. A qué bandeja
    // pertenece se deriva y no tiene columna. Soltar es poner las dos en null.

    /** El asesor que la está trabajando. `set null`: borrar el usuario la libera. */
    assignedUserId: uuid("assigned_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("conversations_contact_idx").on(t.contactId),
    index("conversations_last_msg_idx").on(t.lastInboundAt, t.lastOutboundAt),
    index("conversations_confirmation_idx").on(t.confirmationStatus),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: messageDirection("direction").notNull(),
    waId: text("wa_id"),
    body: text("body").notNull().default(""),
    mediaUrl: text("media_url"),
    mediaMime: text("media_mime"),
    status: messageStatus("status").notNull().default("pending"),
    /** Motivo legible cuando status = failed (lo que el asesor ve en el hilo). */
    deliveryError: text("delivery_error"),
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    fromAgent: boolean("from_agent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    uniqueIndex("messages_wa_id_idx").on(t.waId),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// message media (notas de voz y audios entrantes)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Los bytes del audio viven aquí porque ninguna de las dos URLs de WhatsApp
 * sirve para reproducir en el hilo: la de Meta caduca en 5 minutos y exige
 * token, y la de Kapso solo existe para lo que ENTRA. Una nota de voz de 2
 * minutos en opus pesa ~150 KB, así que la tabla crece ~1 MB/día al ritmo
 * actual — si eso deja de ser aceptable, esto es lo que se muda a S3/R2.
 */
export const messageMedia = pgTable("message_media", {
  id: uuid("id").defaultRandom().primaryKey(),
  mime: text("mime").notNull(),
  bytes: bytea("bytes").notNull(),
  byteSize: integer("byte_size").notNull(),
  durationMs: integer("duration_ms"),
  /** "outbound" (grabada por el asesor) | "inbound" (la mandó el cliente). */
  source: text("source").notNull(),
  /** Id de media en Meta, para no re-subir el archivo si el envío se reintenta. */
  metaMediaId: text("meta_media_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// templates
// ────────────────────────────────────────────────────────────────────────────

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /**
     * La operación dueña de la plantilla. Migración `0024`.
     *
     * **Obligatoria**: las tres escrituras que existen —la pantalla de
     * Plantillas, el seed de logística y el seed inicial— saben la operación
     * antes de escribir. Es la misma regla que la `0021` aplicó a las cuatro
     * tablas de configuración, y estas plantillas son configuración: de aquí
     * cuelgan las seis FK de `agent_settings`, que ya es una fila por
     * operación.
     *
     * **El ticket 10 daba por hecho que esta columna ya existía** (decía
     * «`templates` ya tiene `operation_id`, solo agregás el `where`»). No
     * existía: medido contra producción el 18-ago-2026, `templates` tenía nueve
     * filas y ninguna columna de operación. Sin ella `listTemplates` no se
     * puede filtrar y las dos operaciones comparten las nueve plantillas —
     * incluidas las de logística, que llevan el texto que le sale al cliente.
     */
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    body: text("body").notNull(),
    variables: jsonb("variables").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    type: templateType("type").notNull().default("general"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // El único pasa de `name` a `(operación, name)`: mismo movimiento que la
  // `0021` le hizo a `dropi_orders`. Con el único sobre el nombre a secas, la
  // operación colombiana no puede tener su propia `dropi_guia_generada` — el
  // insert choca contra la guatemalteca y se queda sin plantilla.
  (t) => [uniqueIndex("templates_operation_name_idx").on(t.operationId, t.name)],
);

// ────────────────────────────────────────────────────────────────────────────
// agent settings (una por operación; `id` entero heredado del singleton)
// ────────────────────────────────────────────────────────────────────────────

export const agentSettings = pgTable(
  "agent_settings",
  {
    id: integer("id").primaryKey().default(1),
    /**
     * Obligatoria desde el contract (`0021`), y única: una configuración por
     * operación. El único es lo que hace determinista la resolución — con dos
     * filas de la misma operación, cuál gana era arbitrario.
     */
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "restrict" }),
    systemPrompt: text("system_prompt").notNull().default(""),
    model: text("model").notNull().default("anthropic/claude-sonnet-4.6"),
    debounceMs: integer("debounce_ms").notNull().default(8000),
    followupDelayMs: integer("followup_delay_ms").notNull().default(300_000),
    followupTemplateId: uuid("followup_template_id").references(
      () => templates.id,
      { onDelete: "set null" },
    ),
    remarketingDelayMs: integer("remarketing_delay_ms")
      .notNull()
      .default(3 * 60 * 60 * 1000),
    remarketingTemplateId: uuid("remarketing_template_id").references(
      () => templates.id,
      { onDelete: "set null" },
    ),
    confirmationAckTemplateId: uuid("confirmation_ack_template_id").references(
      () => templates.id,
      { onDelete: "set null" },
    ),
    activateAgentOnConfirm: boolean("activate_agent_on_confirm")
      .notNull()
      .default(true),
    memoryWindow: integer("memory_window").notNull().default(30),
    dropiEnabled: boolean("dropi_enabled").notNull().default(false),
    dropiDryRun: boolean("dropi_dry_run").notNull().default(true),
    dropiPollIntervalMin: integer("dropi_poll_interval_min").notNull().default(10),
    dropiSyncIntervalMin: integer("dropi_sync_interval_min").notNull().default(15),
    dropiMatchWindowDays: integer("dropi_match_window_days").notNull().default(5),
    dropiTemplateGuiaId: uuid("dropi_template_guia_id").references(
      () => templates.id,
      { onDelete: "set null" },
    ),
    dropiTemplateRecolectadoId: uuid("dropi_template_recolectado_id").references(
      () => templates.id,
      { onDelete: "set null" },
    ),
    dropiTemplateEnTransitoId: uuid("dropi_template_en_transito_id").references(
      () => templates.id,
      { onDelete: "set null" },
    ),
    dropiTemplateConMensajeroId: uuid(
      "dropi_template_con_mensajero_id",
    ).references(() => templates.id, { onDelete: "set null" }),
    dropiTemplateEntregadoId: uuid("dropi_template_entregado_id").references(
      () => templates.id,
      { onDelete: "set null" },
    ),
    dropiTemplateEnOficinaId: uuid("dropi_template_en_oficina_id").references(
      () => templates.id,
      { onDelete: "set null" },
    ),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("agent_settings_operation_idx").on(t.operationId)],
);

// ────────────────────────────────────────────────────────────────────────────
// agent prompt versions — historial append-only del system prompt
// ────────────────────────────────────────────────────────────────────────────

export const agentPromptVersions = pgTable(
  "agent_prompt_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    prompt: text("prompt").notNull(),
    /** Nota corta del cambio, escrita por quien guarda. */
    label: text("label"),
    /** Email del usuario del dashboard que guardó (null si vino del sistema). */
    authorEmail: text("author_email"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("agent_prompt_versions_created_idx").on(t.createdAt)],
);

// ────────────────────────────────────────────────────────────────────────────
// sales agent settings — la configuración del vendedor (una por operación)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Tabla hermana de `agent_settings`, **no** una generalización. `agent_settings`
 * tiene 65 referencias y la mayoría son campos de Katherine —plantillas de
 * logística, demoras de seguimiento, acuse de confirmación—: es la
 * configuración de la confirmación con nombre genérico. Generalizarla habría
 * obligado a un expand–contract sobre esos call sites para que el vendedor use
 * una fracción de las columnas. Esta tabla tiene solo lo que el vendedor usa y
 * su radio de impacto sobre lo existente es cero.
 *
 * Una fila por operación (índice único), `id` uuid como en `operations` — no
 * hereda el entero `default 1` del singleton porque nunca fue singleton.
 *
 * Los textos son `NOT NULL default ''` como `agent_settings.system_prompt`: la
 * fila puede existir con solo la operación y el panel la va llenando. El
 * límite de descuento arranca en **cero**, que prohíbe descuentos: es el valor
 * seguro, y la validación (en el constructor de orden) corre siempre. El
 * modelo es de gama media y el esfuerzo de razonamiento bajo, y son campos, no
 * constantes: subirlo es cambiar un valor.
 */
export const salesAgentSettings = pgTable(
  "sales_agent_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "restrict" }),
    /** Nombre visible del vendedor: «Sebastián». */
    displayName: text("display_name").notNull().default(""),
    /** Mensajes base — los momentos que el admin controla palabra por palabra. */
    greeting: text("greeting").notNull().default(""),
    closingPush: text("closing_push").notNull().default(""),
    funnelMessage: text("funnel_message").notNull().default(""),
    /** Texto libre: personalidad y tono. */
    toneInstructions: text("tone_instructions").notNull().default(""),
    /**
     * Hasta qué porcentaje puede bajar el vendedor. Se aplica en código al
     * construir la orden; el prompt propone, la validación decide. `0` prohíbe.
     */
    discountLimitPct: integer("discount_limit_pct").notNull().default(0),
    /**
     * Qué hace el vendedor **cuando el cliente pide más de lo autorizado**.
     * Migración `0025`.
     *
     * El nivel 2 del árbol de diseño destapó que el ticket definía el límite y
     * nunca decía su consecuencia — «un límite sin consecuencia declarada no
     * está definido: está numerado». Con el límite en `0` la pregunta se
     * reformula sola a «cuando el cliente insista con un descuento», porque el
     * borde existe igual: prohibir descuentos no evita que se los pidan.
     *
     * Tres valores cerrados con el usuario, y el default es `consultar`
     * —escalar a una persona— **por lo que pasa con una fila a medio llenar**.
     * La tabla la llena el panel de a poco, así que el default tiene que ser
     * seguro sin que nadie lo elija: escalar es el único de los tres cuyo
     * error lo ve un humano. `ofrecer_maximo` gasta margen solo y convierte el
     * techo en piso —el que pida, recibe—; `no_mencionar` cierra la puerta en
     * silencio y nadie se entera de que se perdió la venta. Escalar de más
     * cuesta atención, que se nota y se corrige; los otros dos no se notan.
     *
     * `text` y no `pgEnum`, como `reasoning_effort`: agregar una cuarta
     * consecuencia es cambiar el `check`, y no un `ALTER TYPE ... ADD VALUE`
     * que Postgres no deja usar en la misma transacción que lo agrega —la
     * trampa que la `0022` ya dejó anotada arriba.
     */
    discountLimitBehavior: text("discount_limit_behavior")
      .notNull()
      .default("consultar"),
    /** Slug de OpenRouter, como `agent_settings.model`. */
    model: text("model").notNull().default("openai/gpt-5.4-mini"),
    /** `low` | `medium` | `high` — vocabulario del proveedor, por eso texto y no enum. */
    reasoningEffort: text("reasoning_effort").notNull().default("low"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sales_agent_settings_operation_idx").on(t.operationId),
    check(
      "sales_agent_settings_discount_limit_check",
      sql`${t.discountLimitPct} between 0 and 100`,
    ),
    // El vocabulario del borde es del panel, no de un proveedor: la base es
    // el único lugar donde una cuarta consecuencia inventada por otra vía no
    // puede entrar en silencio y salir después en el prompt del vendedor.
    check(
      "sales_agent_settings_discount_behavior_check",
      sql`${t.discountLimitBehavior} in ('consultar', 'ofrecer_maximo', 'no_mencionar')`,
    ),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// products — el catálogo de ventas (por operación)
// ────────────────────────────────────────────────────────────────────────────

/**
 * El mínimo de catálogo que el reconocimiento necesita para existir. **Por
 * operación**: un producto guatemalteco no aparece en el catálogo colombiano,
 * y la cascada de reconocimiento solo consulta los de la operación del lead.
 *
 * Dos orígenes, declarados en `source`:
 *   · `shopify` — conectado a la tienda. Guarda **solo** el id de Shopify y lee
 *     nombre, descripción y precio de la tienda en tiempo de uso
 *     (`getProductsByIds`), no los copia: editarlo allá se refleja acá sin
 *     desincronización silenciosa. Por eso `name` es nullable.
 *   · `native` — creado en el panel porque aún no existe en la tienda. Lleva su
 *     nombre y descripción aquí.
 * El `CHECK` hace cumplir que cada origen traiga lo suyo.
 *
 * Los productos quedan uno a uno con los de la tienda (único parcial sobre
 * `(operation_id, shopify_product_id)`); no hay concepto de familia ni de
 * agrupación — eso lo expresa el mapeo `product_ads`.
 *
 * Deliberadamente fuera de la `0022`: assets enviables (imágenes, videos), que
 * necesitan decidir dónde viven los binarios; precio de producto nativo; y
 * archivado. Los piden tickets de olas posteriores.
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "restrict" }),
    source: productSource("source").notNull(),
    /**
     * GID de Shopify (`gid://shopify/Product/NNN`), como lo devuelve
     * `ShopifyProduct.id`; `getProductsByIds` acepta también el numérico.
     * Obligatorio si `source = 'shopify'`, nulo si `native`.
     */
    shopifyProductId: text("shopify_product_id"),
    /** Obligatorio si `source = 'native'`; nulo para los conectados (se lee de la tienda). */
    name: text("name"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Uno a uno con la tienda: el mismo producto de Shopify no se conecta dos
    // veces en la misma operación. Parcial: los nativos no tienen id de tienda.
    uniqueIndex("products_operation_shopify_idx")
      .on(t.operationId, t.shopifyProductId)
      .where(sql`${t.shopifyProductId} is not null`),
    // Único sobre (operación, id): es el destino de la clave foránea compuesta
    // de `product_ads`, y de paso sirve para listar el catálogo por operación.
    // Restricción y no índice a propósito: drizzle-kit la emite dentro del
    // `CREATE TABLE`, antes de las FKs; como índice suelto salía después de la
    // FK que la necesita y Postgres rechazaba la migración (42830).
    unique("products_operation_id_unique").on(t.operationId, t.id),
    check(
      "products_source_check",
      sql`(${t.source} = 'native' and ${t.name} is not null and ${t.shopifyProductId} is null) or (${t.source} = 'shopify' and ${t.shopifyProductId} is not null)`,
    ),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// product ads — mapeo anuncio→productos, N:M en ambos sentidos
// ────────────────────────────────────────────────────────────────────────────

/**
 * Un anuncio puede apuntar a varios productos (anuncios de familia o de combo,
 * sin inventar productos falsos) y un producto puede tener varios anuncios.
 * El anuncio no tiene entidad propia: es su identificador de Meta
 * (`referral.source_id`), que el admin pega en el panel. Nivel 1 de la
 * cascada de reconocimiento: `ad_id` → productos de **esta** operación.
 *
 * `operation_id` está aquí y no solo en `products` para que el aislamiento sea
 * una consulta directa (`where operation_id = ? and ad_id = ?`) y no una regla
 * de código; la clave foránea compuesta `(operation_id, product_id)` →
 * `products (operation_id, id)` garantiza que no puede mentir: un mapeo no
 * puede apuntar a un producto de otra operación. `cascade`: borrar el producto
 * se lleva sus mapeos.
 */
export const productAds = pgTable(
  "product_ads",
  {
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "restrict" }),
    productId: uuid("product_id").notNull(),
    /** Identificador del anuncio de Meta, tal como llega en `referral.source_id`. */
    adId: text("ad_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.adId] }),
    index("product_ads_operation_ad_idx").on(t.operationId, t.adId),
    foreignKey({
      name: "product_ads_product_operation_fk",
      columns: [t.operationId, t.productId],
      foreignColumns: [products.operationId, products.id],
    }).onDelete("cascade"),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// product media — los archivos que el vendedor puede mandar
// ────────────────────────────────────────────────────────────────────────────

/**
 * Las fotos, videos y documentos que cuelgan de un producto, **con su
 * interruptor de enviable por archivo**.
 *
 * **Los bytes viven en Postgres, como `message_media`.** Lo decidió el usuario
 * el 18-ago-2026 y la razón es el volumen real, no la comodidad: WhatsApp corta
 * en 16 MB, el catálogo de Guatemala son 17 productos y el de mañana decenas, y
 * son unos pocos archivos por producto. Eso son cientos de MB, no terabytes.
 * Estrenar object storage metía un proveedor, una cuenta y una credencial
 * nuevos en el camino crítico de un módulo que todavía no factura, y hoy no hay
 * ninguna credencial de storage en el entorno.
 *
 * **Deuda anotada, con disparador**: si el catálogo de las dos operaciones pasa
 * de unos pocos GB, esto se muda a S3/R2 y la columna `bytes` se cambia por una
 * llave de objeto. Es una migración acotada —una tabla, una columna— y no
 * arrastra al resto del esquema porque nadie más lee estos bytes. Medida de
 * referencia, misma fecha: `message_media` son 46 filas y 1,26 MB en total,
 * con la mayor en 122 KB.
 *
 * **La operación no se hereda del producto.** Va la columna y la clave foránea
 * compuesta `(operation_id, product_id)` → `products (operation_id, id)`, igual
 * que `product_ads` y por lo mismo: que un archivo no pueda colgar de un
 * producto de otra operación lo impide la base, no el cuidado del código. Acá
 * el daño concreto es que el vendedor guatemalteco le mande al cliente la ficha
 * del producto colombiano. `cascade`: borrar el producto se lleva sus archivos.
 *
 * **El tamaño se guarda, y no es adorno.** El rechazo por exceder el límite de
 * la API de WhatsApp se hace **al subir y no al enviar**, que es el criterio
 * del ticket 02 —«para que el problema aparezca cuando el admin puede
 * resolverlo»—; y el camino de lectura vuelve a filtrar por tamaño antes de
 * ofrecer un archivo para enviar, porque el límite es de WhatsApp y puede
 * cambiar sin avisarle a esta tabla.
 */
export const productMedia = pgTable(
  "product_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "restrict" }),
    productId: uuid("product_id").notNull(),
    /** El nombre con el que el admin lo subió: `testimonio.mp4`. Es lo que la ficha muestra. */
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    bytes: bytea("bytes").notNull(),
    byteSize: integer("byte_size").notNull(),
    /**
     * El interruptor del ticket 03. **Arranca apagado**, que es el estado
     * seguro: un archivo recién subido todavía no lo revisó nadie, y el error
     * de mandarle al cliente la hoja de márgenes internos no se deshace. Que
     * enviarlo sea un acto explícito es la mitad del criterio «los archivos no
     * marcados nunca se envían, aunque estén cargados».
     */
    sendable: boolean("sendable").notNull().default(false),
    /** Id de media en Meta, para no re-subir el mismo archivo en cada envío. Igual que `message_media`. */
    metaMediaId: text("meta_media_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Por operación y producto, que es como lo pide la ficha y como lo va a
    // pedir el envío. El orden por creación es el que la pantalla muestra.
    index("product_media_product_idx").on(
      t.operationId,
      t.productId,
      t.createdAt,
    ),
    foreignKey({
      name: "product_media_product_operation_fk",
      columns: [t.operationId, t.productId],
      foreignColumns: [products.operationId, products.id],
    }).onDelete("cascade"),
    // Un archivo de cero bytes es una subida que se cortó, no un archivo. Se
    // rechaza acá porque más adelante se vería como un envío vacío al cliente.
    check("product_media_byte_size_check", sql`${t.byteSize} > 0`),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// shopify connection (una por operación; `id` entero heredado del singleton)
// ────────────────────────────────────────────────────────────────────────────

export const shopifyConnection = pgTable(
  "shopify_connection",
  {
    id: integer("id").primaryKey().default(1),
    /** Obligatoria desde el contract (`0021`). La tabla está vacía hoy. */
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "restrict" }),
    shopDomain: text("shop_domain"),
    adminAccessToken: text("admin_access_token"),
    apiVersion: text("api_version").notNull().default("2025-01"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("shopify_connection_operation_idx").on(t.operationId)],
);

// ────────────────────────────────────────────────────────────────────────────
// shopify orders
// ────────────────────────────────────────────────────────────────────────────

export const shopifyOrders = pgTable(
  "shopify_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: text("order_id").notNull(),
    /**
     * La operación a la que se le atribuye el pedido. Migración `0024`.
     *
     * **Nullable, y por la misma regla que `conversations`**: la columna se
     * pone donde hace falta filtrar, `NOT NULL` solo donde quien escribe
     * *siempre* sabe la operación. El webhook de la tienda se autentica con un
     * secreto de entorno global y la carga útil no trae identidad de tienda:
     * con dos tiendas y hasta el ticket 08 puede legítimamente no saberla.
     * Volverla obligatoria convertiría «no sé de qué operación es» en «pierdo
     * el pedido», sobre el camino por el que entran los 1.712 que facturan.
     *
     * La `0021` argumentó que esta columna no hacía falta *para escribir* —el
     * único de `dropi_orders` sí la necesitaba— y tenía razón. Hace falta para
     * **leer**: la pantalla de Pedidos lee `shopify_orders` de frente y sin
     * ella no hay forma de que no mezcle dos países.
     *
     * `restrict` y no `cascade`: dar de baja una operación no puede llevarse
     * por delante el historial de pedidos.
     */
    operationId: uuid("operation_id").references(() => operations.id, {
      onDelete: "restrict",
    }),
    customerPhone: text("customer_phone").notNull(),
    customerName: text("customer_name"),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    totalPrice: text("total_price"),
    currency: text("currency"),
    rawPayload: jsonb("raw_payload"),
    status: orderStatus("status").notNull().default("received"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    followupScheduledFor: timestamp("followup_scheduled_for", {
      withTimezone: true,
    }),
    followupJobId: text("followup_job_id"),
    followupSentAt: timestamp("followup_sent_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    remarketingScheduledFor: timestamp("remarketing_scheduled_for", {
      withTimezone: true,
    }),
    remarketingJobId: text("remarketing_job_id"),
    remarketingSentAt: timestamp("remarketing_sent_at", {
      withTimezone: true,
    }),
  },
  (t) => [
    uniqueIndex("shopify_orders_order_id_idx").on(t.orderId),
    index("shopify_orders_phone_idx").on(t.customerPhone),
    index("shopify_orders_status_idx").on(t.status),
    // La pantalla de Pedidos filtra por operación y ordena por fecha: el índice
    // compuesto es el que sirve esa consulta sin recorrer las 1.712 filas.
    index("shopify_orders_operation_idx").on(t.operationId, t.receivedAt),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// dropi connection (una por operación; `id` entero heredado del singleton) + orders mapping
// ────────────────────────────────────────────────────────────────────────────

export const dropiConnection = pgTable(
  "dropi_connection",
  {
    id: integer("id").primaryKey().default(1),
    /**
     * Obligatoria desde el contract (`0021`), y única: la logística de una
     * operación es una sola cuenta de Dropi.
     */
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "restrict" }),
    apiBaseUrl: text("api_base_url")
      .notNull()
      .default("https://api.dropi.gt/api"),
    email: text("email"),
    password: text("password"),
    userId: integer("user_id"),
    bearerToken: text("bearer_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    assetsBaseUrl: text("assets_base_url")
      .notNull()
      .default("https://d2ob47cxeawi8a.cloudfront.net"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAutoLoginAt: timestamp("last_auto_login_at", { withTimezone: true }),
    lastAutoLoginError: text("last_auto_login_error"),
    adminPhone: text("admin_phone"),
    pending2faToken: text("pending_2fa_token"),
    pending2faExpiresAt: timestamp("pending_2fa_expires_at", {
      withTimezone: true,
    }),
    pending2faRequestedAt: timestamp("pending_2fa_requested_at", {
      withTimezone: true,
    }),
  },
  (t) => [uniqueIndex("dropi_connection_operation_idx").on(t.operationId)],
);

export const dropiOrders = pgTable(
  "dropi_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /**
     * La operación cuya cuenta de Dropi trajo este pedido.
     *
     * Obligatoria desde el contract (`0021`), y no nullable como en
     * `conversations`: aquí el que escribe **siempre** sabe la operación —el
     * sondeo y la sincronización le preguntaron a la cuenta Dropi *de esa
     * operación*—, así que «no la sé» no es un estado alcanzable.
     *
     * Sin ella, el id de pedido de Dropi —único dentro de una cuenta, no entre
     * cuentas— hacía que dos operaciones con el pedido 942698 fueran la misma
     * fila: el sondeo de una pisaba el pedido de la otra, y el único de abajo
     * directamente impedía guardar el segundo.
     */
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "restrict" }),
    dropiOrderId: integer("dropi_order_id").notNull(),
    shopifyOrderRowId: uuid("shopify_order_row_id").references(
      () => shopifyOrders.id,
      { onDelete: "set null" },
    ),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    customerPhone: text("customer_phone"),
    customerName: text("customer_name"),
    guideNumber: text("guide_number"),
    guidePdfPath: text("guide_pdf_path"),
    guidePdfFile: text("guide_pdf_file"),
    carrier: text("carrier"),
    status: dropiStatus("status").notNull().default("unknown"),
    rawStatus: text("raw_status"),
    /**
     * Último movimiento reportado por la transportadora, tal cual lo da Dropi
     * (`servientrega_movements[].nom_mov`). Es la situación logística real —
     * más fina que el status del pedido — y por eso se materializa en columna:
     * los filtros de Pedidos no pueden desempaquetar 1 259 arrays JSON.
     */
    lastMovementRaw: text("last_movement_raw"),
    lastMovementAt: timestamp("last_movement_at", { withTimezone: true }),
    rawPayload: jsonb("raw_payload"),
    matchConfidence: dropiMatchConfidence("match_confidence"),
    confirmPutAt: timestamp("confirm_put_at", { withTimezone: true }),
    confirmDryRunAt: timestamp("confirm_dry_run_at", { withTimezone: true }),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastNotifiedStatus: dropiStatus("last_notified_status"),
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
    novedadReasonRaw: text("novedad_reason_raw"),
    novedadFirstNotifiedAt: timestamp("novedad_first_notified_at", {
      withTimezone: true,
    }),
    novedadReminderAt: timestamp("novedad_reminder_at", { withTimezone: true }),
    novedadEscalatedAt: timestamp("novedad_escalated_at", {
      withTimezone: true,
    }),
    novedadCustomerRepliedAt: timestamp("novedad_customer_replied_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // El id de Dropi es único **dentro** de una cuenta. El único de antes era
    // sobre `dropi_order_id` a secas, y con dos operaciones habría rechazado el
    // pedido legítimo de la segunda por chocar con el número de la primera.
    uniqueIndex("dropi_orders_operation_id_idx").on(t.operationId, t.dropiOrderId),
    index("dropi_orders_phone_idx").on(t.customerPhone),
    index("dropi_orders_status_idx").on(t.status),
    index("dropi_orders_shopify_idx").on(t.shopifyOrderRowId),
    index("dropi_orders_contact_idx").on(t.contactId),
    index("dropi_orders_novedad_first_notified_idx").on(
      t.novedadFirstNotifiedAt,
    ),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// outbound messages (outbox)
// ────────────────────────────────────────────────────────────────────────────

export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Destination wa_id (E.164 digits). Pre-migration rows may hold Baileys JIDs.
    toWaId: text("to_wa_id").notNull(),
    body: text("body").notNull(),
    source: outboundSource("source").notNull(),
    sourceRef: text("source_ref"),
    // Meta template send: when set, handleOutbound sends this template instead
    // of free text; `body` holds the locally rendered text for the chat history.
    templateName: text("template_name"),
    templateParams: jsonb("template_params").$type<string[]>(),
    // Fallback when a free-text send is rejected for the closed 24h window.
    fallbackTemplateName: text("fallback_template_name"),
    fallbackTemplateParams: jsonb("fallback_template_params").$type<string[]>(),
    /**
     * Nota de voz: el audio va por el outbox como cualquier otro envío para
     * heredar reintentos, dedup y estados de entrega. `body` guarda el texto
     * que se ve en el historial.
     */
    mediaId: uuid("media_id").references(() => messageMedia.id, {
      onDelete: "set null",
    }),
    mediaKind: text("media_kind"),
    dedupKey: text("dedup_key").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: outboundStatus("status").notNull().default("pending"),
    waId: text("wa_id"),
    /**
     * Último estado de entrega que Meta reportó por webhook, crudo. Existe
     * porque el webhook de `delivered` suele llegar ANTES de que espejemos el
     * mensaje en `messages` (medido: 98,6 % de los casos), y sin esto el chulo
     * se congelaba en "enviado" para siempre. `status: acked` no sirve: colapsa
     * delivered y read en un solo valor.
     */
    deliveryStatus: messageStatus("delivery_status"),
    /** Motivo legible del fallo de entrega, para copiarlo al hilo. */
    deliveryError: text("delivery_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lastErrorKind: outboundErrorKind("last_error_kind"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("outbound_messages_dedup_idx").on(t.dedupKey),
    uniqueIndex("outbound_messages_wa_id_idx").on(t.waId),
    index("outbound_messages_status_sched_idx").on(t.status, t.scheduledFor),
    index("outbound_messages_to_idx").on(t.toWaId, t.createdAt),
    index("outbound_messages_source_idx").on(t.source, t.sourceRef),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// agent runs (audit)
// ────────────────────────────────────────────────────────────────────────────

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    prompt: jsonb("prompt").notNull(),
    response: text("response").notNull(),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    costUsd: text("cost_usd"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("agent_runs_conversation_idx").on(t.conversationId, t.createdAt)],
);

// ────────────────────────────────────────────────────────────────────────────
// types
// ────────────────────────────────────────────────────────────────────────────

export type Operation = typeof operations.$inferSelect;
export type NewOperation = typeof operations.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageMedia = typeof messageMedia.$inferSelect;
export type NewMessageMedia = typeof messageMedia.$inferInsert;
export type Template = typeof templates.$inferSelect;
export type AgentSettings = typeof agentSettings.$inferSelect;
export type AgentPromptVersion = typeof agentPromptVersions.$inferSelect;
export type NewAgentPromptVersion = typeof agentPromptVersions.$inferInsert;
export type SalesAgentSettings = typeof salesAgentSettings.$inferSelect;
export type NewSalesAgentSettings = typeof salesAgentSettings.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductAd = typeof productAds.$inferSelect;
export type NewProductAd = typeof productAds.$inferInsert;
export type ProductMedia = typeof productMedia.$inferSelect;
export type NewProductMedia = typeof productMedia.$inferInsert;
export type ShopifyOrder = typeof shopifyOrders.$inferSelect;
export type NewShopifyOrder = typeof shopifyOrders.$inferInsert;
export type WaSession = typeof waSession.$inferSelect;
export type OutboundMessage = typeof outboundMessages.$inferSelect;
export type NewOutboundMessage = typeof outboundMessages.$inferInsert;
export type ShopifyConnection = typeof shopifyConnection.$inferSelect;
export type NewShopifyConnection = typeof shopifyConnection.$inferInsert;
export type DropiConnection = typeof dropiConnection.$inferSelect;
export type NewDropiConnection = typeof dropiConnection.$inferInsert;
export type DropiOrder = typeof dropiOrders.$inferSelect;
export type NewDropiOrder = typeof dropiOrders.$inferInsert;
export type KapsoConnection = typeof kapsoConnection.$inferSelect;
export type NewKapsoConnection = typeof kapsoConnection.$inferInsert;
export type WaTemplate = typeof waTemplates.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
