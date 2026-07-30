CREATE TABLE IF NOT EXISTS "message_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mime" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"duration_ms" integer,
	"source" text NOT NULL,
	"meta_media_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "media_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "media_kind" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_media_id_message_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."message_media"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
