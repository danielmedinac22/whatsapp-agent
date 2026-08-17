CREATE TYPE "public"."operation_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country_code" text NOT NULL,
	"currency" text NOT NULL,
	"status" "operation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
ALTER TABLE "dropi_connection" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
ALTER TABLE "kapso_connection" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
ALTER TABLE "shopify_connection" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "operations_country_code_idx" ON "operations" USING btree ("country_code");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dropi_connection" ADD CONSTRAINT "dropi_connection_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kapso_connection" ADD CONSTRAINT "kapso_connection_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_connection" ADD CONSTRAINT "shopify_connection_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- ────────────────────────────────────────────────────────────────────────────
-- Backfill escrito a mano — drizzle no genera datos.
--
-- Medido contra producción el 16-ago-2026: kapso_connection 1 fila,
-- dropi_connection 1, agent_settings 1, shopify_connection 0, y conversations
-- 1.687. Las tres primeras son filas de configuración; conversations sí es una
-- tabla de datos, pero con una sola operación existente todas sus filas son
-- guatemaltecas por definición. Lo demás (1.680 pedidos de tienda, 26.179
-- mensajes) no se toca.
--
-- La operación se resuelve por "country_code" y no por un uuid escrito a mano:
-- el id lo genera Postgres, así que esta migración se puede aplicar tal cual en
-- cualquier base sin arrastrar un identificador de producción.
INSERT INTO "operations" ("name", "country_code", "currency", "status")
VALUES ('Guatemala', 'GT', 'GTQ', 'active')
ON CONFLICT ("country_code") DO NOTHING;--> statement-breakpoint
-- Los UPDATE no tocan "updated_at": la pantalla de Conexiones muestra ese
-- timestamp, y asociar la fila a una operación no es un cambio de configuración
-- que el operador deba ver. El comportamiento observable no cambia.
UPDATE "kapso_connection"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "country_code" = 'GT')
WHERE "operation_id" IS NULL;--> statement-breakpoint
UPDATE "dropi_connection"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "country_code" = 'GT')
WHERE "operation_id" IS NULL;--> statement-breakpoint
UPDATE "agent_settings"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "country_code" = 'GT')
WHERE "operation_id" IS NULL;--> statement-breakpoint
-- No-op hoy: shopify_connection está vacía. Va igual para que la migración
-- describa la regla completa —toda configuración existente es de Guatemala— y
-- no dependa de que la tabla siga vacía en el momento de aplicarla.
UPDATE "shopify_connection"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "country_code" = 'GT')
WHERE "operation_id" IS NULL;--> statement-breakpoint
-- Las 1.687 conversaciones existentes son de Guatemala: es la única operación
-- que ha existido. Nadie lee esta columna todavía —la escribe por primera vez
-- el lote de la conexión de WhatsApp—, pero se backfillea aquí para que el
-- contract pueda volverla obligatoria sin un segundo pase sobre datos.
UPDATE "conversations"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "country_code" = 'GT')
WHERE "operation_id" IS NULL;
