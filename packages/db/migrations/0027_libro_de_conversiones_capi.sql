-- ────────────────────────────────────────────────────────────────────────────
-- 0027 · El libro de las conversiones ya reportadas a Meta
--
-- **Se apila detrás de la `0026`.** Orden obligatorio: primero la `0026`,
-- después ésta.
--
-- ## Por qué hace falta una tabla
--
-- El riesgo R7 de la no-regresión dice que un evento de conversión duplicado
-- **envenena el aprendizaje del algoritmo** de la pauta que Vorare paga, y que
-- **eso no se revierte borrando datos**. Y la documentación de Meta es
-- explícita en que este flujo —*Conversions API for Business Messaging*— **no
-- deduplica del lado de ellos**: dos envíos del mismo pedido cuentan dos
-- ventas. La deduplicación es nuestra o no existe.
--
-- Lo que ya había no alcanzaba:
--
-- · **`pg-boss` deduplica por `singletonKey`**, pero esa llave solo es única
--   mientras el job está vivo. Al completarse se archiva a los catorce días y
--   después se borra — y desde ahí el barrido volvería a ver el pedido «sin
--   reportar» y lo mandaría otra vez. La dedup de una conversión tiene que
--   durar más que la retención de una cola.
-- · **`shopify_orders` no tiene dónde anotarlo**, y meterlo en `raw_payload`
--   sería esconder estado de negocio dentro de la copia cruda de un webhook,
--   sobre la tabla por la que entran los 1.735 pedidos que facturan.
--
-- El patrón es el que el repo ya tiene probado en `outbound_messages.dedup_key`:
-- un único sobre la llave, `insert ... on conflict do nothing`, y **quien no
-- logró insertar es quien no manda**.
--
-- ## Las dos columnas que no son obvias
--
-- · **`status = 'unconfirmed'`** — la petición salió y nunca llegó respuesta.
--   No es un desenlace y aun así es final: **no se reintenta nunca**, porque
--   reintentar algo que quizás llegó es exactamente cómo se fabrica el
--   duplicado que no se puede deshacer.
-- · **`event_time`** — el momento que viajó dentro del evento. Está para que un
--   `unconfirmed` se pueda **verificar**: nadie de este lado sabe si esa
--   conversión llegó, y lo único que puede saberlo es el administrador de
--   eventos de Meta, donde los eventos se buscan por dataset, momento y valor.
--   Sin esta columna, «no sabemos» sería un estado sin forma de averiguarlo.
--
-- ## Sin backfill, y no es un olvido
--
-- La tabla nace vacía y no reemplaza a ninguna columna: no hay fila anterior
-- que traducir. Sembrarla con los pedidos existentes sería justo lo contrario
-- de lo que hace falta — marcaría como «ya reportadas» ventas que nunca se
-- reportaron. Medido el 19-ago-2026 en producción: **0 conversaciones con
-- `ctwa_clid`** y **0 pedidos con la etiqueta `origen-ventas`**, así que hoy no
-- hay ni un pedido que califique.
--
-- ## Guatemala no cambia
--
-- Una tabla nueva y vacía, sin tocar ninguna existente: ni una columna
-- agregada, renombrada ni borrada en el camino que factura. Nadie la lee para
-- decidir a quién contestarle ni qué contestarle. Y quien la escribe está
-- apagado por partida triple: no hay credencial de Meta en el entorno, el
-- interruptor `META_CAPI_MODE` arranca en `off`, y `operations.capi_dataset_id`
-- sigue en NULL.
--
-- **Compatibilidad con lo desplegado**: un worker viejo ignora la tabla, así
-- que se puede aplicar antes de desplegar. Al revés no: el worker de esta rama
-- la escribe, así que la migración va antes del deploy.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "capi_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"dedup_key" text NOT NULL,
	"order_id" text NOT NULL,
	"conversation_id" uuid,
	"dataset_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"value" text NOT NULL,
	"currency" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "capi_conversions_status_check" CHECK ("capi_conversions"."status" in ('pending', 'sent', 'failed', 'unconfirmed')),
	CONSTRAINT "capi_conversions_mode_check" CHECK ("capi_conversions"."mode" in ('test', 'live'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "capi_conversions" ADD CONSTRAINT "capi_conversions_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "capi_conversions" ADD CONSTRAINT "capi_conversions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "capi_conversions_dedup_key_idx" ON "capi_conversions" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "capi_conversions_operation_idx" ON "capi_conversions" USING btree ("operation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "capi_conversions_status_idx" ON "capi_conversions" USING btree ("status","created_at");
