CREATE TABLE IF NOT EXISTS "agent_prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt" text NOT NULL,
	"label" text,
	"author_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_prompt_versions_created_idx" ON "agent_prompt_versions" USING btree ("created_at");--> statement-breakpoint
INSERT INTO "agent_prompt_versions" ("prompt", "label", "author_email")
SELECT "system_prompt", 'Prompt en producción al activar el historial', NULL
FROM "agent_settings"
WHERE "id" = 1 AND length(trim("system_prompt")) > 0;