# 02 — Constructor del evento de conversión

**What to build:** Dado un pedido cerrado, su atribución persistida y su operación, sale el evento de compra listo para enviar a Meta — con el valor, la moneda y el píxel correctos.

Función pura, mismo patrón que el constructor de orden del spec de cierre: arma un payload externo con llave de deduplicación estable.

**Blocked by:** 01

**Status:** hecho — worktree `capi-evento`, migración `0023` aplicada a producción el 17-ago-2026. `apps/worker/src/capi/purchase-event.ts` + 31 tests.

- [x] El evento lleva **valor y moneda de la operación** — quetzales o pesos, sin valor por defecto. Sin el valor, Meta optimiza hacia cantidad de ventas en vez de hacia ingreso.
- [x] El píxel se resuelve **desde la operación**, nunca desde una constante. — **Corregido por medición: no es un píxel, es un `dataset`.** Ver abajo.
- [x] La llave de deduplicación se deriva del pedido, no del momento: dos construcciones del mismo pedido dan la misma llave. Va **al lado** del evento y no dentro: Meta no deduplica este flujo.
- [x] **Un pedido sin identificador de clic no genera evento**, en vez de generar uno anónimo. `{ kind: "no-event", reason: "no-click-id" }` es una forma legítima del resultado, no un `null`.
- [x] La forma exacta del evento queda confirmada contra la documentación vigente de Meta — el flujo de conversiones para anuncios de clic a WhatsApp tiene su propio origen de acción y cambia entre versiones.
- [x] Los tests cubren cada caso anterior.

## Lo que la medición corrigió del ticket

**El destino no es el píxel publicitario.** Las conversiones de anuncios de clic a WhatsApp van por *Conversions API for Business Messaging*, cuyo destino es un **dataset** creado desde la cuenta de WhatsApp (`POST /{whatsapp_business_account_id}/dataset`; el `GET` devuelve el que ya exista) y al que se postea en `POST /v{VERSION}/{dataset_id}/events`. El id del píxel de la cuenta (`1825130408114773`, «Pixel Vorare Guatemala») **no es ese valor**. Por eso la columna de la `0023` se llama `operations.capi_dataset_id`, y por eso **sigue en `NULL`**: hay que leer el dataset real de la cuenta antes de configurarlo desde el panel.

**El evento necesita un cuarto dato que el ticket no nombraba:** `user_data.whatsapp_business_account_id`. No hizo falta columna nueva — es `kapso_connection.business_account_id`, que desde la `0021` es una fila por operación (`1676368750161510` en Guatemala).

**Meta no deduplica este flujo.** La documentación es explícita: *«Meta does not assist with deduplicating events for Conversions API for Business Messaging»*. La llave de deduplicación es nuestra y la aplica la cola del ticket 03; no viaja como `event_id` dentro del evento porque la forma documentada de este flujo no lista ese campo.

**Fuentes** (consultadas el 17-ago-2026):
- <https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/>
- <https://developers.facebook.com/documentation/ads-commerce/conversions-api/business-messaging>
- <https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters> — `ctwa_clid`: «Do not hash»

**Versión de la API:** los ejemplos de esas páginas están congelados en `v16.0`; la vigente es `v26.0` (anunciada el 29-jul-2026). La versión es parte de la URL y la elige quien envía (ticket 03) — este módulo no arma URLs.

## Lo que sigue bloqueado

El token no trae `whatsapp_business_manage_events`, que además requiere **acceso avanzado** (solicitud a Meta, no solo un scope más en el token). Sin él no se puede enviar nada: es el ticket 03.
