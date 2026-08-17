# 05 — La configuración de agente cuelga de la operación

**What to build:** Cada operación tiene su propia configuración de agentes: su prompt, su modelo, sus plantillas, sus tiempos. Cambiar el tono en Guatemala no toca Colombia.

Cuarto y mayor lote: sesenta y cinco referencias en quince archivos. Es el de mayor radio, así que va de último y conviene partirlo por área si no logra quedar verde de una.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] La configuración de agente declara a qué operación pertenece.
- [ ] Cada lectura de configuración indica de qué operación la quiere.
- [ ] Las plantillas y los tiempos de seguimiento son por operación.
- [ ] Los sesenta y cinco llamadores existentes pasan a resolver por operación.
- [ ] **La configuración de una operación nunca se aplica a otra**, y hay test que lo demuestra.
- [ ] El comportamiento de la operación de Guatemala no cambia.

## Medido contra el código (16-ago-2026)

**No hay accesor que parametrizar: hay que crearlo.** El criterio «cada lectura de configuración indica de qué operación la quiere» supone un `getSettings()` que no existe en el worker. Lo que hay son **quince lecturas inline** —`.from(agentSettings).where(eq(agentSettings.id, 1))`— repartidas por nueve archivos, más dos `getSettings()` locales duplicados dentro de `jobs/dropi-confirm.ts:15` y `jobs/dropi-sync.ts:185`, cada uno privado de su archivo.

Eso ordena el ticket en dos pasos, y el primero no es opcional:

1. **Un solo accesor** que reciba la operación, con su tipo de retorno. Ahí mueren los dos `getSettings()` duplicados.
2. **Las quince lecturas pasan por él.**

Archivos con lecturas inline: `agent/runner.ts` · `agent/preview.ts` · `jobs/followup.ts` · `jobs/confirmation-ack.ts` · `jobs/dropi-confirm.ts` · `jobs/dropi-poll.ts` (dos) · `jobs/dropi-sync.ts` · `jobs/dropi-novedad-notify.ts` · `dropi/seed-templates.ts` · `routes/agent.ts` · `routes/shopify.ts` · y `apps/web/src/lib/queries.ts:223` (`getAgentSettings()`, el único que sí era accesor, del lado web).

**No toques `apps/worker/src/dropi/notify.ts`.** Es del worktree del ticket 04, que corre en paralelo. Su uso de `agentSettings` es solo anotación de tipo en las líneas 41 y 194 — recibe la configuración por parámetro, no la lee — así que su firma no cambia con este ticket.

**Cuidado con `jobs/followup.ts`.** Es el archivo del riesgo R1 del `no-regresion.md`: su heurístico de «el cliente ya respondió» marca el pedido confirmado y activa el modo agente. Aquí solo se cambia **de dónde sale la configuración**, no el heurístico. Cambiarlo es responsabilidad de `ventas-cierre-orden 05`, y hacerlo de paso auto-confirmaría pedidos sin verificar dirección.

**Producción:** 1 fila, `openai/gpt-5.4-mini`, prompt de 7.728 caracteres, `dropi_enabled: true`, `dropi_dry_run: true`, con seis plantillas de logística referenciadas por FK. Esas FK a `templates` son por operación en cuanto haya dos: **no las conviertas en globales al mover la configuración.**

Sesenta y cinco eran menciones del símbolo, no llamadas. El lote sigue siendo el de mayor radio —nueve archivos del worker más uno de web— pero son quince lecturas, no sesenta y cinco. Si aun así no queda verde de una, pártelo: primero `agent/*` y `routes/*`, después `jobs/*`.
