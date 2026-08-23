---
name: contar-sobre-lo-cargado-miente
description: El Inbox carga 200 filas que cubren 5 días; todo contador calculado en el cliente sobre esa lista dice casi cero
metadata:
  type: project
---

`listConversations` trae las **200 conversaciones más recientes por actividad**, y
en Guatemala esas 200 cubren **cinco días** (medido el 20-ago-2026: 15→20 de
agosto) y solo **una** tiene el agente apagado. Cualquier contador que
`inbox-client.tsx` calcule sobre `items` cuenta sobre esa rodaja.

Por eso la tarjeta «Necesita atención» mostraba **0** mientras la base tenía 90
conversaciones que cumplían su regla: nadie lo notó porque el número era
plausible.

**Why:** al medir una regla nueva contra la base da un número, y en pantalla se
ve otro. Los dos son «el número» y la diferencia no es un bug de la regla: es el
corte de la lista.

**How to apply:** un contador que quiera decir la verdad se calcula en el
servidor sobre todas las conversaciones de la operación, y la lista tiene que
**traer también** las filas que cuenta —si no, la tarjeta dice 35 y el filtro
muestra 1—. Ver `loadSinResponderIds` y la unión en `listConversations`.
Relacionado: [[la-bandeja-definida-por-resta]].
