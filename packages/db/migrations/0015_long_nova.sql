DROP INDEX IF EXISTS "contacts_wa_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_wa_id_idx" ON "contacts" USING btree ("wa_id");