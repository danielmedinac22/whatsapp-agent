-- ────────────────────────────────────────────────────────────────────────────
-- 0024 · La operación en los pedidos y en las dos tablas de plantillas
--
-- El ticket 07 le da al panel un selector de operación y el 10 hace que las
-- doce consultas de `apps/web/src/lib/queries.ts` filtren por ella. Tres de
-- esas consultas leen tablas que **no dicen de qué operación son**, así que no
-- hay `where` que escribir hasta que exista la columna:
--
--   · `listShopifyOrders` y `listShopifyOrdersWithDropi` → `shopify_orders`
--   · `listApprovedWaTemplates`                          → `wa_templates`
--   · `listTemplates`                                    → `templates`
--
-- **`templates` no estaba en el ticket.** El ticket 10 la daba por resuelta
-- («`templates` ya tiene `operation_id`, solo agregás el `where`»). Medido
-- contra producción el 18-ago-2026: no la tenía. Nueve filas, ninguna columna
-- de operación. De esas nueve cuelgan las seis FK de plantilla de
-- `agent_settings` —seguimiento, remarketing, acuse y las cuatro de logística—,
-- que desde la `0021` es una fila **por operación**: sin la columna, la
-- configuración colombiana solo puede apuntar a plantillas guatemaltecas, y lo
-- que hay dentro de una plantilla es el texto que le sale al cliente.
--
-- **Nullable o no, la regla es la de la `0021`**: `NOT NULL` donde quien
-- escribe siempre sabe la operación; nullable donde puede legítimamente no
-- saberla.
--
--   · `templates` y `wa_templates` van a `NOT NULL`. Las escribe el panel y el
--     aprovisionamiento de Meta, que someten contra la WABA de una operación
--     concreta: la saben siempre.
--   · `shopify_orders` **se queda nullable**, por lo mismo que `conversations`.
--     La escribe el webhook de la tienda, que se autentica con un secreto de
--     entorno global y cuya carga útil no trae identidad de tienda. Volverla
--     obligatoria convertiría «no sé de qué operación es» en «pierdo el
--     pedido», sobre el camino por el que entran los 1.712 que facturan (R4).
--     Es exactamente lo que la `0021` decidió no hacer, y sigue en pie.
--
-- **Los backfill.** Todos filtran por `operation_id IS NULL`, así que son
-- idempotentes y alcanzan las filas que entren entre la generación y la
-- aplicación. Resuelven la operación con
-- `(SELECT id FROM operations WHERE status = 'active')`: la misma regla que
-- `requireSoleActiveOperation()` escrita en SQL, y la misma que usó la `0021`.
-- Es lo que evita hardcodear el uuid de Guatemala
-- (`63937b3d-6312-446d-8bb8-1b9468afdd87`, medido, no supuesto). Con dos
-- operaciones activas la subconsulta escalar falla —«more than one row»— y la
-- migración se detiene en vez de repartir filas al país equivocado.
--
-- **Medido en producción antes de aplicar** (lectura pura, 18-ago-2026):
-- operations 1 (`GT`, `active`) · shopify_orders 1.712 · wa_templates 15 (las
-- 15 aprobadas, una sola WABA `1676368750161510`) · templates 9 ·
-- conversations 1.719 con **cero** en NULL. Ninguna fila queda sin backfillear.
--
-- **Deja de ser compatible con un worker viejo**: uno que inserte en
-- `templates` o en `wa_templates` sin operación choca contra el `NOT NULL`, y
-- uno que inserte en `shopify_orders` sin operación deja el pedido fuera de la
-- pantalla de Pedidos, que ya filtra. Hay que deployar el worker de esta rama
-- después de aplicarla.
--
-- **Lo que esta migración NO toca, a propósito:** el único de
-- `shopify_orders.order_id`. Con dos tiendas, dos pedidos distintos pueden
-- compartir número y el único los haría la misma fila — el mismo problema que
-- la `0021` le resolvió a `dropi_orders`. No se arregla aquí porque
-- `operation_id` es nullable: un único sobre `(operation_id, order_id)` deja
-- pasar duplicados entre las filas sin atribuir, y un pedido duplicado es un
-- seguimiento duplicado al cliente. Es del ticket 08, que es el que trae la
-- segunda tienda y con ella la forma de atribuir.
-- ────────────────────────────────────────────────────────────────────────────

-- 1 · `shopify_orders` — nullable, la pantalla de Pedidos ya puede filtrar.
ALTER TABLE "shopify_orders" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
UPDATE "shopify_orders"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "status" = 'active')
WHERE "operation_id" IS NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopify_orders" ADD CONSTRAINT "shopify_orders_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopify_orders_operation_idx" ON "shopify_orders" USING btree ("operation_id","received_at");--> statement-breakpoint

-- 2 · `templates` — obligatoria, y el único pasa a ser (operación, nombre).
--
-- Se agrega nullable, se backfillea y solo entonces se vuelve obligatoria: un
-- `ADD COLUMN ... NOT NULL` sobre las nueve filas existentes falla.
ALTER TABLE "templates" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
UPDATE "templates"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "status" = 'active')
WHERE "operation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "templates" ALTER COLUMN "operation_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "templates" ADD CONSTRAINT "templates_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- El nuevo se crea **antes** de borrar el viejo: si hubiera un duplicado, la
-- migración falla con el índice viejo todavía puesto. Mismo orden que la `0021`
-- usó para `dropi_orders`.
--
-- Con el único sobre el nombre a secas, Colombia no puede tener su propia
-- `dropi_guia_generada`: el insert del seed choca contra la guatemalteca y la
-- operación se queda sin plantilla de logística, en silencio.
CREATE UNIQUE INDEX IF NOT EXISTS "templates_operation_name_idx" ON "templates" USING btree ("operation_id","name");--> statement-breakpoint
DROP INDEX IF EXISTS "templates_name_idx";--> statement-breakpoint

-- 3 · `wa_templates` — obligatoria.
--
-- El único sigue siendo (nombre, WABA) y no se toca: Meta aprueba **por WABA**,
-- así que es la WABA la que define qué nombre puede repetirse. La columna no
-- existe para arbitrar duplicados sino para que el panel filtre sin tener que
-- ir a buscar la conexión para traducir operación → WABA.
ALTER TABLE "wa_templates" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
UPDATE "wa_templates"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "status" = 'active')
WHERE "operation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "wa_templates" ALTER COLUMN "operation_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wa_templates" ADD CONSTRAINT "wa_templates_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_templates_operation_idx" ON "wa_templates" USING btree ("operation_id","status");
