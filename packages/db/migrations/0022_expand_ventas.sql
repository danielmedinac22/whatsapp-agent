-- ────────────────────────────────────────────────────────────────────────────
-- 0022 · Expand de la ola de ventas: catálogo, mapeo de anuncios, vendedor,
--        atribución CTWA, roles y asignación
--
-- Puramente aditiva, como la `0020`. Nada se renombra, se mueve ni se borra;
-- ningún llamador se migra; el comportamiento observable no cambia. Deja
-- puestas de una sola vez todas las tablas y columnas que cinco tickets van a
-- construir encima, porque el número de migración se reparte desde la sesión
-- que coordina y ninguno de ellos puede generar la suya.
--
-- Qué agrega, y para quién:
--   · `user_role` += 'sales', 'operations' — módulos y ruteo 01. Los valores
--     nuevos **no se usan aquí**: Postgres rechaza usar un valor de enum en la
--     misma transacción que lo agrega, y el migrator corre en una. El default
--     de `users.role` sigue siendo 'operator'. Medido antes de aplicar: los 3
--     usuarios de producción son 'admin' — nadie pierde acceso.
--   · `products` (por operación, origen 'shopify' | 'native') y `product_ads`
--     (anuncio→productos, N:M) — ingesta 03. Vacías al nacer, por eso
--     `operation_id NOT NULL` sin backfill. El único `(operation_id, id)` de
--     `products` va como restricción inline y no como índice suelto: es el
--     destino de la FK compuesta de `product_ads`, y como índice drizzle-kit
--     lo emitía después de la FK — Postgres rechazó el primer intento (42830)
--     y la transacción se revirtió entera sin tocar nada.
--   · `sales_agent_settings` — la tabla hermana del vendedor, una por
--     operación — conversación 01. `agent_settings` no se toca.
--   · `conversations` += la referencia CTWA (`ad_id`, `ad_headline`, `ad_body`,
--     `ad_source_url`, `ctwa_clid`, `ad_referral_at`, `ad_referral_raw`) —
--     ingesta 02 y CAPI; += `product_id` (el producto reconocido) — ingesta 04;
--     += `assigned_user_id`, `assigned_at` — módulos y ruteo 04. Todas
--     nullable: hay 1.692 conversaciones y `ADD COLUMN ... NOT NULL` sin
--     default sobre una tabla con filas falla (le pasó a la `0021`).
--
-- Sin `INSERT` ni `UPDATE`: no hay nada que sembrar ni que backfillear. Un
-- worker viejo sigue funcionando contra este esquema.
--
-- Medido contra producción antes de aplicar (lectura pura, 17-ago-2026):
-- conversations 1.692 · contacts 1.692 · shopify_orders 1.685 (100 % GTQ) ·
-- dropi_orders 1.761 · messages 26.275 · users 3 (todos 'admin') ·
-- operations 1 (GT · GTQ · active) · Postgres 18.4.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TYPE "public"."product_source" AS ENUM('shopify', 'native');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'sales';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'operations';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_ads" (
	"operation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"ad_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_ads_product_id_ad_id_pk" PRIMARY KEY("product_id","ad_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"source" "product_source" NOT NULL,
	"shopify_product_id" text,
	"name" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_operation_id_unique" UNIQUE("operation_id","id"),
	CONSTRAINT "products_source_check" CHECK (("products"."source" = 'native' and "products"."name" is not null and "products"."shopify_product_id" is null) or ("products"."source" = 'shopify' and "products"."shopify_product_id" is not null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_agent_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"greeting" text DEFAULT '' NOT NULL,
	"closing_push" text DEFAULT '' NOT NULL,
	"funnel_message" text DEFAULT '' NOT NULL,
	"tone_instructions" text DEFAULT '' NOT NULL,
	"discount_limit_pct" integer DEFAULT 0 NOT NULL,
	"model" text DEFAULT 'openai/gpt-5.4-mini' NOT NULL,
	"reasoning_effort" text DEFAULT 'low' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_agent_settings_discount_limit_check" CHECK ("sales_agent_settings"."discount_limit_pct" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ad_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ad_headline" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ad_body" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ad_source_url" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ctwa_clid" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ad_referral_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ad_referral_raw" jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "assigned_user_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_ads" ADD CONSTRAINT "product_ads_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_ads" ADD CONSTRAINT "product_ads_product_operation_fk" FOREIGN KEY ("operation_id","product_id") REFERENCES "public"."products"("operation_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "products" ADD CONSTRAINT "products_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_agent_settings" ADD CONSTRAINT "sales_agent_settings_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_ads_operation_ad_idx" ON "product_ads" USING btree ("operation_id","ad_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_operation_shopify_idx" ON "products" USING btree ("operation_id","shopify_product_id") WHERE "products"."shopify_product_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_agent_settings_operation_idx" ON "sales_agent_settings" USING btree ("operation_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
