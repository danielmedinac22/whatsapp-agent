# Verificar `referral` con un anuncio CTWA real

Type: task
Status: open
Blocked by: —

## Question

No hay nada que decidir: hay que producir un payload real y mirarlo.

La investigación de *Confirmar que Kapso entrega `referral` en el webhook* dejó el asunto en "sí según la documentación, sin verificar". Eso no alcanza para comprometer alcance cerrado a precio fijo, porque ya se comprobó que el serializador de Kapso recorta campos que Meta sí manda (`from_user_id` es el caso probado).

**Insumo que falta y que solo puede dar Vorare:** un anuncio Click-to-WhatsApp activo apuntando al número, y un clic real que genere un mensaje entrante. Costo aproximado 1–5 USD/día, y se pausa apenas llegue el mensaje.

**Procedimiento, ya probado en modo lectura:**

1. `log_search?source=whatsapp_webhook_event` → `payload.raw_payload` — lo que mandó Meta.
2. `log_search?source=webhook_delivery` → `payload.request_body` — lo que Kapso nos POSTeó.
3. Cruzar ambos por `wamid`.

**Resuelto cuando** esté escrita la ruta exacta del campo `referral` dentro del payload que recibe el worker — o la confirmación de que se recorta y hay que pasar a un webhook `kind: "meta"`.

Ojo con la ventana: los Logs de Kapso guardan 7 días. El clic y la revisión tienen que caer dentro de esa ventana.

Bloquea la publicación del artefacto: no se firma un mecanismo sin verificar.
