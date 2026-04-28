DROP INDEX IF EXISTS "contacts_jid_idx";--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "lid" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "pn_jid" text;--> statement-breakpoint
-- Backfill: split existing jid into lid / pn_jid based on suffix.
UPDATE "contacts" SET "lid" = "jid" WHERE "jid" LIKE '%@lid';--> statement-breakpoint
UPDATE "contacts" SET "pn_jid" = "jid" WHERE "jid" LIKE '%@s.whatsapp.net';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_lid_idx" ON "contacts" USING btree ("lid") WHERE "contacts"."lid" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_pn_jid_idx" ON "contacts" USING btree ("pn_jid") WHERE "contacts"."pn_jid" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_jid_idx" ON "contacts" USING btree ("jid");