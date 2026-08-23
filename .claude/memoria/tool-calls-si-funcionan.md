---
name: tool-calls-si-funcionan
description: Medido — las tool calls SÍ llegan al proveedor por el camino de este repo, al revés que reasoning_effort
metadata:
  type: project
---

**Las tool calls funcionan** por el camino de `apps/worker/src/agent/`
(`@openrouter/ai-sdk-provider` 6.0.0-alpha.1 + `ai` 6.x) con el modelo de
producción `openai/gpt-5.4-mini`. Medido el 18-ago-2026 con una llamada real:
la herramienta llega, el modelo la llama con los campos completos, `execute()`
corre y el modelo toma un turno más con el resultado. Cero warnings del SDK.

En el `doGenerate` del proveedor, `tools` y `toolChoice` **sí** están en la lista
fija de campos que arma el cuerpo de la petición — la misma lista que **descarta**
`providerOptions`, que es por lo que `reasoning_effort` no hace nada.

**Why:** el mapa del proyecto decía que el agente corre «sin prompt caching ni
tool calls», y con el antecedente de `reasoning_effort` lo razonable era
desconfiar. Desconfiar estaba bien; concluir que no funcionan, no.

**How to apply:** no hace falta volver a medirlo para construir sobre tool
calling. Sí hace falta si se cambia de proveedor o se sale de alpha.

**El hallazgo que vale más que el veredicto:** al recibir el resultado de una
herramienta, el modelo redacta por su cuenta «tu pedido quedó registrado
correctamente». Si el resultado no fue un éxito —modo seco, cierre encolado— eso
es mentirle al cliente. La defensa que quedó es no mandar su texto en un turno
donde el cierre habló, no pedirle en el prompt que no lo diga. Ver
[[panel-de-ventas-estado]] y [[no-romper-guatemala]].
