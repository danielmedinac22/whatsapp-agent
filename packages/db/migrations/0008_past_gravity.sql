ALTER TABLE "dropi_connection" ADD COLUMN "last_auto_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dropi_connection" ADD COLUMN "last_auto_login_error" text;