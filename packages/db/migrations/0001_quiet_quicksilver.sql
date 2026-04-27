ALTER TABLE "agent_settings" ADD COLUMN "remarketing_delay_ms" integer DEFAULT 10800000 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "remarketing_template_id" uuid;--> statement-breakpoint
ALTER TABLE "shopify_orders" ADD COLUMN "remarketing_scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shopify_orders" ADD COLUMN "remarketing_job_id" text;--> statement-breakpoint
ALTER TABLE "shopify_orders" ADD COLUMN "remarketing_sent_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_remarketing_template_id_templates_id_fk" FOREIGN KEY ("remarketing_template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
