# 01 — Sebastián responde con su persona

**What to build:** Un lead que llega por anuncio recibe respuesta de Sebastián, con el nombre y el tono configurados **para esa operación**. Katherine sigue atendiendo la postventa **en el mismo número**, sin contaminarse: la conversación sabe cuál de los dos es su dueño en cada momento.

**Blocked by:** ventas-ingesta-reconocimiento 01 · Distinguir un lead nuevo de un cliente existente · ventas-multi-operacion 05 · La configuración de agente cuelga de la operación

**Status:** resolved — worktree `sebastian-persona`, 17-ago-2026. El último guardia queda en el ticket 05 de este mapa.

- [x] El vendedor tiene su **propio registro de configuración, en una tabla hermana** — no se generaliza la configuración existente, cuyas 65 referencias son en su mayoría campos de Katherine.
- [x] Esa configuración incluye nombre visible, mensajes base, límite de descuento, instrucciones de tono, modelo y esfuerzo de razonamiento.
- [x] El constructor de prompt efectivo recibe qué agente está armando y resuelve de dónde leer. Es el único punto que aprende que hay más de un agente.
- [ ] Un lead que llega por anuncio **al número de la operación** produce respuesta con la persona del vendedor, mientras la conversación tenga al vendedor como dueño. — *el runner ya contesta con su persona cuando el dueño es el vendedor; quién es el dueño lo decide la ingesta y llega por parámetro (ver Answer)*
- [x] El prompt de Katherine no incorpora ningún campo de la configuración de ventas, ni al revés.
- [x] Los tests cubren el prompt efectivo de cada agente y verifican que no se filtra configuración entre ellos.
- [x] El modelo del vendedor es de gama media con esfuerzo de razonamiento bajo, y es un campo, no una constante.

## Answer — esquema puesto por la `0022` (17-ago-2026), la funcionalidad sigue abierta

El worktree `esquema-0022` dejó la **tabla hermana** aplicada en producción y vacía. `agent_settings` **no se tocó** — ni una columna. **Este ticket no genera migración.**

### `sales_agent_settings` — la configuración del vendedor, una por operación

| columna | tipo | default | notas |
| -- | -- | -- | -- |
| `id` | uuid pk | `gen_random_uuid()` | uuid como `operations`; no hereda el entero `default 1` del singleton porque nunca fue singleton |
| `operation_id` | uuid **NOT NULL** → `operations` (`restrict`) | — | **única** (`sales_agent_settings_operation_idx`): una configuración por operación |
| `display_name` | text NOT NULL | `''` | nombre visible: «Sebastián» |
| `greeting` | text NOT NULL | `''` | mensaje base: saludo |
| `closing_push` | text NOT NULL | `''` | mensaje base: empuje al cierre |
| `funnel_message` | text NOT NULL | `''` | mensaje base: mensaje de embudo |
| `tone_instructions` | text NOT NULL | `''` | texto libre: personalidad y tono |
| `discount_limit_pct` | integer NOT NULL | **`0`** | límite de descuento en porcentaje; `CHECK between 0 and 100`. **Cero prohíbe descuentos** y es el default: el valor seguro. Se aplica en código al construir la orden (spec de cierre), no aquí |
| `model` | text NOT NULL | `openai/gpt-5.4-mini` | slug de OpenRouter, mismo vocabulario que `agent_settings.model`; gama media, el mismo con el que se midió el costo por lead |
| `reasoning_effort` | text NOT NULL | `low` | `low` \| `medium` \| `high`; texto y no enum porque es vocabulario del proveedor y cambia sin migración |
| `created_at`, `updated_at` | timestamptz | `now()` | |

En drizzle: `salesAgentSettings`, tipos `SalesAgentSettings` / `NewSalesAgentSettings`, exportados por `@wa/db`.

Los textos son `NOT NULL default ''` como `agent_settings.system_prompt`: la fila puede existir con solo `operation_id` y el panel la va llenando. Modelo y esfuerzo son **campos, no constantes** — subir de gama es cambiar un valor, que era el criterio.

### Lo que NO quedó, y por qué

- **No hay accesor.** `getSalesAgentSettings(op)` es de este ticket. Sugerencia fuerte: copiar el patrón de `packages/db/src/agent-settings.ts` — traer las filas y resolver con una función pura `resolveSalesAgentSettings(rows, op)` que devuelva `null` para una operación sin fila y **nunca** la de otra operación. Es la regla de aislamiento que ya tiene tests en el hermano.
- **No hay columna de «agente dueño» en `conversations`.** El spec de módulos y ruteo (más reciente que este) decidió que a qué bandeja pertenece una conversación **se deriva y no se guarda** —«una cuarta máquina de estado guardada tendría que mantenerse de acuerdo con las otras tres»— y el ticket `ventas-modulos-y-ruteo/02`, en curso en el worktree `ruteo-bandeja`, lo implementa como función pura sobre hechos: `conversations.ad_referral_at` (puesto por la `0022`) contra los pedidos del contacto. **Quién es el dueño es la misma pregunta que en qué bandeja está**: atribución más reciente que el último pedido → Sebastián; si no → Katherine; y un asesor que toma el chat suspende a ambos con el `agent_mode` que ya existe. Si al construir el prompt efectivo resulta que hace falta guardar el dueño, es una decisión que contradice ese spec y hay que llevarla a la sesión que coordina, no una columna que se agrega de paso.
- **No hay contexto de producto**: `conversations.product_id` (→ `products`) lo escribe `ventas-ingesta-reconocimiento/04`; este ticket lo lee cuando construya el bloque de producto (ticket 02 de este lote).

### Verificado en producción tras aplicar

`sales_agent_settings` 0 filas · `agent_settings` sigue con 1 fila, `model` `openai/gpt-5.4-mini`, `dropi_dry_run` `true`, `dropi_enabled` `true`, prompt de 7.728 caracteres, `updated_at` `2026-08-08 03:35:25` sin mover.

## Answer — el seam y la persona, construidos (17-ago-2026, worktree `sebastian-persona`)

**Sin migración**, como decía el ticket: la `0022` ya había dejado la tabla. Lo que se construyó encima:

### El accesor · `packages/db/src/sales-agent-settings.ts`

`getSalesAgentSettings(op)` + `resolveSalesAgentSettings(rows, op)`, copiando el patrón del hermano tal como el ticket sugería: la regla de aislamiento es pura, vive en un solo lugar y no está partida entre un `where` de SQL y un `find` de TypeScript. Una operación sin fila devuelve `null`, **nunca la de otra**.

En esta tabla `null` tiene un segundo trabajo: **es el interruptor de la no-regresión**. Con la tabla vacía toda conversación resuelve al agente de confirmación por la primera línea del camino.

### El seam · `apps/worker/src/agent/effective-prompt.ts`

`buildEffectiveSystemPrompt` se mudó de `runner.ts` a su propio archivo y ahora **recibe la identidad**. Es el único punto del sistema que sabe que hay dos agentes; no hay segundo runner ni segunda bifurcación en el pipeline.

La entrada es una **unión discriminada**, y eso es lo que hace el borde duro del ticket: en la rama `confirmation` no existe el campo `persona`, y en la rama `sales` no existe `basePrompt`. La filtración de configuración entre agentes no es un caso que los tests vigilen — **es un programa que no compila**. Los tests la vigilan igual (`effective-prompt.test.ts`, incluidos dos `@ts-expect-error`), porque el que venga puede ensanchar el tipo sin ver qué sostenía.

La composición se partió en dos: `composeEffectivePrompt` es pura y se prueba sin base; el `build` async solo carga bloques. Para Katherine el resultado es **carácter por carácter** el de antes — hay un test que lo fija contra la concatenación literal.

### La persona · `apps/worker/src/sales/persona.ts`

Puro. Compone: quién es (nombre visible) → cómo habla (tono libre) → los tres mensajes base etiquetados por su momento → descuentos → reglas duras. **Un campo vacío no produce sección vacía**: la fila puede existir con solo `operation_id` y un «Saludo:» sin saludo es ruido que el modelo interpreta.

`isSalesAgentConfigured(settings)` vive aquí y el listón es **`display_name` no vacío**, no la existencia de la fila: los textos son `NOT NULL default ''`, así que tomar la fila como «hay vendedor» convertiría un `INSERT` a medio llenar en el momento en que Guatemala deja de ser atendida por Katherine.

### El modelo y el esfuerzo · `apps/worker/src/sales/model.ts`

Son campos y se leen de la fila. **Y hay un hallazgo que el ticket no podía saber:** la versión del proveedor que usa el worker (`@openrouter/ai-sdk-provider@6.0.0-alpha.1`) arma el cuerpo de la petición con una lista fija de campos —modelo, mensajes, `maxOutputTokens`, `temperature`, `topP`, herramientas— y **descarta tanto las opciones del modelo como las `providerOptions` de la llamada**. Verificado leyendo su `doGenerate` compilado, no supuesto.

Se manda igual por la vía canónica del SDK (`providerOptions.openrouter.reasoning.effort`), con el hecho documentado en el módulo: es donde el valor tiene que estar el día que el proveedor salga de alpha, y es lo que hace que el campo del panel sea un campo. Mientras tanto el vendedor corre con el esfuerzo por defecto del modelo. **Subir el esfuerzo hoy no tendría efecto**, y eso hay que saberlo antes de tocarlo buscando calidad.

### Lo que quedó abierto, y de quién es

El **dueño de la conversación**. Se acordó con la sesión que coordina que la derivación es del worktree de ingesta (`sales/owner.ts` y `inbox/facts.ts`, ambos suyos): la propiedad se decide en el camino del mensaje entrante y **no se guarda en ninguna parte**. Este worktree la **consume**: `onAgentInbound` recibe un `owner?: "confirmacion" | "ventas"` —tipo mínimo local, se adapta al suyo en el borde— y **ausente significa confirmación**, que es el comportamiento de hoy. Un default al revés habría convertido el aterrizaje de este lote en un cambio de comportamiento para Guatemala.

Con eso, el camino de venta está entero salvo su primera línea: cuando la ingesta pase `owner: "ventas"`, el turno lo atiende Sebastián con su persona, su producto y su escalamiento, sin tocar nada más.

### La ventana de memoria del vendedor

Es una **constante** (`SALES_MEMORY_WINDOW = 30`) y no `agent_settings.memory_window`. Esa columna es de Katherine, y leerla para el vendedor sería la misma contaminación que el ticket prohíbe, solo que por los parámetros en vez del prompt. La configuración de ventas no tiene campo de ventana; hasta que lo tenga, es constante del sistema.

El *debounce* sigue saliendo de `agent_settings` para los dos, y se deja documentado: es una propiedad del transporte —cuánto esperar a que el cliente termine de escribir— y no del agente. Cambiarlo sería una migración, no un efecto colateral de este lote.

### Verde y verificado

`pnpm -r typecheck` limpio en los 4 paquetes. `pnpm --filter @wa/worker test`: **189 pasan, 15 archivos** — los 135 previos **sin tocar** (`git status` no muestra ningún `.test.ts` existente modificado) más 54 nuevos.

**Guatemala no cambia de comportamiento, comprobado contra producción** (lectura, script `tsx` temporal, borrado):

- `sales_agent_settings`: **0 filas**. No hay fila vacía: no hay fila.
- `agent_settings`: 1 fila, operación `63937b3d…` (Guatemala), `model` `openai/gpt-5.4-mini`, `dropi_dry_run` `true`, `dropi_enabled` `true`, prompt de **7.728 caracteres**, `memory_window` 30, `updated_at` **`2026-08-08 03:35:25.347Z` sin mover**.
- `operations`: una sola, Guatemala `GT`/`GTQ`/`active`. `products` 0 filas, `product_ads` 0 filas.

Con 0 filas, **dos puertas independientes** dejan a Katherine atendiendo todo: `owner` ausente → nunca se entra a la rama de ventas; y aunque se entrara, `isSalesAgentConfigured(null)` es `false` y el turno vuelve al camino de siempre sin haber leído nada más.

## Hallazgo que hay que saber antes de tocar el esfuerzo de razonamiento

**`reasoning_effort` viaja por la vía canónica del SDK pero hoy no llega al proveedor.** Verificado el 17-ago-2026 leyendo el `doGenerate` de `@openrouter/ai-sdk-provider@6.0.0-alpha.1`: arma el body con una lista fija de campos y **descarta `providerOptions` y las opciones de modelo**.

Consecuencia práctica: el campo existe en `sales_agent_settings`, se guarda, se lee y se pasa — y no tiene efecto. Quien vaya a subir el esfuerzo buscando mejor calidad de venta va a creer que cambió algo y no va a cambiar nada.

**No se arregló aquí a propósito**: es un problema del proveedor, no del ticket, y la salida (fijar la versión, parchear el body o cambiar de cliente) es una decisión con dueño. Queda documentado en `apps/worker/src/sales/model.ts`.

Relacionado: el spec dice que si Sebastián cierra mal, **el primer sospechoso es el modelo, no el prompt**. Subir el modelo sí funciona —es un campo—; subir el esfuerzo, hoy no.
