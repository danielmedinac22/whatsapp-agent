---
name: el-panel-no-ve-caerse-al-agente
description: "El contador de «sin responder» exige agent_mode=false, así que una caída del agente es justo el escenario que no puede ver"
metadata: 
  node_type: memory
  type: project
  originSessionId: dccd7638-ff78-4c6c-ae85-6fd49906dc9c
  modified: 2026-08-23T00:04:19.371Z
---

`sinResponder` (en `packages/db/src/sin-responder.ts`) empieza por descartar todo contacto con `agent_mode = true`: si el agente lleva la conversación, no espera a una persona. La regla es correcta y está bien argumentada.

**Pero eso vuelve al panel ciego exactamente cuando el agente se cae.** El 21-ago-2026 el agente de Guatemala estuvo 25 horas sin contestar y el contador nunca se movió: las conversaciones represadas eran las que el agente llevaba, o sea las que la regla descarta de entrada. Nos enteramos porque el cliente escribió por WhatsApp preguntando «¿por qué no está respondiendo la IA?», no por el panel.

**Why:** un contador de pendientes que asume que el agente funciona no vigila al agente, lo supone. Las dos únicas señales que sí lo habrían visto son las filas de `agent_runs` con `error` y la ausencia de salientes con `source = 'agent'`, y nadie mira ninguna de las dos.

**How to apply:**

- **Para medir un represado, no uses `sinResponder`.** Su precondición te va a esconder justo el caso. La pregunta es otra: ¿entró algo, y salió algo después? El inventario está en `scripts/represados-de-la-caida.ts`.
- **Salió algo ≠ le contestamos, pero tampoco es silencio.** De 37 conversaciones con la pelota nuestra, 19 habían recibido un `confirmation_ack` a segundo y medio de que el cliente pulsara el botón de la plantilla. Ese lazo ya se cerró; contestarlas otra vez es duplicar. El represado real eran 14, no 90.
- **Los ecos salientes se descartan** (`apps/worker/src/kapso/inbound.ts:372` corta todo lo que no sea `direction: "inbound"`), así que una respuesta escrita desde la app de WhatsApp **no existe para el sistema**. Cruzá también por `to_wa_id` y por el espejo en `messages`, no solo por `conversation_id`. Preguntando por las tres puertas el número bajó de 39 a 37.
- **El banco de pruebas genera prosa, no escala.** `POST /api/agent/prompt/preview` devuelve el texto y nada más. Si esa respuesta dice «ya paso tu caso a un asesor» y la mandás tal cual, el cliente recibe una promesa que nadie va a cumplir: quien apaga `agent_mode` y avisa al admin es `escalateToHuman`, y hay que llamarlo aparte.

Ver [[la-bandeja-definida-por-resta]], [[contar-sobre-lo-cargado-miente]], [[el-outbox-no-sabe-de-que-conversacion-es]], [[no-romper-guatemala]].
