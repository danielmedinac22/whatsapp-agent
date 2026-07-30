ALTER TABLE "messages" ADD COLUMN "delivery_error" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "delivery_status" "message_status";--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "delivery_error" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
-- Coherencia de la columna nueva con lo que ya sabíamos: `acked` significaba
-- "Meta confirmó entrega o lectura", colapsadas en un solo valor.
UPDATE "outbound_messages"
SET "delivery_status" = 'delivered',
    "delivered_at"    = COALESCE("acked_at", "updated_at")
WHERE "status" = 'acked' AND "delivery_status" IS NULL;--> statement-breakpoint
UPDATE "outbound_messages"
SET "delivery_status" = 'failed'
WHERE "status" = 'failed' AND "delivery_status" IS NULL;--> statement-breakpoint
-- Chulos históricos: el webhook de `delivered` llegaba antes de que
-- existiera la fila en `messages`, así que el estado se perdía y el mensaje
-- se quedaba en "enviado" para siempre (7 506 casos, 98,6 % de los `sent`).
-- `read` no es recuperable: `acked` no distingue entregado de leído.
UPDATE "messages" m
SET "status" = 'delivered'
FROM "outbound_messages" o
WHERE o."wa_id" = m."wa_id"
  AND m."direction" = 'out'
  AND m."status" = 'sent'
  AND o."status" = 'acked';--> statement-breakpoint
-- Envíos que murieron y nunca se espejaron en el hilo: el asesor veía un chat
-- sin respuesta en vez de un mensaje no entregado. Se excluyen a propósito los
-- que murieron por ventana de 24h cerrada (717 casos): son un estado operativo
-- esperado, no una señal de número malo, y llenarían de ruido hilos viejos.
INSERT INTO "messages" (
  "conversation_id", "direction", "wa_id", "body", "status",
  "delivery_error", "from_agent", "sent_by_user_id", "created_at"
)
SELECT
  COALESCE(o."conversation_id", c."id"),
  'out',
  o."wa_id",
  o."body",
  'failed',
  -- Ojo: estos fallos históricos son de configuración NUESTRA (WABA sin
  -- registrar, phone_number_id inválido, Kapso sin configurar), no números
  -- malos del cliente. Etiquetarlos como "número inválido" sería exactamente
  -- la información falsa que este cambio viene a eliminar.
  CASE
    WHEN o."last_error" ILIKE '%undeliverable%'
      THEN 'El destinatario no puede recibir el mensaje (¿no usa WhatsApp?).'
    WHEN o."last_error" ILIKE '%rate_limited%'
      THEN 'Meta limitó la entrega por salud del ecosistema.'
    WHEN o."last_error" ILIKE '%133010%'
      THEN 'La cuenta de WhatsApp no estaba registrada al momento del envío.'
    WHEN o."last_error" LIKE '%→ 404%'
      THEN 'No había configuración de WhatsApp activa al momento del envío.'
    WHEN o."last_error" ILIKE '%status=0%'
      THEN 'WhatsApp no respondió al enviar.'
    ELSE 'WhatsApp rechazó el envío por un problema de configuración.'
  END,
  o."source" = 'agent',
  o."sent_by_user_id",
  o."created_at"
FROM "outbound_messages" o
LEFT JOIN "contacts" ct ON ct."wa_id" = o."to_wa_id"
LEFT JOIN "conversations" c ON c."contact_id" = ct."id"
WHERE o."status" IN ('dead', 'failed')
  AND COALESCE(o."conversation_id", c."id") IS NOT NULL
  AND o."last_error" NOT LIKE '%→ 422%'
  AND COALESCE(o."last_error", '') NOT ILIKE 'reengagement_window%'
  AND NOT EXISTS (
    SELECT 1 FROM "messages" m
    WHERE m."wa_id" IS NOT NULL AND m."wa_id" = o."wa_id"
  );
