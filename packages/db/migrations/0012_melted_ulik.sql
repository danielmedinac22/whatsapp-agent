ALTER TABLE "dropi_orders" ADD COLUMN "novedad_reason_raw" text;--> statement-breakpoint
ALTER TABLE "dropi_orders" ADD COLUMN "novedad_first_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dropi_orders" ADD COLUMN "novedad_reminder_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dropi_orders" ADD COLUMN "novedad_escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dropi_orders" ADD COLUMN "novedad_customer_replied_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dropi_orders_novedad_first_notified_idx" ON "dropi_orders" USING btree ("novedad_first_notified_at");