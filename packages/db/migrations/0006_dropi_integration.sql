CREATE TYPE "public"."dropi_match_confidence" AS ENUM('high', 'low', 'manual');--> statement-breakpoint
CREATE TYPE "public"."dropi_status" AS ENUM('unknown', 'pendiente_confirmacion', 'pendiente', 'guia_generada', 'preparado_transportadora', 'recolectado', 'en_transito', 'con_mensajero', 'entregado', 'novedad', 'anulada');--> statement-breakpoint
CREATE TYPE "public"."template_type" AS ENUM('general', 'followup', 'remarketing', 'confirmation_ack', 'dropi_guia_generada', 'dropi_recolectado', 'dropi_en_transito', 'dropi_con_mensajero', 'dropi_entregado');--> statement-breakpoint
ALTER TYPE "public"."outbound_source" ADD VALUE 'dropi_status';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dropi_connection" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"api_base_url" text DEFAULT 'https://api.dropi.gt/api' NOT NULL,
	"email" text,
	"password" text,
	"user_id" integer,
	"bearer_token" text,
	"token_expires_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dropi_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dropi_order_id" integer NOT NULL,
	"shopify_order_row_id" uuid,
	"contact_id" uuid,
	"customer_phone" text,
	"customer_name" text,
	"guide_number" text,
	"carrier" text,
	"status" "dropi_status" DEFAULT 'unknown' NOT NULL,
	"raw_status" text,
	"raw_payload" jsonb,
	"match_confidence" "dropi_match_confidence",
	"confirm_put_at" timestamp with time zone,
	"confirm_dry_run_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"last_notified_status" "dropi_status",
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "dropi_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "dropi_dry_run" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "dropi_poll_interval_min" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "dropi_sync_interval_min" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "dropi_match_window_days" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "dropi_template_guia_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "dropi_template_recolectado_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "dropi_template_en_transito_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "dropi_template_con_mensajero_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "dropi_template_entregado_id" uuid;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "type" "template_type" DEFAULT 'general' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dropi_orders" ADD CONSTRAINT "dropi_orders_shopify_order_row_id_shopify_orders_id_fk" FOREIGN KEY ("shopify_order_row_id") REFERENCES "public"."shopify_orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dropi_orders" ADD CONSTRAINT "dropi_orders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dropi_orders_id_idx" ON "dropi_orders" USING btree ("dropi_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dropi_orders_phone_idx" ON "dropi_orders" USING btree ("customer_phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dropi_orders_status_idx" ON "dropi_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dropi_orders_shopify_idx" ON "dropi_orders" USING btree ("shopify_order_row_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dropi_orders_contact_idx" ON "dropi_orders" USING btree ("contact_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_dropi_template_guia_id_templates_id_fk" FOREIGN KEY ("dropi_template_guia_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_dropi_template_recolectado_id_templates_id_fk" FOREIGN KEY ("dropi_template_recolectado_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_dropi_template_en_transito_id_templates_id_fk" FOREIGN KEY ("dropi_template_en_transito_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_dropi_template_con_mensajero_id_templates_id_fk" FOREIGN KEY ("dropi_template_con_mensajero_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_dropi_template_entregado_id_templates_id_fk" FOREIGN KEY ("dropi_template_entregado_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
