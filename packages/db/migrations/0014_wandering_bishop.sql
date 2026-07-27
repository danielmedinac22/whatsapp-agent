CREATE TYPE "public"."wa_template_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'paused');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kapso_connection" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"phone_number_id" text,
	"business_account_id" text,
	"display_phone_number" text,
	"display_name" text,
	"kind" text,
	"webhook_registered_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wa_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"category" text DEFAULT 'UTILITY' NOT NULL,
	"body_text" text NOT NULL,
	"buttons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"business_account_id" text,
	"meta_template_id" text,
	"status" "wa_template_status" DEFAULT 'draft' NOT NULL,
	"status_reason" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"event_id" text NOT NULL,
	"event" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_messages" RENAME COLUMN "jid" TO "to_wa_id";--> statement-breakpoint
DROP INDEX IF EXISTS "outbound_messages_jid_idx";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "wa_id" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "template_name" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "template_params" jsonb;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "fallback_template_name" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "fallback_template_params" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_templates_name_waba_idx" ON "wa_templates" USING btree ("name","business_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_source_event_idx" ON "webhook_events" USING btree ("source","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_wa_id_idx" ON "contacts" USING btree ("wa_id") WHERE "contacts"."wa_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_to_idx" ON "outbound_messages" USING btree ("to_wa_id","created_at");--> statement-breakpoint
-- Backfill: canonical wa_id (E.164 digits) for existing contacts. When two
-- legacy rows (LID + PN duplicates) map to the same number, only the most
-- recently active one gets the wa_id — the unique index stays satisfied.
WITH candidates AS (
  SELECT id,
         COALESCE(
           NULLIF(regexp_replace(COALESCE("phone", ''), '\D', '', 'g'), ''),
           CASE WHEN "pn_jid" LIKE '%@s.whatsapp.net' THEN split_part("pn_jid", '@', 1) END,
           CASE WHEN "jid" LIKE '%@s.whatsapp.net' THEN split_part("jid", '@', 1) END
         ) AS candidate,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(
             NULLIF(regexp_replace(COALESCE("phone", ''), '\D', '', 'g'), ''),
             CASE WHEN "pn_jid" LIKE '%@s.whatsapp.net' THEN split_part("pn_jid", '@', 1) END,
             CASE WHEN "jid" LIKE '%@s.whatsapp.net' THEN split_part("jid", '@', 1) END
           )
           ORDER BY "last_message_at" DESC NULLS LAST, "created_at" ASC
         ) AS rn
  FROM "contacts"
  WHERE "wa_id" IS NULL
)
UPDATE "contacts" c
SET "wa_id" = candidates.candidate
FROM candidates
WHERE c.id = candidates.id
  AND candidates.candidate IS NOT NULL
  AND candidates.rn = 1
  AND NOT EXISTS (SELECT 1 FROM "contacts" x WHERE x."wa_id" = candidates.candidate);--> statement-breakpoint
-- Backfill: legacy Baileys JIDs in the outbox become bare wa_ids. Rows with
-- @lid addresses stay as-is (historical, unaddressable via the Cloud API).
UPDATE "outbound_messages"
SET "to_wa_id" = split_part("to_wa_id", '@', 1)
WHERE "to_wa_id" LIKE '%@s.whatsapp.net';