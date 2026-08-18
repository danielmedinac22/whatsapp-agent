# 10 — Las consultas del panel filtran por operación

**What to build:** Que ninguna pantalla del panel pueda mostrar filas de dos operaciones mezcladas. Hoy **ninguna de las doce consultas de `apps/web/src/lib/queries.ts` filtra por operación** — el archivo no menciona `operationId` ni `panelOperation` ni una vez.

**Blocked by:** 06 · 07

**Status:** resolved — worktree `selector-operacion`, ola del 18-ago-2026

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

- [x] Ninguna consulta de `queries.ts` devuelve filas de una operación distinta de la activa.
- [x] **Las escrituras por id verifican la pertenencia antes de escribir**, no solo al leer.
- [x] `shopify_orders` y `wa_templates` tienen `operation_id`, con backfill a Guatemala. **Y `templates` también**: no la tenía, aunque este ticket decía que sí.
- [x] Existe una prueba, aunque sea una, que falle si alguien agrega una consulta sin filtro. Sin eso el punto ciego vuelve.
- [x] `pnpm -r typecheck` limpio y la suite del worker en verde.
- [x] **El comportamiento observable de Guatemala no cambia.** Con una sola operación activa, filtrar por ella devuelve exactamente las mismas filas que hoy.

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


## Answer — lo construido (18-ago-2026, worktree `selector-operacion`)

Las doce consultas reciben la operación **por parámetro** y acotan por ella. No
la resuelven por dentro a propósito: una consulta que va a buscar sola sobre qué
país trabaja esconde de qué depende, y son las pantallas las que tienen que poder
decir «esta pantalla es de este país». Es el mismo mecanismo del contract del
ticket 06, aplicado a lo que aquel no podía alcanzar.

### El error del ticket: `templates` no tenía la columna

Este ticket daba `templates` por resuelta —«ya tiene `operation_id`, solo agregás
el `where`»— y **no la tenía**. Medido contra producción antes de escribir nada:
nueve plantillas, ninguna columna de operación. Es la única corrección de fondo
al enunciado y no es cosmética: de esas nueve cuelgan las seis referencias de
plantilla de la configuración de agente, que desde el contract es **una por
operación**. Sin la columna, la configuración colombiana solo puede apuntar a
plantillas guatemaltecas, y lo que hay dentro de una plantilla es el texto que le
sale al cliente.

Así que la migración toca tres tablas, no dos. Y a `templates` además le cambia
la regla de nombres únicos: antes el nombre era único a secas, con lo cual
Colombia no podía tener su propia plantilla de «guía generada» —el alta chocaba
contra la guatemalteca y la operación se quedaba sin plantilla, en silencio—.
Ahora el nombre es único **dentro de cada operación**, que es el mismo movimiento
que la migración anterior le hizo a los pedidos de logística.

### Qué lleva la columna y qué no, y por qué

Las dos tablas de plantillas la llevan **obligatoria**: quien las escribe siempre
sabe de qué operación son. Los pedidos de la tienda la llevan **opcional**, por
la misma razón por la que las conversaciones la tienen opcional desde el
contract: el webhook de la tienda no puede saber de qué tienda viene un pedido
hasta que exista la segunda, y volverla obligatoria convertiría «no sé de qué
operación es» en «pierdo el pedido», sobre el camino por el que entran los que
facturan.

Eso obligó a tocar el receptor de pedidos, que no estaba en el reparto: si la
columna nace y nadie la escribe, **cada pedido nuevo queda fuera de la pantalla
de Pedidos desde el primer día**, con una sola operación. Ahora el pedido hereda
la operación de la conversación de ese cliente, que la ingesta ya resolvió por el
número que recibió el mensaje.

### Las escrituras por id

Es el criterio que más importa y quedó resuelto de la forma fuerte: la
pertenencia viaja **dentro del `where` de la escritura**, no en una consulta
previa. Entre leer y escribir, una fila puede cambiar de dueño; así no hay
ventana.

Y las tres dicen **si escribieron**. Cuando la fila no es de la operación activa,
la pantalla recibe un «no existe» en vez de un «listo» sobre algo que no pasó —
un acuse falso es la manera de que el error quede invisible justo donde tenía que
verse. Verificado contra una base de ensayo con las dos operaciones vivas: pedir
el historial, marcar confirmado y apagar el agente de una conversación del otro
país devuelven «no existe» y **no escriben nada**; las mismas tres operaciones
sobre una conversación propia funcionan igual que siempre.

### La prueba que hace que el punto ciego no vuelva

Es lo que más valor tiene a futuro y por eso se le dio dos vueltas.

La primera versión miraba función por función: «si esta función toca una tabla
con dueño, que nombre la operación». **Pasaba estando rota.** Se descubrió
probándola contra el código con el filtro quitado a mano: la consulta del Inbox
hace cuatro consultas, así que le bastaba acotar una para parecer sana — se le
podía quitar el filtro a la lista entera sin que nadie se enterara.

La versión que quedó mira **consulta por consulta**. Cada una responde por sí
misma. Se verificó al revés, que es la única forma de saber que una red sirve:
quitando el filtro del Inbox falla nombrándolo, y quitando la verificación de
pertenencia de la escritura del modo agente también.

Además, la lista de tablas con dueño **sale del esquema, no de una lista
escrita a mano**. Una tabla nueva con operación entra sola a la vigilancia el día
que alguien la agrega, que es exactamente cuando una lista a mano ya estaría
vieja.

Vigila dos archivos: las doce consultas y las escrituras de la pantalla de
Plantillas, que no pasan por ahí y también reciben un id de un formulario.

### Lo que se descartó

- **Filtrar las plantillas de Meta por la cuenta de WhatsApp** en vez de por
  operación. Funciona, pero obliga a ir a buscar la conexión para traducir; la
  operación es lo que el panel tiene en la mano.
- **Dejar que las filas sin operación aparezcan en los dos países.** Una fila que
  no dice de quién es no es de nadie, y mostrarla en ambos lados es la mezcla que
  este ticket prohíbe. Hoy no hay ninguna: cero en NULL en las 1.719
  conversaciones y en los 1.712 pedidos.
- **Arreglar de paso el número único de pedido de la tienda**, que con dos
  tiendas puede colisionar. Es del ticket 08, que es el que trae la segunda
  tienda; tocarlo acá solo podía introducir pedidos duplicados, y un pedido
  duplicado es un mensaje duplicado al cliente.
