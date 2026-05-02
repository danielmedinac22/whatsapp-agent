ALTER TABLE "dropi_connection" ADD COLUMN "admin_phone" text;--> statement-breakpoint
ALTER TABLE "dropi_connection" ADD COLUMN "pending_2fa_token" text;--> statement-breakpoint
ALTER TABLE "dropi_connection" ADD COLUMN "pending_2fa_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dropi_connection" ADD COLUMN "pending_2fa_requested_at" timestamp with time zone;