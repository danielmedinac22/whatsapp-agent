# Investigación — ¿Kapso entrega `referral` en el webhook?

Ticket: [`../issues/01-referral-kapso.md`](../issues/01-referral-kapso.md)
Fecha: 2026-08-15
Fuentes: documentación oficial de Meta y de Kapso, las tres specs OpenAPI de Kapso, y Logs reales de la cuenta de producción (solo lectura).

---

## Respuesta corta

**Sí — la documentación oficial de Kapso afirma que `referral` viene incluido en el payload de `message.received`. No es un bloqueante duro.**

Kapso lanzó soporte de CTWA el **30 de diciembre de 2025** (changelog) y su página de datos de WhatsApp lista los campos exactos que captura: `source_type`, `source_id`, `source_url`, `ctwa_clid`, `headline`, `body`, `media_type` — es decir, **todo lo que el PRD necesita**, incluido `source_id`, que es el ID del anuncio.

**Pero la afirmación no está respaldada por el resto de la documentación, y no pudimos verificarla empíricamente.** El nombre y la ruta exacta del campo (`message.referral`? `message.kapso.referral`?) **no aparecen documentados en ningún lado**: ni en la referencia del webhook —a la que la propia página de CTWA enlaza—, ni en ninguna de las tres specs OpenAPI. Y esta cuenta **no tiene tráfico CTWA** con el cual comprobarlo (0 eventos con `referral` en 7 días, la ventana máxima de la API de Logs).

**Si resultara que no llega, existe una vía garantizada:** un webhook con `kind: "meta"`, que según Kapso *"forward the exact payload received from Meta, without modification"*. Probamos que Kapso efectivamente conserva el sobre crudo de Meta íntegro.

**Recomendación:** no tratarlo como bloqueante, pero **no darlo por hecho tampoco**. Es una verificación de ~15 minutos que exige un (1) clic real en un anuncio CTWA. Ver [§3](#3-cómo-verificarlo-empíricamente-en-15-minutos).

---

## 0. Qué manda Meta upstream (línea base)

Documentación oficial: [referencia del webhook de mensajes de texto](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text). *(Las URLs viejas `/docs/whatsapp/cloud-api/webhooks/components` y `/payload-examples` ahora redirigen a una página genérica sin contenido de referral; Meta reorganizó la doc y ahora el objeto está documentado **por tipo de mensaje**.)*

**Ubicación:** `entry[].changes[].value.messages[].referral` — hermano de `from`, `id`, `timestamp`, `type`. Viaja en el campo `messages`, **la misma suscripción que ya recibimos**; no hay una suscripción aparte para referral.

Ejemplo real de Meta (verbatim de la doc, mensaje de texto originado en un anuncio CTWA):

```json
"messages": [{
  "referral": {
    "source_url": "https://fb.me/3cr4Wqqkv",
    "source_id": "120226305854810726",
    "source_type": "ad",
    "body": "Summer Succulents are here!",
    "headline": "Chat with us",
    "media_type": "image",
    "image_url": "https://scontent.xx.fbcdn.net/v/t45.1...",
    "ctwa_clid": "Aff-n8ZTODiE79d22KtAwQKj9e_mIEOOj27vDVwFjN80dp4_0NiNhEgpGo0AHemvuSoif…",
    "welcome_message": { "text": "Hi there! Let us know how we can help!" }
  },
  "from": "16505551234",
  "id": "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUQ0N0VFMDA2MTQ0RkJFNkNDNAA=",
  "timestamp": "1750275992",
  "text": { "body": "Can I get more info about this?" },
  "type": "text"
}]
```

| Campo | Descripción de Meta | ¿Siempre? |
|---|---|---|
| `source_id` | **"Click to WhatsApp ad ID"** — el ID del **anuncio** (no de campaña ni ad-set) | sí |
| `source_url` | URL del anuncio (`https://fb.me/…`) | sí |
| `source_type` | `"ad"` en todas las plantillas actuales | sí |
| `headline` | Titular del anuncio | sí |
| `body` | Texto principal del anuncio | sí |
| `media_type` | `image` o `video` | sí |
| `image_url` / `video_url` / `thumbnail_url` | solo según el tipo de anuncio | opcional |
| `ctwa_clid` | ID único de clic, para la Conversions API | opcional (se omite en anuncios de WhatsApp Status) |
| `welcome_message.text` | Texto de saludo del anuncio | sí |

Puntos que importan para el diseño:

- **`source_id` es literalmente el ID del anuncio.** El reconocimiento por ad-id del §6 del PRD es viable siempre que el dato llegue.
- Meta lo adjunta *"only included if message sent via a Click to WhatsApp ad"*.
- **`referral` NO figura en la referencia de `/messages/interactive`.** Las respuestas de botón y de lista —justo lo que usa nuestro flujo de confirmación— no traen atribución.
- **"Solo llega en el primer mensaje" es una inferencia razonable, no una cita de Meta.** La doc oficial **no** lo afirma en ninguna parte. Lo más fuerte que dice Meta está en la Conversions API: *"Upon receiving the `ctwa_clid`, **store it with the conversation**"* — instrucción que no tendría sentido si llegara en cada mensaje. Las fuentes que lo afirman de plano son de terceros. **Tratarlo como supuesto de ingeniería seguro, sin citarlo como hecho documentado.** Consecuencia práctica: persistir la atribución en el contacto/conversación al primer contacto, nunca leerla por mensaje.
- **No hay ninguna ventana de tiempo documentada.** Las "72 horas" que aparecen en búsquedas son la ventana de *free entry point* de la tarificación por conversación (hoy deprecada), un asunto de facturación sin relación con la atribución.

---

## 1. ¿Kapso pasa `referral`?

### 1.1 Lo que Kapso afirma — sí, y con los campos que necesitamos

Página oficial: **https://docs.kapso.ai/docs/platform/whatsapp-data**. Es el **único** lugar en toda la documentación de Kapso donde aparece la palabra `referral` (verificado descargando el corpus completo `llms-full.txt`, 595 KB, y grepeando).

Verbatim:

```
| Data             | Dashboard | Webhooks | WhatsApp API | Platform API |
| Referrals (CTWA) | Yes       | Yes      | -            | -            |
```

> ## Referrals (CTWA)
>
> Click-to-WhatsApp ad data captured when users message from Meta ads.
>
> **Fields**: source_type (ad/post/organic), source_id, source_url, ctwa_clid, headline, body, media_type
>
> **Access**:
> * Dashboard: WhatsApp > Data > Ads (CTWA)
> * Webhooks: Included in `message.received` payload when present

Y el [changelog](https://docs.kapso.ai/changelog), entrada del **30 de diciembre de 2025**:

> **WhatsApp Ads tracking (CTWA)**: New tracking and analytics for Click-to-WhatsApp campaigns. When users start conversations through Meta ads or click-to-WhatsApp buttons, Kapso now automatically captures referral data including: Ad headline, body, and media; Campaign source and click ID (ctwa_clid); Custom reference parameters. View all referrals in the new "Ads (CTWA)" section under your WhatsApp project. Filter by date range and export to CSV for deeper analysis. Conversations with referral data now show a "CTWA" badge in the inbox for quick identification.

Dos detalles útiles: el `source_type` de Kapso admite **`organic`** además de `ad`/`post` (valor propio, Meta solo documenta `ad` y `post`), y *"Custom reference parameters"* corresponde al campo `ref` de Meta.

### 1.2 Lo que contradice esa afirmación — el resto de la doc está en silencio

- **`referral` no aparece en ninguna de las tres specs OpenAPI** (700 KB en total). El esquema `WhatsappMessage` —que Kapso describe como *"mirrors Meta's webhook payload format"*— enumera 25 propiedades (`id, timestamp, type, from, from_user_id, from_parent_user_id, to, to_user_id, to_parent_user_id, username, context, text, image, video, audio, document, location, sticker, interactive, button, template, reaction, contacts, order, kapso`) y **ninguna es `referral`**. Cubre hasta `order`, `sticker` y `reaction`.
- **La referencia del webhook tampoco lo menciona.** La página `docs/platform/webhooks/message-events` —a la que **enlaza la propia página de CTWA**— muestra un ejemplo de `whatsapp.message.received` sin `referral`. Lo mismo el skill local [`webhooks-event-types.md`](../../../.agents/skills/integrate-whatsapp/references/webhooks-event-types.md).
- **El sub-objeto `kapso` no tiene comodín.** Sus campos son una lista cerrada (`direction`, `status`, `processing_status`, `origin`, `has_media`, `media_url`, `contact_name`, …). No hay `raw_payload`, `meta_payload` ni `metadata` en ninguna spec.
- **No existe endpoint de API para CTWA.** Ni `/whatsapp/ads` ni `/whatsapp/referrals`. Coherente con la tabla de Kapso, que marca `-` para WhatsApp API y Platform API: los referrals solo salen por Dashboard y Webhooks.
- Los tres skills locales de Kapso (`integrate-whatsapp`, `observe-whatsapp`, `automate-whatsapp`) dan **cero** resultados para `referral|ctwa|source_id|source_url`.

**Lectura más probable:** el soporte CTWA se lanzó el 30-dic-2025 y **la referencia del webhook y las specs OpenAPI no se actualizaron**. Es un desfase de documentación, no necesariamente una contradicción de comportamiento. Pero significa que **el nombre y la ruta exacta del campo son un dato desconocido** hasta verlo en un payload real.

### 1.3 Evidencia empírica de los Logs de producción

Consultamos los Logs reales de la cuenta (solo lectura, `GET /platform/v1/log_search`).

**a) Kapso recibe y conserva el sobre crudo de Meta, íntegro.** Los eventos `source=whatsapp_webhook_event` traen `payload.raw_payload` con el sobre completo:

```json
{"raw_payload": {"object": "whatsapp_business_account",
  "entry": [{"id": "1676368750161510", "changes": [{"field": "messages", "value": {
    "messaging_product": "whatsapp",
    "metadata": {"display_phone_number": "…", "phone_number_id": "1226267277233200"},
    "contacts": [{"profile": {"name": "…"}, "wa_id": "…", "user_id": "GT.…"}],
    "messages": [{"from": "…", "from_user_id": "GT.…", "id": "wamid.…",
                  "timestamp": "1786806459", "text": {"body": "…"}, "type": "text"}]
  }}]}]}}
```

Es la estructura canónica de Meta, y **es un passthrough textual**: contiene campos que la doc normalizada de Kapso ni siquiera modela (`from_user_id`, `contacts[].user_id`, `business_scoped_user_id`, `pricing.type`). Un `referral` caería aquí sin problema.

**b) El webhook normalizado sí recorta campos.** Los eventos `source=webhook_delivery` guardan `payload.request_body`: **el body exacto que Kapso POSTeó a nuestro worker**. Comparando, para el mismo `wamid`:

| | Campos del objeto `messages[0]` / `message` |
|---|---|
| Meta → Kapso (`raw_payload`) | `from`, **`from_user_id`**, `id`, `text`, `timestamp`, `type` |
| Kapso → nuestro worker (`request_body`) | `from`, `id`, `text`, `timestamp`, `type` |

**`from_user_id` desapareció** — y es un campo que Kapso *sí* modela en `WhatsappMessage`. O sea: el serializador del webhook **no es un passthrough**, arma un objeto curado campo por campo, y su lista de campos no coincide ni con la de Meta ni con la del propio esquema de Kapso. Por eso la afirmación de §1.1 no se puede dar por buena sin verla: `referral` podría estar en la lista de inclusión (agregado en dic-2025) o podría no estarlo.

**c) No hay tráfico CTWA en esta cuenta.** Búsqueda libre de `referral` en 7 días, todas las fuentes → **0 eventos**. La API de Logs solo admite `24h`, `7d` o `context`, así que no se puede mirar más atrás. **La ausencia aquí no prueba nada** sobre si Kapso lo reenvía: simplemente nadie ha entrado por un anuncio.

### 1.4 Qué pasaría hoy en nuestro lado, aun si llegara

La configuración real de la cuenta (`GET /whatsapp/webhooks`) es `kind: "kapso"`, `payload_version: v2`, sobre `phone_number_id 1226267277233200`.

Aunque Kapso nos mandara `referral`, **hoy lo tiraríamos tres veces**:

- [`apps/worker/src/kapso/inbound.ts`](../../../apps/worker/src/kapso/inbound.ts) — `parseInboundMessage()` normaliza a `ParsedInboundMessage`, un tipo cerrado sin campo de atribución. Todo lo no declarado se descarta.
- [`apps/worker/src/inbound/pipeline.ts`](../../../apps/worker/src/inbound/pipeline.ts) — `handleInbound()` solo recibe ese tipo ya recortado.
- [`packages/db/src/schema.ts:206`](../../../packages/db/src/schema.ts) — `webhook_events` guarda solo `source`, `event_id`, `event`, `received_at`. **No persistimos el body crudo**, así que no hay forma de auditar hacia atrás lo ya recibido.

El buen dato: [`apps/worker/src/routes/kapso.ts:26`](../../../apps/worker/src/routes/kapso.ts) ya tiene el body crudo en memoria (`const raw = await c.req.text()`, necesario para el HMAC). Capturar `referral` es leerlo antes de parsear — no hay que rediseñar el ingreso.

---

## 2. Vías alternativas si el webhook normalizado no lo trae

### Vía A — Webhook `kind: "meta"` (la garantía)

De [docs.kapso.ai/docs/platform/webhooks/overview](https://docs.kapso.ai/docs/platform/webhooks/overview):

> #### Meta webhooks
> Receive the exact payload Meta sends. No event filtering, no buffering - just raw Meta webhook forwarding with an idempotency key for deduplication.

> **Meta webhooks forward the exact payload received from Meta, without modification.**

Esto, más nuestra comprobación de que el `raw_payload` que Kapso almacena es textual, hace de la Vía A una garantía sólida.

```bash
POST https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/{phone_number_id}/webhooks
{"whatsapp_webhook": {"url": "https://…", "kind": "meta", "secret_key": "…", "active": true}}
```

Restricciones que impone la spec:

- **`kind` no se puede cambiar después de crear** (*"Webhook type (cannot be changed after creation)"*) → hay que **crear uno nuevo**, no editar el actual.
- `events` va **vacío** para `meta` (llega todo, sin filtrar).
- **Sin buffering**; `payload_version` no aplica.
- **Solo un webhook `meta` por número.**
- `secret_key` se acepta al crear, **pero la lista de headers documentada para modo meta no incluye `X-Webhook-Signature`** (solo `X-Idempotency-Key`). **La verificación de firma en modo meta no está documentada** — hay que comprobar en la práctica si firma, antes de asumir que nuestro `verifyKapsoSignature` sirve tal cual.

Diseño recomendado: **convivencia**. El sobre crudo de Meta **no** trae los extras de Kapso que ya usamos (`kapso.transcript` para audios, `kapso.media_url`, `contact_name`, `is_new_conversation`). Conviene dejar el webhook `kapso` como está —el pipeline de postventa no se toca— y **añadir** el `meta` en una ruta nueva dedicada solo a extraer y persistir la atribución, casando por `wamid`. Así ventas gana `referral` sin poner en riesgo lo que ya está en producción.

### Vía B — Dashboard "Ads (CTWA)" + export CSV

Kapso tiene una sección **WhatsApp > Data > Ads (CTWA)** con filtro por fechas y export a CSV, y marca las conversaciones con un badge "CTWA" en el inbox. **Sirve para validar** que la captura funciona (y para una operación manual temprana), pero **no como fuente de producción**: es manual y no tiene API.

### Vía C — Leer el `referral` desde los Logs

`GET /log_search?source=whatsapp_webhook_event` devuelve `payload.raw_payload`. Excelente para **verificar y auditar**, inservible como fuente de producción: ventana máxima de 7 días, es pull en vez de push, y depende de que la cuenta tenga Logs + Elasticsearch habilitados.

### Vía D — Conectar el número directo a Meta, sin Kapso — descartada

Resolvería el problema de raíz pero tira la integración entera (plantillas, media, transcripción, estados). Desproporcionado, y la Vía A entrega lo mismo.

---

## 3. Cómo verificarlo empíricamente en 15 minutos

No hace falta escribir código: los Logs ya guardan **las dos mitades** de la respuesta (lo que Meta mandó y lo que Kapso nos reenvió). Los comandos de abajo **ya se ejecutaron hoy** contra la cuenta real en modo lectura y funcionan; lo único que faltó fue tráfico CTWA que observar.

**Requisito previo (lo caro, no lo lento):** un anuncio Click-to-WhatsApp activo apuntando al número, y un clic desde un teléfono de prueba. Se puede con presupuesto mínimo (~1–5 USD/día) y pausarlo apenas llegue el mensaje. **Es la única parte fuera de nuestro control y la que marca el reloj.**

**Paso 1 — ¿Meta lo manda y Kapso lo guarda? (≈2 min)**

```bash
set -a && . .env && set +a
curl -sS -G "https://api.kapso.ai/platform/v1/log_search" \
  --data-urlencode "query=referral" \
  --data-urlencode "period=24h" \
  --data-urlencode "source=whatsapp_webhook_event" \
  -H "X-API-Key: $KAPSO_API_KEY" | jq '.data.events[].payload.raw_payload'
```

Si aparece `messages[0].referral` con `source_id`/`headline`/`body`/`source_url` → confirmado del lado de Meta. Anotar el `wamid`.

**Paso 2 — ¿Kapso nos lo reenvía? (≈2 min) — este es el paso que decide el ticket.**

```bash
curl -sS -G "https://api.kapso.ai/platform/v1/log_search" \
  --data-urlencode "query=<el-wamid-del-paso-1>" \
  --data-urlencode "period=24h" \
  --data-urlencode "source=webhook_delivery" \
  -H "X-API-Key: $KAPSO_API_KEY" | jq '.data.events[].payload.request_body'
```

Muestra el body exacto que Kapso POSTeó a nuestro worker para ese mensaje.

- Si aparece `referral` → **la afirmación de la doc es cierta**; queda además fijada la ruta exacta del campo (el dato que hoy falta) y no hay que cambiar la configuración.
- Si no aparece → **queda demostrado el descarte**, comparando lado a lado contra el `raw_payload` del paso 1, y se pasa a la Vía A.

**Paso 3 — Solo si el paso 2 sale negativo: confirmar la Vía A (≈10 min).** Crear un webhook `kind: "meta"` apuntando a un bin público y repetir el clic:

```bash
curl -sS -X POST "https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/1226267277233200/webhooks" \
  -H "X-API-Key: $KAPSO_API_KEY" -H "Content-Type: application/json" \
  -d '{"whatsapp_webhook":{"url":"https://webhook.site/<id>","kind":"meta","active":true}}'
```

Apuntar a un bin externo (y no al worker) evita tocar producción; se borra al terminar. De paso, revisar si la entrega trae `X-Webhook-Signature` — eso resuelve la duda de firma de §2.

**Atajo sin gastar en anuncios:** el Dashboard de Kapso (**WhatsApp > Data > Ads (CTWA)**) muestra los referrals capturados. Si Vorare ya corrió anuncios CTWA en este número alguna vez, ahí habría histórico —sin límite de 7 días— y sirve para confirmar la captura sin pagar pauta nueva. No sustituye al paso 2, que es el único que prueba el **reenvío**.

---

## 4. Qué significa esto para el módulo de ventas

- **No es un bloqueante de proveedor.** Meta manda `referral`, Kapso lo captura, lo muestra en su dashboard y afirma incluirlo en el webhook. El §11 del PRD puede dejar de tratarlo como riesgo existencial.
- **Sí es un supuesto pendiente de confirmar.** Un paso de 15 minutos (más un clic de anuncio) convierte "probablemente" en "sí". Conviene hacerlo **antes** de comprometer el nivel 1 de la cascada del §6.
- **Hay trabajo real en cualquiera de los dos escenarios.** En el mejor caso: extender `KapsoInboundPayload`/`ParsedInboundMessage`, persistir la atribución y mapear `source_id` → producto. En el peor: además un segundo webhook (`kind: "meta"`), ruta nueva, verificación de firma y casar por `wamid`. Ninguno es "un campo más".
- **La atribución se persiste una sola vez, en el primer contacto.** No llega en respuestas interactivas y —con alta probabilidad— no se repite en mensajes siguientes.
- **Alimenta el ticket [`02-reconocimiento-de-producto.md`](../issues/02-reconocimiento-de-producto.md):** el camino del ad-id es viable; su costo real depende del resultado del paso 2.

---

## Fuentes

**Meta (oficial)**
- [Webhook de mensajes de texto — objeto `referral`](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text) — sintaxis, tabla de campos y ejemplo CTWA real
- [Conversions API for Business Messaging](https://developers.facebook.com/documentation/ads-commerce/conversions-api/business-messaging) — semántica de `ctwa_clid`
- [CTWA welcome message sequences](https://developers.facebook.com/documentation/business-messaging/whatsapp/ctwa/welcome-message-sequences) — única página viva con `source_type: "ad or post"` y el campo `ref`

**Kapso (oficial)**
- **https://docs.kapso.ai/docs/platform/whatsapp-data** — *"Referrals (CTWA) … Included in `message.received` payload when present"* (la fuente clave)
- [Changelog, 30-dic-2025](https://docs.kapso.ai/changelog) — lanzamiento de WhatsApp Ads tracking (CTWA)
- [Webhooks overview](https://docs.kapso.ai/docs/platform/webhooks/overview) — *"Meta webhooks forward the exact payload received from Meta, without modification"*
- Specs OpenAPI (descargadas y grepeadas el 2026-08-15): [platform](https://docs.kapso.ai/api/platform/v1/openapi-platform.yaml) · [whatsapp](https://docs.kapso.ai/api/meta/whatsapp/openapi-whatsapp.yaml) · [workflows](https://docs.kapso.ai/api/platform/v1/openapi-workflows.yaml) — **cero menciones de `referral`**
- Corpus completo de docs: https://docs.kapso.ai/llms-full.txt

**Logs de la cuenta de producción** (solo lectura, `GET /platform/v1/log_search`)
- `source=whatsapp_webhook_event` → `payload.raw_payload` (sobre crudo de Meta)
- `source=webhook_delivery` → `payload.request_body` (lo que Kapso nos POSTea)

**Skills locales**
- `.agents/skills/integrate-whatsapp/` — `references/webhooks-overview.md`, `references/webhooks-event-types.md`, `SKILL.md` (flag `--kind <kapso|meta>`)
- `.agents/skills/observe-whatsapp/SKILL.md` — búsqueda de Logs

**Código del repo**
- `apps/worker/src/routes/kapso.ts` · `apps/worker/src/kapso/inbound.ts` · `apps/worker/src/inbound/pipeline.ts` · `packages/db/src/schema.ts`
