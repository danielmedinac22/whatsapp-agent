-- ────────────────────────────────────────────────────────────────────────────
-- 0026 · Que quede registrado cómo terminó el reconocimiento
--
-- La única migración de esta ola: drizzle-kit reescribe `meta/_journal.json` en
-- cada generación, así que dos ramas que generen en paralelo chocan siempre y
-- el conflicto no lo ve ningún check local. Los otros dos worktrees de la ola
-- no generan ninguna.
--
-- **El problema, que es de lectura y no de escritura.** Hoy lo único que se
-- persiste del reconocimiento es `conversations.product_id`. Con `null`, la
-- base cuenta igual **tres historias distintas**:
--
--   · la cascada devolvió **ambiguo** —varios candidatos, ninguno con confianza—
--   · la cascada **no encontró nada**
--   · la cascada **todavía no corrió**
--
-- Y las dos primeras piden cosas opuestas del asesor: ante *ambiguo* tiene que
-- desempatar entre los cuatro REVITALHAIR; ante *sin candidatos* tiene que ir a
-- cargar el anuncio al catálogo, que es otra pantalla. Mostrarlas iguales lo
-- manda a hacer lo que no es (`ventas-ingesta-reconocimiento/06`, levantado al
-- chocar con un criterio de `ventas-panel/04` que no era cumplible).
--
-- **Dos columnas y ninguna tabla nueva**, porque el resultado es un atributo de
-- la conversación y muere con ella:
--
-- 1 · `product_recognition` — cómo terminó la cascada, con **su mismo
--     vocabulario**: `resolved`, `ambiguous`, `unknown`. `null` es la tercera
--     historia y la única que no es un resultado: no corrió. Esta migración
--     **registra** lo que la cascada decide; no cambia cómo decide — la cascada
--     es fija a propósito y sigue sin perillas.
-- 2 · `product_candidate_ids` — cuáles eran los candidatos cuando quedó
--     ambigua, en el orden en que la cascada los presenta. Sin esto, la
--     pregunta con lista corta al lead (`ingesta/05`) no tiene de dónde
--     sacarlos, y la pantalla no puede decir «dudó entre estos tres».
--
-- **Ids y no nombres.** El nombre de un producto conectado a la tienda vive en
-- Shopify y se lee en tiempo de uso —`products.name` es nullable justamente por
-- eso—, así que copiarlo aquí sería guardar una copia que envejece en silencio.
-- Se resuelve al leer, contra el catálogo de la operación.
--
-- **`text` y no un enum**, como `discount_limit_behavior` de la `0025`: un
-- cuarto resultado mañana es cambiar el `check` de abajo, y no un
-- `ALTER TYPE ... ADD VALUE` cuyo valor nuevo Postgres no deja usar en la misma
-- transacción que lo agrega — la trampa que la `0022` ya dejó anotada.
--
-- **`jsonb` y no una tabla de unión.** Una tabla `conversation_product_candidates`
-- daría clave foránea, y a cambio pediría borrado y reescritura ordenados en el
-- camino de entrada de todo mensaje —el que factura— para guardar dos o tres
-- ids que solo se leen juntos y en orden. El precedente de esta misma tabla es
-- `ad_referral_raw`: lo que se guarda entero y se lee entero va en jsonb. Lo que
-- se pierde con eso es la integridad referencial, y el efecto es exactamente el
-- mismo que ya tiene `product_id` con su `set null`: un candidato borrado del
-- catálogo desaparece de la lista al leerla.
--
-- **El `check` de candidatos no es decorativo.** «Ambiguo» sin candidatos no es
-- un dato: es una pantalla que no puede decir entre qué dudó y una pregunta al
-- lead sin lista que ofrecerle. La cascada ya lo garantiza por tipo
-- (`ambiguous.candidates` es una tupla de al menos dos), y esto lo hace cumplir
-- también a quien escriba por otra vía. Al revés vale igual: candidatos con
-- cualquier otro resultado serían restos de un reconocimiento anterior.
--
-- Está escrito con `is [not] distinct from` y un `is not null` explícito, y no
-- con `=`, por una razón que costó un ensayo: **un `CHECK` que evalúa a NULL
-- pasa**. Con `=`, la fila que este check existe para impedir —«ambiguo» con
-- los candidatos en null— daba NULL y entraba igual. Se vio aplicando la
-- migración contra una base desechable, no leyéndola.
--
-- **Medido antes de generar** (18-ago-2026, producción, solo lectura):
-- `conversations` 1.736 filas, **0 sin `operation_id`**, **0 con `ad_id`** —la
-- referencia CTWA no llegó nunca, y no es un bug: la pauta apunta a otra WABA y
-- los dos números se unifican después (`ventas-pulido-ui/03`)—. `products` 0 ·
-- `product_ads` 0 · `sales_agent_settings` 0. De `products` en 0 se sigue, por
-- la clave foránea, que **`product_id` es `null` en las 1.736 filas**: ninguna
-- conversación tiene producto resuelto todavía.
--
-- **Aun así lleva backfill**, y no es ceremonia. `UPDATE` alcanza hoy cero
-- filas, pero cubre las que puedan entrar **entre la generación y la
-- aplicación**: las escribe el worker viejo, que resuelve `product_id` sin
-- conocer la columna nueva, y sin esta línea quedarían diciendo «no corrió»
-- cuando sí corrió y resolvió. Es la misma razón por la que la `0025` explicaba
-- por qué **no** lo necesitaba: allá el `ADD COLUMN` con default rellenaba todo.
--
-- **Guatemala no cambia.** Registrar un dato no altera a quién le contesta el
-- sistema ni qué le contesta: las dos columnas nacen nulas, nadie las lee para
-- decidir una respuesta, y el reconocimiento solo corre cuando el mensaje trae
-- referencia de anuncio — que en Guatemala no pasa ni una vez (0 filas con
-- `ad_id`). El camino de entrada además ya tenía la regla que esto respeta: si
-- registrar falla, el mensaje sigue.
--
-- **Compatibilidad con lo desplegado**: un worker o un panel viejos siguen
-- funcionando —ignoran las dos columnas—, así que se puede aplicar antes de
-- desplegar. Al revés no: el worker de esta rama escribe las dos columnas y el
-- panel las lee, así que **la migración va antes del deploy**, no después.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "conversations" ADD COLUMN "product_recognition" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "product_candidate_ids" jsonb;--> statement-breakpoint

-- Backfill · lo que ya está resuelto lo dice. Ver arriba: hoy alcanza cero
-- filas y existe por las que entren antes de que el worker nuevo esté arriba.
UPDATE "conversations"
   SET "product_recognition" = 'resolved'
 WHERE "product_id" IS NOT NULL
   AND "product_recognition" IS NULL;--> statement-breakpoint

-- Los dos `check` van **después** del backfill: se validan contra las filas que
-- ya están. Envueltos como los de la `0024` y la `0025` para que reaplicar la
-- migración no falle por duplicado.
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_product_recognition_check" CHECK ("conversations"."product_recognition" is null or "conversations"."product_recognition" in ('resolved', 'ambiguous', 'unknown'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_product_candidates_check" CHECK (("conversations"."product_recognition" is not distinct from 'ambiguous' and "conversations"."product_candidate_ids" is not null and jsonb_typeof("conversations"."product_candidate_ids") = 'array' and jsonb_array_length("conversations"."product_candidate_ids") >= 2) or ("conversations"."product_recognition" is distinct from 'ambiguous' and "conversations"."product_candidate_ids" is null));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
