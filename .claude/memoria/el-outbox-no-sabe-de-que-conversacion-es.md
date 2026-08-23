---
name: el-outbox-no-sabe-de-que-conversacion-es
description: outbound_messages.conversation_id está en null en 316 de los 352 salientes manuales; la clave que sirve es to_wa_id
metadata:
  type: reference
---

En producción (20-ago-2026), `outbound_messages.conversation_id`:

- `manual`: **316 de 352 en `null`** — los que escribe una persona desde el panel.
- `dropi_2fa` (5.979) y `escalation` (93): todos en `null`.
- `agent`, `followup`, `remarketing`, `confirmation_ack`, `dropi_status`: completos.

**Why:** agrupar salientes por `conversation_id` para preguntar «¿contestamos?»
cuenta como «nadie contestó» justo las respuestas humanas. Así se calculó el «39»
del ticket 03, que en realidad era 35: cuatro conversaciones con una respuesta
`manual` visible.

**How to apply:** cruzar `outbound_messages` por **`to_wa_id`** contra
`contacts.wa_id`, que es único en toda la base. `loadEscalationsByWaId` ya lo
hacía y explica por qué. Para acotar por operación —la tabla no lleva
`operation_id`— está `waIdOfOperation` en `apps/web/src/lib/operation-scope.ts`.
