ALTER TYPE "public"."outbound_source" ADD VALUE 'confirmation_ack';--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "confirmation_ack_template_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_confirmation_ack_template_id_templates_id_fk" FOREIGN KEY ("confirmation_ack_template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
