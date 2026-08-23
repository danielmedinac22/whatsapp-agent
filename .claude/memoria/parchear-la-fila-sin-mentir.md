---
name: parchear-la-fila-sin-mentir
description: En la bandeja, reescribir una fila en memoria miente si no se toca lo derivado (sinResponder) — y el efecto de resincronía deshacía el parche
metadata:
  type: project
---

Al sacar los tres `location.reload()` del Inbox (20-ago-2026, PRO-5) aparecieron
dos trampas que el compilador no ve y que valen para los tickets que siguen
sobre el mismo archivo (PRO-11 y los otros tres specs del panel):

1. **`sinResponder` es derivado y el cliente no lo puede recalcular.** Lo decide
   `sinResponder()` en `@wa/db`: da `false` en cuanto `agentMode` está encendido
   o hay alguien asignado, y para lo demás necesita la escalada y la actividad,
   que `ChatItem` no trae. Un parche que solo escribe `agentMode` deja la fila
   contada en la vista «Sin responder». Se parchea **solo en la dirección
   segura** (prender el agente o tomar la conversación la sacan, con certeza) y
   para el resto va `router.refresh()`.
2. **`router.refresh()` no destruye nada**; el `location.reload()` sí. Está
   medido: las `key` son estables, React reutiliza los `<li>`, el borrador y el
   scroll sobreviven. Combinar parche (respuesta inmediata) + refresh (verdad)
   es el patrón que quedó.

**Why:** el modo agente es del **contacto**, no de la conversación, así que
también hay que parchear todas las filas del mismo `contactId` — cosa que el
`reload` hacía gratis y un parche por id pierde.

**How to apply:** antes de parchear una fila en `inbox-client.tsx`, preguntá qué
campos del servidor dependen del que estás cambiando. Si no los podés calcular
con lo que trae `ChatItem`, no los inventes: dejalos y disparalos con
`router.refresh()`. Relacionado: [[lo-que-vacia-de-significado-no-lo-ve-el-tipado]],
[[la-bandeja-definida-por-resta]].
