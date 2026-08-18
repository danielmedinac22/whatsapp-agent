-- ────────────────────────────────────────────────────────────────────────────
-- 0025 · Los archivos enviables por producto, y el borde del límite de descuento
--
-- Cierra las dos cosas que la ola pasada dejó esperando esquema, y son las dos
-- únicas de esta ola: drizzle-kit reescribe `meta/_journal.json` en cada
-- generación, así que dos ramas que generen en paralelo chocan siempre y el
-- conflicto no lo ve ningún check local.
--
-- 1 · `product_media` — las fotos, videos y documentos que cuelgan de un
--     producto, con **un interruptor de enviable por archivo** (`ventas-panel`
--     02 y 03).
-- 2 · `sales_agent_settings.discount_limit_behavior` — qué hace el vendedor
--     cuando el cliente pide más descuento del autorizado (`ventas-panel` 01).
--
-- **Los bytes van a Postgres, como `message_media`.** Decisión del usuario del
-- 18-ago-2026, y la razón es el volumen real: WhatsApp corta en 16 MB, el
-- catálogo son 17 productos hoy y decenas mañana, y unos pocos archivos por
-- producto — cientos de MB, no terabytes. Estrenar object storage metía un
-- proveedor, una cuenta y una credencial nuevos en el camino crítico de un
-- módulo que todavía no factura. Queda anotado en `schema.ts` como deuda con
-- disparador: si el catálogo de las dos operaciones pasa de unos pocos GB, se
-- muda a S3/R2 y `bytes` se cambia por una llave de objeto.
--
-- **La operación no se hereda del producto**, igual que en `product_ads` y por
-- lo mismo: la columna `operation_id` más la clave foránea compuesta
-- `(operation_id, product_id)` → `products (operation_id, id)`. Con eso, que un
-- archivo cuelgue de un producto de otra operación **lo impide la base**, no el
-- cuidado del código — y el daño que evita es concreto: el vendedor
-- guatemalteco mandándole al cliente la ficha del producto colombiano.
--
-- **Por qué no hay backfill, que es lo que las 0020–0024 sí llevaban.** No es
-- un olvido; acá no hay ninguna fila que rellenar y las dos razones son
-- distintas:
--
--   · `product_media` es una tabla nueva. Nace vacía y el catálogo también lo
--     está: `products` = 0 y `product_ads` = 0 (medido contra producción el
--     18-ago-2026, solo lectura). No hay archivo previo que atribuir.
--   · `discount_limit_behavior` entra con `DEFAULT 'consultar' NOT NULL`, y un
--     `ADD COLUMN` con default rellena **todas** las filas existentes en el
--     mismo enunciado: un `UPDATE` después alcanzaría cero filas por
--     definición. Y además `sales_agent_settings` está en **0 filas**, así que
--     tampoco hay ninguna. Eso mismo cubre las filas que entren entre la
--     generación y la aplicación: las escribe el panel viejo, sin la columna,
--     y se llevan el default.
--
-- **El default es `consultar` —escalar a una persona— y es una decisión, no un
-- orden alfabético.** La tabla la llena el panel de a poco, así que el valor
-- tiene que ser seguro sin que nadie lo elija. De las tres, escalar es la única
-- cuyo error lo ve un humano: `ofrecer_maximo` gasta margen sola y convierte el
-- techo en piso —el que pida, recibe—, y `no_mencionar` cierra la puerta en
-- silencio y nadie se entera de que se perdió la venta. Escalar de más cuesta
-- atención, que se nota y se corrige. Y es la que **coincide con lo que el
-- sistema ya hace donde el límite se hace cumplir de verdad**: `sales/order.ts`
-- recorta el descuento pasado y lo señala para que un asesor lo mire.
--
-- **Medido en producción antes de generar** (lectura pura, 18-ago-2026):
-- `product_media` no existía · `sales_agent_settings` no tenía la columna ·
-- products 0 · product_ads 0 · sales_agent_settings 0 · shopify_connection 0 ·
-- operations 1 (`Guatemala`, `GT`, `GTQ`, `active`) · message_media 46 filas y
-- 1,26 MB en total, la mayor de 122 KB — que es la referencia de tamaño real
-- de guardar binarios en esta base.
--
-- **Guatemala no cambia.** Ninguna de las dos toca una tabla del camino que
-- factura: `product_media` no existía y nadie la lee todavía, y la columna
-- nueva solo se lee al componer el prompt del vendedor, que hoy no atiende
-- ninguna conversación —`sales_agent_settings` vacía significa que contesta
-- Katherine, y esta migración no crea ninguna fila—.
--
-- **Compatibilidad con lo que ya está desplegado**: un worker o un panel viejos
-- siguen funcionando —ignoran la columna y la tabla—, así que se puede aplicar
-- antes de desplegar. Al revés no: el panel de esta rama lee
-- `discount_limit_behavior` y `product_media`, así que **la migración va antes
-- del deploy**, no después.
-- ────────────────────────────────────────────────────────────────────────────

-- 1 · Los archivos enviables. `bytes` en la base, como `message_media`.
CREATE TABLE IF NOT EXISTS "product_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"sendable" boolean DEFAULT false NOT NULL,
	"meta_media_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_media_byte_size_check" CHECK ("product_media"."byte_size" > 0)
);
--> statement-breakpoint
-- 2 · El borde del límite. `text` y no un enum nuevo, como `reasoning_effort`:
-- agregar una cuarta consecuencia mañana es cambiar el `check` de abajo, y no
-- un `ALTER TYPE ... ADD VALUE` cuyo valor nuevo Postgres no deja usar en la
-- misma transacción que lo agrega — la trampa que la `0022` ya dejó anotada.
ALTER TABLE "sales_agent_settings" ADD COLUMN "discount_limit_behavior" text DEFAULT 'consultar' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_media" ADD CONSTRAINT "product_media_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_operation_fk" FOREIGN KEY ("operation_id","product_id") REFERENCES "public"."products"("operation_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_media_product_idx" ON "product_media" USING btree ("operation_id","product_id","created_at");--> statement-breakpoint
-- El vocabulario del borde es del panel, no de un proveedor: la base es el
-- único lugar donde una cuarta consecuencia inventada por otra vía no puede
-- entrar en silencio y salir después en el prompt del vendedor. Envuelto como
-- las FK de la `0024` para que reaplicar la migración no falle por duplicado.
DO $$ BEGIN
 ALTER TABLE "sales_agent_settings" ADD CONSTRAINT "sales_agent_settings_discount_behavior_check" CHECK ("sales_agent_settings"."discount_limit_behavior" in ('consultar', 'ofrecer_maximo', 'no_mencionar'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
