# 10 — Las consultas del panel filtran por operación

**What to build:** Que ninguna pantalla del panel pueda mostrar filas de dos operaciones mezcladas. Hoy **ninguna de las doce consultas de `apps/web/src/lib/queries.ts` filtra por operación** — el archivo no menciona `operationId` ni `panelOperation` ni una vez.

**Blocked by:** 06 · 07

**Status:** claimed — worktree `selector-operacion`, ola del 18-ago-2026

Levantado el 18-ago-2026 desde el spec de pulido de UI, al construir los prototipos del grupo de conversaciones.

## Por qué se escapó del contract

El ticket 06 cerró la puerta **por accesores**: volvió obligatorio el parámetro de operación en `getKapsoConnection()`, `getShopifyConnection()`, `getDropiConnection()` y compañía, y el tipado estricto encontró los call sites. Ese mecanismo funcionó, y sigue siendo el correcto.

**Su punto ciego es estructural, no un descuido:** una consulta que lee filas directo con Drizzle no pasa por ningún accesor, así que nunca hubo un parámetro que volver obligatorio y el compilador no tenía nada que señalar. `listConversations` no pregunta por «la conexión»: hace `select().from(conversations)` y ordena por actividad.

Por eso este ticket existe aparte y no como un remiendo del 06: **la red del contract no puede atrapar esta clase de fuga**, y hace falta revisarla a mano una vez.

## Lo medido (18-ago-2026)

`apps/web/src/lib/queries.ts`, doce funciones exportadas, **cero menciones de operación**:

`listConversations` · `listApprovedWaTemplates` · `getConversationById` · `listMessages` · `markRead` · `listTemplates` · `listRecentConversationOptions` · `setAgentMode` · `setConfirmationStatus` · `listShopifyOrders` · `listShopifyOrdersWithDropi` · `listCarriers`

`listConversations` trae 200 conversaciones ordenadas por actividad, sin más filtro que la búsqueda de texto.

**Se parte en dos grupos, y la diferencia importa para estimar:**

### A · Filtrables hoy — la tabla ya tiene `operation_id`

`conversations` y `templates` ya la tienen (migraciones 0021/0022). Acá es agregar el `where`, no migrar:

- `listConversations` — el Inbox. **Es la que rompe el criterio del ticket 07** («no hay pantalla que muestre datos de dos operaciones mezclados») el día que Colombia reciba un mensaje.
- `getConversationById`, `listRecentConversationOptions` — hoy resuelven por id sin verificar a qué operación pertenece la fila.
- `listTemplates`.
- **Las escrituras por id son el caso más delicado**: `markRead`, `setAgentMode` y `setConfirmationStatus` reciben un id y escriben. Sin verificar la operación, una URL escrita a mano —o un id viejo en una pestaña abierta— apaga el agente de la conversación de otro país. Acá el filtro no es cosmético.

### B · Falta la columna — necesitan migración antes

- `shopify_orders` **no tiene `operation_id`** (`dropi_orders` sí, la ganó en el contract). Afecta a `listShopifyOrders` y `listShopifyOrdersWithDropi`, o sea la pantalla de Pedidos.
- `wa_templates` **no tiene `operation_id`**, y las plantillas aprobadas de Meta cuelgan del número, que sí es por operación. Afecta a `listApprovedWaTemplates`.

`messages` y `message_media` no la necesitan: cuelgan de la conversación, y filtrar la conversación alcanza. `contacts` tampoco — una persona puede existir en las dos operaciones y eso no es un error.

## Criterios

- [ ] Ninguna consulta de `queries.ts` devuelve filas de una operación distinta de la activa.
- [ ] **Las escrituras por id verifican la pertenencia antes de escribir**, no solo al leer.
- [ ] `shopify_orders` y `wa_templates` tienen `operation_id`, con backfill a Guatemala.
- [ ] Existe una prueba, aunque sea una, que falle si alguien agrega una consulta sin filtro. Sin eso el punto ciego vuelve.
- [ ] `pnpm -r typecheck` limpio y la suite del worker en verde.
- [ ] **El comportamiento observable de Guatemala no cambia.** Con una sola operación activa, filtrar por ella devuelve exactamente las mismas filas que hoy.

## No-regresión

Mientras Guatemala sea la única operación `active`, agregar el filtro **no puede cambiar ningún resultado**: todas las filas existentes ya están asociadas a Guatemala por el backfill del ticket 01. Si al agregar el `where` alguna pantalla queda vacía o pierde filas, es señal de que hay filas con `operation_id` en `NULL` — `conversations` lo permite a propósito— y **hay que decidir qué hacer con ellas antes de seguir**, no filtrarlas en silencio.

Las 1.678 conversaciones y los 1.678 pedidos de Guatemala son el camino que factura. Ver `panel-de-ventas/no-regresion.md`.

## Nota de alcance

Este ticket es el filtro **por operación**. El filtro **por módulo** —qué conversaciones ve ventas y cuáles confirmación— es de *ventas-modulos-y-ruteo 03*, y son independientes: se puede filtrar por país sin separar módulos, pero no al revés.

## Answer — lo repartido y lo medido (18-ago-2026, sesión coordinadora)

Va en el **mismo worktree que el 07** (`selector-operacion`), y no por afinidad
temática: el 07 escribe `resolvePanelOperation()` y las doce consultas de este
ticket son sus primeras llamadoras. Separarlos habría dejado a este ticket
codeando contra una función que otra rama todavía no mergeó.

### Migración `0024` — asignada a este worktree, y es la única de la ola

**Solo un worktree por ola genera migración.** No es una precaución de estilo:
drizzle-kit reescribe `packages/db/migrations/meta/_journal.json` y deja un
`NNNN_snapshot.json`. Dos ramas que generen en paralelo chocan en el journal
siempre, y el conflicto no lo ve ningún check local. Esta ola tiene tres
worktrees y **la migración es de este**.

Contenido: `operation_id` en `shopify_orders` y en `wa_templates`, con backfill
a Guatemala. **Drizzle no escribe el backfill** — la migración generada se lee y
se le meten los `UPDATE` a mano antes de los índices, y antes de aplicarla.

### Medido en producción (18-ago-2026, solo lectura)

| Tabla | Filas | Qué implica |
| -- | -- | -- |
| `operations` | 1 (`GT`, `active`) | el fallback cubre todo; filtrar no puede cambiar resultados |
| `conversations` | 1.714 | **0 con `operation_id` NULL** |
| `shopify_orders` | 1.707 | backfill a GT |
| `wa_templates` | 15 | backfill a GT |
| `templates` | 9 | ya tiene `operation_id` |

**El «0 con `operation_id` NULL» es el número que desarma el riesgo de este
ticket.** La sección de no-regresión decía que si al agregar el `where` alguna
pantalla perdía filas era señal de filas en NULL, y que había que decidir qué
hacer con ellas antes de seguir. No hay ninguna: las 1.714 conversaciones están
asociadas a Guatemala. Filtrar devuelve exactamente lo mismo que hoy, y si
alguna pantalla queda vacía es un bug del filtro, no un dato huérfano.

### El criterio que más importa, y no es el filtro

**Las escrituras por id** — `markRead`, `setAgentMode`, `setConfirmationStatus`—
verifican pertenencia **antes de escribir**, no solo al leer. Un id viejo en una
pestaña abierta apagando el agente de la conversación de otro país es el daño
real de este ticket; el resto es higiene.

Y la prueba que falla si alguien agrega una consulta sin filtro: sin ella el
punto ciego vuelve, porque **el compilador no puede verlo** — una consulta con
Drizzle no pasa por accesor y no hay parámetro que volver obligatorio. Esa es la
razón por la que este ticket existe aparte del 06 y no como su remiendo.
