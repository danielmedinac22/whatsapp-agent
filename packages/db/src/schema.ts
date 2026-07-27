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
} from "drizzle-orm/pg-core";

// ────────────────────────────────────────────────────────────────────────────
// enums
// ────────────────────────────────────────────────────────────────────────────

export const userRole = pgEnum("user_role", ["admin", "operator"]);

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
  "entregado",
  "novedad",
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
// kapso connection (singleton row, id=1)
// ────────────────────────────────────────────────────────────────────────────

export const kapsoConnection = pgTable("kapso_connection", {
  id: integer("id").primaryKey().default(1),
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
});

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
  (t) => [uniqueIndex("wa_templates_name_waba_idx").on(t.name, t.businessAccountId)],
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
    uniqueIndex("contacts_wa_id_idx")
      .on(t.waId)
      .where(sql`${t.waId} is not null`),
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
// templates
// ────────────────────────────────────────────────────────────────────────────

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
  (t) => [uniqueIndex("templates_name_idx").on(t.name)],
);

// ────────────────────────────────────────────────────────────────────────────
// agent settings (singleton row, id=1)
// ────────────────────────────────────────────────────────────────────────────

export const agentSettings = pgTable("agent_settings", {
  id: integer("id").primaryKey().default(1),
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
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// shopify connection (singleton row, id=1)
// ────────────────────────────────────────────────────────────────────────────

export const shopifyConnection = pgTable("shopify_connection", {
  id: integer("id").primaryKey().default(1),
  shopDomain: text("shop_domain"),
  adminAccessToken: text("admin_access_token"),
  apiVersion: text("api_version").notNull().default("2025-01"),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// shopify orders
// ────────────────────────────────────────────────────────────────────────────

export const shopifyOrders = pgTable(
  "shopify_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: text("order_id").notNull(),
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
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// dropi connection (singleton row, id=1) + orders mapping
// ────────────────────────────────────────────────────────────────────────────

export const dropiConnection = pgTable("dropi_connection", {
  id: integer("id").primaryKey().default(1),
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
});

export const dropiOrders = pgTable(
  "dropi_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
    uniqueIndex("dropi_orders_id_idx").on(t.dropiOrderId),
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
    dedupKey: text("dedup_key").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: outboundStatus("status").notNull().default("pending"),
    waId: text("wa_id"),
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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Template = typeof templates.$inferSelect;
export type AgentSettings = typeof agentSettings.$inferSelect;
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
