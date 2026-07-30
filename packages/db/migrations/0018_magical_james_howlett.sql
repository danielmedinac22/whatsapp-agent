ALTER TYPE "public"."dropi_status" ADD VALUE 'en_oficina' BEFORE 'entregado';--> statement-breakpoint
ALTER TYPE "public"."dropi_status" ADD VALUE 'novedad_solucionada' BEFORE 'anulada';--> statement-breakpoint
ALTER TYPE "public"."dropi_status" ADD VALUE 'devolucion' BEFORE 'anulada';--> statement-breakpoint
ALTER TYPE "public"."dropi_status" ADD VALUE 'rechazado' BEFORE 'anulada';--> statement-breakpoint
ALTER TYPE "public"."dropi_status" ADD VALUE 'retornado' BEFORE 'anulada';--> statement-breakpoint
ALTER TYPE "public"."template_type" ADD VALUE 'dropi_en_oficina';--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "dropi_template_en_oficina_id" uuid;--> statement-breakpoint
ALTER TABLE "dropi_orders" ADD COLUMN "last_movement_raw" text;--> statement-breakpoint
ALTER TABLE "dropi_orders" ADD COLUMN "last_movement_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_dropi_template_en_oficina_id_templates_id_fk" FOREIGN KEY ("dropi_template_en_oficina_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Materializa el último movimiento de la transportadora desde los payloads que
-- ya tenemos: es la situación logística real (más fina que el status del
-- pedido) y los filtros de Pedidos no pueden desempaquetar 1 259 arrays JSON
-- en cada consulta.
--
-- NO reclasifica a 'en_oficina': Postgres prohíbe usar un valor de enum recién
-- agregado en la misma transacción (55P04) y drizzle corre todas las
-- migraciones pendientes en una sola. Eso lo hace
-- scripts/backfill-en-oficina.ts, que además sella last_notified_status para
-- que ningún cliente reciba un aviso retroactivo.
UPDATE "dropi_orders" d
SET "last_movement_raw" = m."nom_mov",
    "last_movement_at"  = m."at"
FROM (
  SELECT
    o."id",
    (mv->>'nom_mov') AS "nom_mov",
    NULLIF(mv->>'created_at', '')::timestamptz AS "at"
  FROM "dropi_orders" o
  CROSS JOIN LATERAL (
    SELECT mv
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(o."raw_payload"->'servientrega_movements') = 'array'
          THEN o."raw_payload"->'servientrega_movements'
        ELSE '[]'::jsonb
      END
    ) mv
    WHERE COALESCE(mv->>'nom_mov', '') <> ''
    ORDER BY mv->>'created_at' DESC
    LIMIT 1
  ) m
) m
WHERE d."id" = m."id";
