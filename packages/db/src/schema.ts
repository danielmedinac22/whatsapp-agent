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
// contacts & conversations
// ────────────────────────────────────────────────────────────────────────────

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jid: text("jid").notNull(),
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
    uniqueIndex("contacts_jid_idx").on(t.jid),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("conversations_contact_idx").on(t.contactId),
    index("conversations_last_msg_idx").on(t.lastInboundAt, t.lastOutboundAt),
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
  activateAgentOnConfirm: boolean("activate_agent_on_confirm")
    .notNull()
    .default(true),
  memoryWindow: integer("memory_window").notNull().default(30),
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
