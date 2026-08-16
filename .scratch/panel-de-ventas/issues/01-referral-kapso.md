# Confirmar que Kapso entrega `referral` en el webhook

Type: research
Status: resolved
Blocked by: —

## Question

¿El webhook de Kapso entrega el objeto `referral` de Meta — con `source_id`, `headline`, `body`, `source_url` — cuando un lead entra por un anuncio Click-to-WhatsApp, o lo descarta antes de llegarnos?

El PRD lo marca como bloqueante duro (§11). Sin `referral` no existe el reconocimiento por ID de anuncio y el nivel 1 de la cascada del §6 desaparece: quedaría solo el texto del mensaje, que el cliente puede editar o borrar.

Responder con evidencia, no con suposición:

- Documentación de Kapso sobre el payload del webhook de mensajes entrantes.
- Si es posible, un payload real de un mensaje originado en CTWA (los skills `integrate-whatsapp` y `observe-whatsapp` del repo cubren la API y los Logs de Kapso).

Si `referral` no llega, la pregunta secundaria es si hay forma de obtenerlo por otra vía: otro endpoint, otra suscripción de webhook, o configuración de la conexión.

## Answer

**Sí, Kapso lo entrega — según su documentación oficial. No es bloqueante duro.** Pero no está verificado empíricamente.

Hallazgos completos en [`research/01-referral-kapso.md`](../research/01-referral-kapso.md).

**Lo confirmado.** La doc de Kapso (`docs.kapso.ai/docs/platform/whatsapp-data`) declara soporte de Referrals CTWA con los campos `source_type`, `source_id`, `source_url`, `ctwa_clid`, `headline`, `body`, `media_type`, e indica que van incluidos en el payload de `message.received` cuando están presentes. El changelog del 30-dic-2025 confirma el lanzamiento. `source_id` es el ID del anuncio.

**Lo que quedó sin confirmar, y por qué importa.** `referral` no aparece en ninguna de las tres specs OpenAPI ni en la referencia del webhook, así que **la ruta exacta del campo dentro del payload es desconocida**. Y no es una preocupación teórica: se comprobó en Logs reales que el serializador de Kapso **sí recorta campos** — `from_user_id` viaja de Meta a Kapso pero no llega a nuestro worker. La cuenta no tiene tráfico CTWA (0 eventos en la ventana máxima de 7 días), así que no hubo payload real contra el cual verificar.

**Restricción de diseño que aparece de esto.** `referral` **no llega en respuestas interactivas** (botón o lista): solo viene en el primer mensaje. La atribución del lead a su anuncio hay que **persistirla en el primer contacto** o se pierde.

**Vías alternativas si el campo se recorta.** Un webhook `kind: "meta"`, que Kapso documenta como passthrough textual del payload de Meta sin modificación (verificado contra `raw_payload`). Advertencias: el `kind` no se puede cambiar después de crear el webhook —toca crear otro—, no hay buffering, es uno por número, y la firma HMAC en modo meta no está documentada. También existe un dashboard "Ads (CTWA)" con export CSV, sin API.

**Cómo se cierra la duda.** Los Logs ya guardan las dos mitades: `log_search?source=whatsapp_webhook_event` da `payload.raw_payload` (lo que mandó Meta) y `source=webhook_delivery` da `payload.request_body` (lo que Kapso nos POSTeó). Comparar ambos por `wamid` fija la ruta del campo y zanja el asunto. Los comandos ya se ejecutaron en modo lectura y funcionan. **Falta un solo insumo: un clic real en un anuncio CTWA activo** (~1–5 USD/día, se pausa apenas entre el mensaje). Eso queda como ticket aparte: *Verificar `referral` con un anuncio CTWA real*.
