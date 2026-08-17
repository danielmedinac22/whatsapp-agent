# 05 — La configuración de agente cuelga de la operación

**What to build:** Cada operación tiene su propia configuración de agentes: su prompt, su modelo, sus plantillas, sus tiempos. Cambiar el tono en Guatemala no toca Colombia.

Cuarto y mayor lote: sesenta y cinco referencias en quince archivos. Es el de mayor radio, así que va de último y conviene partirlo por área si no logra quedar verde de una.

**Blocked by:** 01

**Status:** resolved — worktree `op-05-agent-settings`, tanda del 16-ago-2026

- [x] La configuración de agente declara a qué operación pertenece.
- [x] Cada lectura de configuración indica de qué operación la quiere.
- [x] Las plantillas y los tiempos de seguimiento son por operación.
- [x] Los sesenta y cinco llamadores existentes pasan a resolver por operación.
- [x] **La configuración de una operación nunca se aplica a otra**, y hay test que lo demuestra.
- [x] El comportamiento de la operación de Guatemala no cambia.

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

## Answer

### Qué se construyó

Un accesor único, en `packages/db/src/agent-settings.ts`, exportado por `@wa/db`:

```ts
type AgentSettingsScope =
  | { readonly kind: "operation"; readonly operationId: string }
  | { readonly kind: "global" };

const GLOBAL_AGENT_SETTINGS_ID = 1;
const GLOBAL_AGENT_SETTINGS: AgentSettingsScope;

function agentSettingsScope(operationId: string | null | undefined): AgentSettingsScope;

function resolveAgentSettings<T extends { id: number; operationId: string | null }>(
  rows: readonly T[],
  scope: AgentSettingsScope,
): T | null;                                    // ← puro, sin base: la regla de aislamiento

async function getAgentSettings(
  scope: AgentSettingsScope,
): Promise<AgentSettings | null>;                // ← el accesor
```

Las lecturas inline murieron todas: hoy hay **quince llamadas a `getAgentSettings`** y ninguna
otra forma de leer la tabla. Ningún archivo conserva un lector privado de `agent_settings` —
donde queda un helper local (`runner.ts`, `routes/agent.ts`) no tiene SQL, solo nombra el ámbito.

**Ámbito por operación — 6 llamadas.** La operación sale de la conversación, que ya la trae desde
el ticket 01: `agent/runner.ts` (el prompt, el modelo y el debounce con que contesta el agente),
`agent/preview.ts`, `jobs/followup.ts`, `jobs/confirmation-ack.ts`,
`jobs/dropi-novedad-notify.ts` y `routes/shopify.ts` (los tiempos de seguimiento y remarketing).

**Ámbito recibido por parámetro — 1.** `dropi/seed-templates.ts`, ver abajo.

**Ámbito global explícito — 8.** Sigue existiendo porque el contract es el ticket 06, pero ya no
es un `id = 1` implícito: el llamador *declara* que lee la fila global, y eso es greppable. Son
la del panel (`routes/agent.ts`, que sirve a sus tres handlers), la de la página `/agente` del
lado web, y las seis de logística (`jobs/dropi-confirm.ts` ×2, `jobs/dropi-poll.ts` ×2,
`jobs/dropi-sync.ts` ×2). Lo que decide si se confirma en logística (`dropiEnabled`,
`dropiDryRun`) pertenece a la **conexión de Dropi**, que todavía no dice de qué operación es:
resolverlo aquí por el contacto del pedido crearía una segunda fuente de verdad que
contradiría a la conexión.

Del lado web, `getAgentSettings()` de `apps/web/src/lib/queries.ts` **desapareció como lectura**
y quedó como re-export del accesor de `@wa/db`; la página `/agente` pasa `GLOBAL_AGENT_SETTINGS`
porque el panel aún no tiene selector de operación.

### Por qué esa forma de accesor

**El ámbito es un parámetro obligatorio, y es un tipo suma, no un `string | null`.** Con
`strict` y `noUncheckedIndexedAccess`, el compilador encuentra la lectura que se olvide de
declararlo — que es la red de seguridad que pide el `no-regresion.md`. Y un `{ kind: "global" }`
explícito distingue «leo la global a sabiendas» de «se me olvidó», que es justo lo que el
ticket 06 sale a buscar para borrarlo.

**La regla de aislamiento vive en una función pura y la consulta no la duplica.** `getAgentSettings`
trae las filas (`order by id`, unidades: una por operación) y resuelve en memoria con
`resolveAgentSettings`. Si el filtro estuviera en el `where` de SQL y el test ejerciera una copia
en TypeScript, las dos se desincronizarían y el test seguiría verde. Así el test ejerce **el
código que corre en producción**.

**Pedir la configuración de una operación que no tiene fila devuelve `null`, nunca la de otra.**
Preferir «alguna configuración» a «ninguna» es exactamente la fuga que el spec existe para
impedir. Sin configuración el agente no responde, y eso se ve; con la configuración equivocada
responde en quetzales a un cliente colombiano, y eso no se ve.

**El accesor vive en `@wa/db` y no en el worker** porque el panel lee la misma tabla: un solo
accesor, no uno por aplicación. No es un módulo de operaciones — no define un tipo `OperationId`
común ni toca la tabla `operations`.

### Las nueve FK a plantillas

Siguen colgando de la fila de la operación: **no se volvieron globales**. El que las escribía,
`dropi/seed-templates.ts`, tomaba `where(id = 1)`; ahora recibe el ámbito como parámetro
obligatorio, resuelve **su** fila y asigna solo sobre ella. Una operación nueva siembra las suyas
con su propio ámbito y no toca las de las demás. El test cubre que dos operaciones con plantillas
distintas devuelvan cada una la suya.

### Cómo se comprobó que Guatemala no cambia

1. **`pnpm -r typecheck` limpio en los 4 paquetes** y **`pnpm --filter @wa/worker test` en verde**:
   los 41 tests existentes pasan **sin tocar ni una línea de ellos**; el total sube a 51 en 5
   archivos con el test nuevo.
2. **Contra la base de producción, en lectura pura**: `agent_settings` tiene **exactamente una
   fila** (`id = 1`), y su `operation_id` es el de Guatemala; las 1.688 conversaciones tienen
   `operation_id` puesto. Con esa forma, un script que corre el código nuevo contra prod devolvió
   la **misma fila, byte a byte** (comparación JSON de la fila completa, prompt de 7.728
   caracteres y las nueve FK incluidas) por los tres caminos: la lectura vieja `where id = 1`, el
   ámbito global y el ámbito de la operación de Guatemala. Pedir una operación inexistente
   devolvió `null`, no la fila de Guatemala.
3. El test `apps/worker/src/agent/agent-settings.test.ts` fija esa equivalencia como invariante:
   «con la forma de producción, la operación y el ámbito global dan la misma fila».

No se arrancó el worker ni se ejecutó ningún job, no se mandó ningún mensaje, no se generó
migración y no se escribió una sola fila.

### Qué se descartó

- **Caer a la configuración global cuando la operación no tiene fila.** Es la fuga del spec.
- **Filtrar por `where` en SQL.** Duplicaba la regla de aislamiento en dos lugares.
- **Volver `operation_id` obligatoria o borrar el ámbito global.** Es el ticket 06.
- **Resolver la operación en los jobs de Dropi por el contacto del pedido.** Segunda fuente de
  verdad frente a la conexión de Dropi, que es de quien debe salir (ticket 04).
- **Convertir las escrituras del panel a por-operación.** `PUT /settings`, `PUT /prompt` y el
  restore siguen escribiendo la fila global — el panel no tiene selector de operación todavía.
  Quedaron marcadas con `GLOBAL_AGENT_SETTINGS_ID` en vez de un `1` suelto para que el contract
  las encuentre.
- **Tocar `dropi_dry_run`, `jobs/followup.ts` (el heurístico R1) y `dropi/notify.ts`.** Sin cambios.

### Qué queda abierto

- **`agent_settings.operation_id` no tiene índice único.** Con dos filas de la misma operación,
  la resolución se queda con la de `id` menor (determinista por el `order by`, pero arbitraria).
  El ticket 06, al volver la columna obligatoria, debería añadir el único.
- **Ocho lecturas siguen en ámbito global** (panel y logística). Se destraban con la conexión de
  Dropi por operación (ticket 04) y con el selector de operación del panel.
- **Las escrituras del panel siguen apuntando a la fila global.**
- **Dos números del ticket no coincidían con producción** (medido hoy, en lectura): el debounce
  es de **15 s**, no 8, y el seguimiento sale a los **2 min** (`followup_delay_ms = 120000`), no a
  los 5. Se documentan y se dejan como están; no se tocó ningún valor por defecto.
