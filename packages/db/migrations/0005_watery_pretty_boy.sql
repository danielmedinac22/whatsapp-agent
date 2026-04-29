CREATE TYPE "public"."confirmation_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."confirmation_status" AS ENUM('unknown', 'pending', 'confirmed', 'not_confirmed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shopify_connection" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"shop_domain" text,
	"admin_access_token" text,
	"api_version" text DEFAULT '2025-01' NOT NULL,
	"connected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "confirmation_status" "confirmation_status" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "confirmation_source" "confirmation_source";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "confirmation_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_confirmation_idx" ON "conversations" USING btree ("confirmation_status");