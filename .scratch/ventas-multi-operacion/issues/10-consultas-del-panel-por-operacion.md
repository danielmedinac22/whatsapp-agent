# 10 — Las consultas del panel filtran por operación

**What to build:** Que ninguna pantalla del panel pueda mostrar filas de dos operaciones mezcladas. Hoy **ninguna de las doce consultas de `apps/web/src/lib/queries.ts` filtra por operación** — el archivo no menciona `operationId` ni `panelOperation` ni una vez.

**Blocked by:** 06 · 07

**Status:** ready-for-agent

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
