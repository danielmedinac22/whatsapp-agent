-- ────────────────────────────────────────────────────────────────────────────
-- 0021 · Contract: la operación deja de ser opcional
--
-- La `0020` (expand) agregó `operation_id` nullable en cinco tablas y backfilleó
-- lo existente. Los lotes 02–05 migraron a todos los llamadores. Esta migración
-- cierra la puerta: sin `NOT NULL` sigue siendo posible guardar una conexión o
-- una configuración que no dice de qué operación es, y una fila así la termina
-- leyendo alguien como si fuera «la» conexión.
--
-- **Sobre qué tablas, y por qué no sobre las cinco.** La regla es una sola:
-- `NOT NULL` donde quien escribe **siempre** sabe la operación; nullable donde
-- puede legítimamente no saberla.
--
--   · Las cuatro de configuración (`kapso_connection`, `shopify_connection`,
--     `dropi_connection`, `agent_settings`) las escribe el panel, que resuelve
--     la operación antes de escribir. Van a `NOT NULL`.
--   · `dropi_orders` la escribe el sondeo, que le preguntó por esos pedidos a
--     la cuenta de Dropi **de una operación concreta**: la sabe siempre. Va a
--     `NOT NULL` — ver abajo por qué se agrega aquí y no en el expand.
--   · `conversations` **se queda nullable**. La escriben el pipeline de entrada
--     (un mensaje puede llegar por un número que no reconocemos) y el webhook de
--     la tienda (que hasta el ticket 08 no puede distinguir dos tiendas).
--     Volverla obligatoria convertiría «no sé de qué operación es» en «pierdo el
--     mensaje» y «pierdo el pedido» — justo lo contrario de lo que decidió el
--     lote 02 al no darle al pipeline ninguna forma de descartar, y sobre el
--     camino por el que entran los pedidos que facturan.
--
-- **Los rescates.** Todos los `UPDATE` filtran por `operation_id IS NULL`, así
-- que son idempotentes y alcanzan las filas que hayan entrado entre la
-- generación y la aplicación. Resuelven la operación con
-- `(SELECT id FROM operations WHERE status = 'active')`: es la misma regla que
-- el puente `requireSoleActiveOperation()` del código, escrita en SQL. Con dos
-- operaciones activas la subconsulta escalar falla —«more than one row»— y la
-- migración se detiene en vez de repartir filas al país equivocado.
--
-- **Medido en producción antes de aplicar** (lectura pura, 16-ago-2026):
-- kapso_connection 1/1 · dropi_connection 1/1 · agent_settings 1/1 ·
-- shopify_connection 0/0 · conversations 1.688/1.688 · dropi_orders 1.758 filas
-- (1.729 cruzadas con pedido de tienda, 29 sin cruzar), 1.681 pedidos de tienda
-- todos en GTQ. Ninguna fila en NULL en las cuatro tablas de configuración.
--
-- **Deja de ser compatible con un worker viejo** que inserte sin operación: hay
-- que deployar el worker de esta rama después de aplicarla.
-- ────────────────────────────────────────────────────────────────────────────

-- 1 · Rescate de las cuatro tablas de configuración, por si entró alguna fila
--     sin operación después de que el ticket 01 midiera.
UPDATE "kapso_connection"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "status" = 'active')
WHERE "operation_id" IS NULL;--> statement-breakpoint
UPDATE "dropi_connection"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "status" = 'active')
WHERE "operation_id" IS NULL;--> statement-breakpoint
UPDATE "agent_settings"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "status" = 'active')
WHERE "operation_id" IS NULL;--> statement-breakpoint
-- No-op hoy: `shopify_connection` está vacía. Va igual para que la migración
-- describa la regla completa y no dependa de que la tabla siga vacía.
UPDATE "shopify_connection"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "status" = 'active')
WHERE "operation_id" IS NULL;--> statement-breakpoint

-- 2 · La operación deja de ser opcional en las cuatro.
ALTER TABLE "kapso_connection" ALTER COLUMN "operation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dropi_connection" ALTER COLUMN "operation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ALTER COLUMN "operation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shopify_connection" ALTER COLUMN "operation_id" SET NOT NULL;--> statement-breakpoint

-- 3 · Una conexión y una configuración **por operación**.
--
-- Hasta aquí la clave del modelo vivía solo en la cabeza de quien leía: el `id`
-- entero con `default 1` es el que heredaron del singleton, y nada impedía dos
-- filas de la misma operación. Con dos, cuál ganaba era arbitrario.
CREATE UNIQUE INDEX IF NOT EXISTS "kapso_connection_operation_idx" ON "kapso_connection" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dropi_connection_operation_idx" ON "dropi_connection" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_settings_operation_idx" ON "agent_settings" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shopify_connection_operation_idx" ON "shopify_connection" USING btree ("operation_id");--> statement-breakpoint

-- 4 · `dropi_orders.operation_id` — la columna que el expand no puso.
--
-- El lote de logística la pidió y el lote de la tienda argumentó que
-- `shopify_orders` no la necesita. Las dos posturas son correctas, y la
-- diferencia está en quién escribe cada tabla: el sondeo de logística sabe
-- siempre de qué cuenta de Dropi vienen los pedidos, mientras que el webhook de
-- la tienda no puede saber de qué tienda viene el pedido hasta el ticket 08.
-- Por eso esta columna sí y la de `shopify_orders` no.
--
-- Sin ella, el id de pedido de Dropi —único **dentro** de una cuenta, no entre
-- cuentas— hacía que dos operaciones con el pedido 942698 fueran la misma fila:
-- el sondeo de una pisaba el pedido de la otra. El paliativo del lote 04
-- (comparar la moneda del pedido de tienda cruzado) cubría 1.729 de 1.758.
-- Y el único sobre `dropi_order_id` a secas directamente habría rechazado el
-- pedido legítimo de la segunda operación.
--
-- Se agrega nullable, se backfillea y solo entonces se vuelve obligatoria: un
-- `ADD COLUMN ... NOT NULL` sobre 1.758 filas existentes falla.
ALTER TABLE "dropi_orders" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
UPDATE "dropi_orders"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "status" = 'active')
WHERE "operation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "dropi_orders" ALTER COLUMN "operation_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dropi_orders" ADD CONSTRAINT "dropi_orders_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 5 · El único del pedido de logística pasa a ser (operación, id de Dropi).
--
-- Se crea el nuevo **antes** de borrar el viejo: si por lo que sea hubiera un
-- duplicado, la migración falla con el índice viejo todavía puesto.
CREATE UNIQUE INDEX IF NOT EXISTS "dropi_orders_operation_id_idx" ON "dropi_orders" USING btree ("operation_id","dropi_order_id");--> statement-breakpoint
DROP INDEX IF EXISTS "dropi_orders_id_idx";
