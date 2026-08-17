# 01 — Sebastián responde con su persona

**What to build:** Un lead que llega por anuncio recibe respuesta de Sebastián, con el nombre y el tono configurados **para esa operación**. Katherine sigue atendiendo la postventa **en el mismo número**, sin contaminarse: la conversación sabe cuál de los dos es su dueño en cada momento.

**Blocked by:** ventas-ingesta-reconocimiento 01 · Distinguir un lead nuevo de un cliente existente · ventas-multi-operacion 05 · La configuración de agente cuelga de la operación

**Status:** claimed — worktree `sebastian-persona`, tanda del 17-ago-2026

- [ ] El vendedor tiene su **propio registro de configuración, en una tabla hermana** — no se generaliza la configuración existente, cuyas 65 referencias son en su mayoría campos de Katherine.
- [ ] Esa configuración incluye nombre visible, mensajes base, límite de descuento, instrucciones de tono, modelo y esfuerzo de razonamiento.
- [ ] El constructor de prompt efectivo recibe qué agente está armando y resuelve de dónde leer. Es el único punto que aprende que hay más de un agente.
- [ ] Un lead que llega por anuncio **al número de la operación** produce respuesta con la persona del vendedor, mientras la conversación tenga al vendedor como dueño.
- [ ] El prompt de Katherine no incorpora ningún campo de la configuración de ventas, ni al revés.
- [ ] Los tests cubren el prompt efectivo de cada agente y verifican que no se filtra configuración entre ellos.
- [ ] El modelo del vendedor es de gama media con esfuerzo de razonamiento bajo, y es un campo, no una constante.

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
