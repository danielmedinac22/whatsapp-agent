CREATE TYPE "public"."outbound_error_kind" AS ENUM('transient', 'permanent');--> statement-breakpoint
CREATE TYPE "public"."outbound_source" AS ENUM('followup', 'remarketing', 'agent', 'manual');--> statement-breakpoint
CREATE TYPE "public"."outbound_status" AS ENUM('pending', 'sending', 'sent', 'acked', 'dead', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jid" text NOT NULL,
	"body" text NOT NULL,
	"source" "outbound_source" NOT NULL,
	"source_ref" text,
	"dedup_key" text NOT NULL,
	"conversation_id" uuid,
	"sent_by_user_id" uuid,
	"status" "outbound_status" DEFAULT 'pending' NOT NULL,
	"wa_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_error_kind" "outbound_error_kind",
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"acked_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outbound_messages_dedup_idx" ON "outbound_messages" USING btree ("dedup_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outbound_messages_wa_id_idx" ON "outbound_messages" USING btree ("wa_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_status_sched_idx" ON "outbound_messages" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_jid_idx" ON "outbound_messages" USING btree ("jid","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_messages_source_idx" ON "outbound_messages" USING btree ("source","source_ref");