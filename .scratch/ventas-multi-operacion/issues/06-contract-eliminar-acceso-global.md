# 06 — Contract: se elimina el acceso global

**What to build:** Deja de existir la posibilidad de preguntar por "la conexión" o "la configuración" sin decir de qué operación. Mientras esa puerta exista, alguien la va a usar — y el resultado es un pedido colombiano creado en la tienda guatemalteca, que nadie detecta hasta que sale el envío al país equivocado.

Paso **contract**: se borra la forma vieja ahora que nadie la usa.

**Blocked by:** 02 · 03 · 04 · 05

**Status:** resolved — worktree `op-06-contract`, tanda del 16-ago-2026, migración `0021` aplicada a producción

- [x] Ningún accesor devuelve una conexión o configuración sin recibir la operación.
- [x] La referencia a operación pasa a ser obligatoria en las cuatro tablas. *(y en una quinta, `dropi_orders`; `conversations` se queda nullable a propósito — ver abajo)*
- [x] No queda ningún valor por defecto que resuelva a Guatemala implícitamente.
- [x] La suite completa pasa en verde.
- [x] El comportamiento observable de la operación de Guatemala sigue idéntico.

## Medido contra el código (16-ago-2026)

**Migración `0021`**, reservada para este ticket — la `0020` es del ticket 01. Vuelve `operation_id` obligatoria en las cuatro tablas. Sobre `shopify_connection` es trivial: **tiene cero filas**. Sobre las otras tres hay exactamente una fila cada una, ya asociada a Guatemala por el backfill del ticket 01. Verifica que no quede ninguna en `NULL` **antes** de aplicar el `SET NOT NULL`, o la migración falla a medias sobre producción.

**Lo que tiene que dejar de existir**, en concreto:

- `getKapsoConnection()`, `getShopifyConnection()`, `getDropiConnection()` y `requirePhoneNumberId()` sin parámetro de operación.
- `upsertDropiConnection()` sin operación.
- Cualquier `eq(<tabla>.id, 1)` que quede en el código — es el mecanismo exacto por el que un pedido colombiano termina en la tienda guatemalteca. Búscalo literalmente antes de cerrar: hoy hay quince en `agent_settings` y nueve en las tres conexiones.
- Las cachés de 30 segundos en variable de módulo de los tres accesores, si quedaron con una sola entrada en vez de indexadas por operación. Una caché global sobrevive al contract sin que el compilador diga nada, y devuelve la conexión del país equivocado.

**El tipado estricto es la red.** `strict: true` y `noUncheckedIndexedAccess: true` están activos en toda la base: al volver obligatorio el parámetro, el compilador encuentra los call sites que falten. Este paso no puede fallar en silencio — por eso se hace, y por eso el criterio de terminado es `pnpm -r typecheck` limpio, no una revisión a ojo.

**Ojo con `apps/worker/src/_tmp_templates.ts`**, si para entonces alguien lo commiteó: llama `getKapsoConnection()` y está marcado «TEMP — borrar después de usar». Bórralo en vez de migrarlo.

## Answer — construido y aplicado el 16-ago-2026

**Ya no existe forma de preguntar por «la» conexión ni por «la» configuración.** El
parámetro de operación no es solo obligatorio: es que ya no admite el valor que significaba
«la única». Y `operation_id` dejó de ser opcional en la base.

### Lo que de verdad había que borrar no era un parámetro que faltaba

Los lotes 02–05 ya habían parametrizado los cuatro accesores. Lo que quedaba abierto era más
sutil y estaba escrito en el tipo:

```ts
type OperationRef = OperationId | null;   // `null` = «la operación única»
```

`null` no significaba «no importa»: leía `where(id = 1)`. Y la fila `id = 1` **es Guatemala**.
O sea que la puerta seguía abierta con otra forma — un llamador que no supiera su operación
compilaba, no fallaba, y recibía la conexión guatemalteca. El lote 02 lo dejó así a propósito
y escrito para que este ticket lo encontrara. Con `OperationRef` se fueron:

| Borrado | Por qué ya no puede existir |
| -- | -- |
| `OperationRef`, `operationCacheKey`, `SINGLE_OPERATION_CACHE_KEY` | El caso `null` era el default a Guatemala |
| `canUseSingleOperationFallback` | La `0021` volvió imposible el estado que cubría |
| `resolveKapsoConnection` (versión con red) | Ídem — ver abajo |
| `resolveDropiConnection` + `orphanConnectionFor` | Ídem |
| `AgentSettingsScope`, `GLOBAL_AGENT_SETTINGS`, `GLOBAL_AGENT_SETTINGS_ID`, `agentSettingsScope` | El ámbito `global` era `id = 1`, o sea Guatemala |
| Los dos `SINGLETON_ID = 1` de `kapso/connection.ts` y `shopify/admin.ts` | — |
| Los `eq(shopifyConnection.id, 1)` de `routes/shopify-connection.ts` y el `eq(dropiConnection.id, 1)` de la página `/inbox` | El panel ya no lee la fila uno de frente |

**Las dos redes se borraron porque la migración las dejó sin nada que atrapar**, no por
limpieza. Ambas cubrían un único estado: «la operación existe pero su conexión quedó sin
etiquetar». Con `operation_id` en `NOT NULL` ese estado no cabe en la base. Una red que no
puede atrapar nada es peor que ninguna: promete una garantía que ningún test ejerce.

`apps/worker/src/_tmp_templates.ts` **no existe** — ni en `main` ni sin commitear en este
worktree. No hubo nada que borrar.

### La forma que quedó: un id es lo que se guarda, una operación es lo que se pasa

Los accesores reciben la **fila `Operation`**, no un uuid. Es la decisión del lote 04
(«pasar la fila es lo que hace que el error no se pueda escribir: un id de conversación o de
contacto es también un `string` y habría compilado»), extendida a los otros tres accesores,
que usaban `string`. Los uuid solo viajan donde el dato vive —las columnas `operation_id`— y
se convierten en fila al entrar a un accesor.

```ts
getKapsoConnection(op: Operation)      getDropiConnection(op: Operation)
getShopifyConnection(op: Operation)    getAgentSettings(op: Operation)
requirePhoneNumberId(op: Operation)    upsertDropiConnection(op: Operation, patch)
getProductsByIds(op: Operation, ids)   ensureDropiTemplates(op: Operation)
connectKapsoNumber(op: Operation, phoneNumberId)   // la operación va primero
```

### Deuda A · Un solo vocabulario, y por qué la primitiva devuelve `null`

Había dos implementaciones de la misma pregunta, que corrieron en paralelo sin verse:
`getSingleOperationId()` en `apps/worker/src/operations/` (devuelve `null`) y
`requireSoleActiveOperation()` en `dropi/config.ts` (lanza), cada una con su
`listActiveOperations()` y su caché. Dos implementaciones de «cuál es la única operación
activa» se desincronizan en cuanto una se toque, y la que quede vieja responde con el país
equivocado.

Todo vive ahora en **`packages/db/src/operations.ts`** — en `@wa/db` y no en el worker por lo
mismo que `getAgentSettings`: el panel resuelve las mismas operaciones, y un solo accesor
vale más que uno por aplicación.

**Elegí `null` como primitiva y el lanzar como derivación de una línea**, no al revés:

```ts
getSingleActiveOperation(): Promise<Operation | null>   // la primitiva
requireSoleActiveOperation(): Promise<Operation>        // la misma pregunta, convertida en error
```

La razón no es de estilo. De la primitiva cuelga la red del **pipeline de entrada**, y esa
red no puede lanzar: un mensaje que revienta al resolver su operación es la operación muda
sin que salte ninguna alarma, y ningún test lo ve porque el sistema «funciona». El lote 02
construyó `InboundOperationDecision` sin caso «descartar» justamente para eso. Si la
primitiva lanzara, cada llamador tendría que envolverla en un `try` y el que se olvidara
reintroduciría el fallo silencioso por la puerta de atrás.

Y al revés: quien **sí** debe detenerse lo dice con el nombre. Las tres formas de pedir una
operación quedaron nombradas y son greppables:

| Forma | Qué hace con la ambigüedad | Dónde |
| -- | -- | -- |
| `getSingleActiveOperation()` | devuelve `null`, el llamador sigue | 3 sitios: el entrante, el webhook de la tienda, el bloque de productos del prompt |
| `requireSoleActiveOperation()` / `panelOperation()` | **lanza** | el panel: 6 rutas del worker + 2 páginas del panel |
| `requireOperationOrSole(operationId)` | la de la fila, o el puente si la fila no la trae | 8 sitios, todos filas de `conversations` |

`panelOperation()` es el puente con nombre propio, y es lo que el ticket 07 cambia en un
solo lugar para migrar las ocho pantallas de una vez. La `OperationScopedCache<T>` probada
sustituyó al `Map` equivalente de `dropi/config.ts`; `listActiveOperations`,
`resolveOperationForContact` y `findOperationByDropiAdminPhone` quedaron en una sola copia
(esta última es la única que se quedó en `dropi/`, porque de verdad es de logística).

### Las tres cachés, revisadas a mano y una por una

Es el único riesgo del lote que el compilador no ve, así que va el veredicto de cada una.

**1 · WhatsApp (`kapso/connection.ts`) — estaba bien indexada, pero tenía una segunda caché
que nadie había mirado.** El accesor ya usaba `OperationScopedCache` (lote 02). Pero hay
**otra** en el mismo archivo, `allConnectionsCache`, que guarda el catálogo entero de
conexiones para resolver el entrante por su `phone_number_id`. La revisé: es correcta y debe
ser global — es precisamente el conjunto de *todas* las operaciones, y la resolución compara
`phone_number_id`, que es único entre países. No la toqué. Sí verifiqué que
`invalidateKapsoConnectionCache` la limpia, y la limpia.

**2 · Tienda (`shopify/admin.ts`) — dos cachés, las dos ya correctas.** La de conexión usaba
`OperationScopedCache`; la de producto (`productCache`, 10 min) ya llevaba la operación en la
clave desde el lote 03. Comprobé además que `invalidateShopifyConnectionCache` hace
`productCache.clear()` entero: invalida de más, nunca de menos, que es el lado seguro.

**3 · Logística (`dropi/config.ts`) — era un `Map` propio, equivalente pero paralelo.**
Estaba indexado por `operation.id` y era correcto, pero era una segunda implementación de la
misma clase. Lo cambié por `OperationScopedCache`, que es la probada.

**El hallazgo real de esta revisión no fue una caché mal indexada: fue la clave que ya no
hacía falta.** `OperationScopedCache` tenía una entrada especial, `__operacion_unica__`, para
el caso `operationId: null`, y su `invalidate()` tenía que borrar **dos** claves en pareja
porque con una sola operación ambas apuntaban a la misma fila. Al morir el caso `null`, esa
mecánica —el sitio exacto donde una invalidación a medias dejaba media caché rancia— dejó de
existir. Una fila, una clave.

**Cuarta caché, nueva y mía:** `listActiveOperations()` ahora cachea 30 s, el mismo TTL que
las conexiones. Es una lista global a propósito (es *el conjunto* de operaciones, no algo que
cuelgue de una), y `invalidateOperationsCache()` está puesta para el ticket 08. Consecuencia
declarada: dar de alta Colombia tarda hasta 30 s en verse.

### Deuda del lote 05 · Las ocho lecturas en ámbito global

Las nueve, en realidad: había una más que el encargo no contaba, en `index.ts`. Ninguna
sobrevive.

| Lectura | Qué se hizo |
| -- | -- |
| `jobs/dropi-confirm.ts` ×2 | Por operación. Ver abajo. |
| `jobs/dropi-poll.ts` ×2 | La configuración se lee **dentro** del bucle que ya recorría las operaciones activas; `dropiEnabled` se comprueba por operación. El cron toma el menor intervalo configurado. |
| `jobs/dropi-sync.ts` ×2 | Igual. |
| `index.ts` (`ensureDropiTemplates`) | Recorre las operaciones activas y siembra las plantillas de cada una sobre su propia configuración. Antes sembraba la fila `id = 1`: la segunda operación se habría quedado sin plantillas o habría heredado las FK guatemaltecas. |
| `routes/agent.ts` (4 sitios) | `panelOperation()`. |
| Página `/agente` del panel | `panelOperation()`. |

**Sobre las seis de logística, que es lo que el lote 05 dejó anotado:** su razón era buena —lo
que decide si se confirma (`dropiEnabled`, `dropiDryRun`) pertenece a la conexión de Dropi, y
resolverlo por el contacto del pedido habría creado una segunda fuente de verdad que
contradice a la conexión. Con el lote 04 aterrizado, la conexión ya declara su operación, así
que ya no hay dos fuentes: **hay una, consultada antes**. En `dropi-confirm` moví la lectura
del pedido por encima de la de la configuración, para que la operación que decide la bandera
sea literalmente la misma que dos pasos más abajo recibe el `PUT`. Y la confirmación manual
—el botón de /pedidos, el único camino que hace `PUT` de verdad— ahora saca la operación de
`dropi_orders.operation_id`, la columna nueva, que es más fuerte que ir por el contacto: los
29 pedidos sin contacto también la traen.

**Y las dos del panel no se quedaron, contra lo que anticipaba el encargo.** Ese es el único
punto donde me aparté de él, y la razón es del propio ticket: el ámbito global resolvía a
`id = 1`, que **es** Guatemala, así que dejarlo habría incumplido el criterio «no queda ningún
valor por defecto que resuelva a Guatemala implícitamente». `panelOperation()` no es un
default: con una sola operación es la misma fila y el panel se comporta idéntico; con dos
falla en vez de editar el país equivocado en silencio, y eso obliga a que el selector del
ticket 07 llegue antes que Colombia. Es además el mismo mecanismo que el lote 04 ya había
puesto para las rutas de Dropi del panel, así que de paso desaparece la tercera forma de
hacer lo mismo.

### Deuda B · Las dos columnas: `dropi_orders` sí, `shopify_orders` no

Los lotes 03 y 04 se contradecían y los dos tenían razón **sobre su propia tabla**. La
diferencia no es de criterio sino de hecho, y se ve al preguntar quién escribe cada una:

> **`NOT NULL` donde quien escribe siempre sabe la operación; nullable donde puede
> legítimamente no saberla.**

- **`dropi_orders` la lleva.** La escribe el sondeo, que le pidió esos pedidos a la cuenta de
  Dropi *de una operación concreta*: la sabe siempre, por construcción. Y sin ella el daño
  estaba a la vista en el esquema: el único era sobre `dropi_order_id` **a secas**, y el id de
  Dropi es único dentro de una cuenta, no entre cuentas. No es que dos operaciones con el
  pedido 942698 se pisaran: es que la segunda **no se podía guardar**. Además,
  `upsertDropiOrder` buscaba la fila existente sin filtrar por operación. El paliativo del
  lote 04 (comparar la moneda del pedido de tienda cruzado) cubría 1.729 de 1.758; ahora el
  sondeo acota su conjunto activo por operación y el cruce va por `(operación, id de Dropi)`,
  que es el único nuevo. El guardia por moneda desapareció de `dropi-poll` por redundante, y
  **sigue** en `dropi-sync` para los candidatos de tienda, que es donde toca.
- **`shopify_orders` no la lleva, y el lote 03 tenía razón por una razón más fuerte de la que
  dio.** Quien la escribiría es el webhook de la tienda, que se autentica con un secreto de
  entorno global y no puede saber de qué tienda viene el pedido hasta el ticket 08. Con dos
  operaciones, `getSingleActiveOperation()` devuelve `null` y la columna quedaría **vacía
  justo en el mundo donde haría falta**: sería una segunda fuente de verdad, más débil que la
  que ya hay. Porque la señal que sí tiene el pedido es la **moneda**, y esa viene de la
  tienda misma — es la tienda declarando de qué país es, no nosotros adivinándolo. Añadir la
  columna habría sido cambiar un dato autoritativo por uno inferido.

### `conversations` se queda nullable, y no por descuido

El expand dejó la columna en cinco tablas y el encargo pedía decidir. El criterio del propio
encargo era «si el lote 02 la está escribiendo siempre» — y **no la escribe siempre**. Escribe
lo que resolvió, que puede ser `null`: un mensaje que entra por un número que no reconocemos,
o un pedido web cuando exista una segunda tienda que distinguir.

Volverla obligatoria convertiría «no sé de qué operación es» en **«pierdo el mensaje»** y
**«pierdo el pedido»**, sobre los dos caminos que más importan: R3 (si deja de salir/entrar
todo mensaje, la operación queda muda) y R4 (por el webhook entran los 1.681 pedidos que
facturan). Sería exactamente lo contrario de lo que decidió el lote 02 al no darle al pipeline
ninguna forma de descartar — y peor, porque reintroduciría la pérdida por la vía de una
restricción de la base, donde ningún tipo la ve. Ninguna lectura la supone no-nula: todas
tratan `null` como «todavía no se sabe» y tienen comportamiento definido.

Lo hice greppable en vez de obligatorio: cada `requireOperationOrSole(...)` es una fila que
todavía no trae su operación, y son la lista de trabajo del ticket que sí pueda cerrarla —
`agent/runner.ts`, `agent/preview.ts`, `jobs/confirmation-ack.ts`, `jobs/dropi-novedad-notify.ts`,
`jobs/followup.ts`, `jobs/outbound.ts`, `routes/wa.ts`, `routes/shopify.ts`.

### Deuda C · Los comentarios que envejecieron

Los de `dropi-poll.ts` y `dropi-sync.ts` que decían «la conexión de Dropi todavía no dice de
qué operación es (ticket 04)» desaparecieron con el código que describían. Actualicé también
los cuatro encabezados de `schema.ts` que seguían diciendo «singleton row, id=1» y el de
`operations`, que anunciaba la columna como nullable.

### La migración `0021`

Drizzle generó dos cosas que revientan sobre producción, que es exactamente lo que el encargo
avisaba: `ADD COLUMN "operation_id" uuid NOT NULL` sobre las 1.758 filas de `dropi_orders`
(error inmediato de Postgres), y ningún backfill. La reescribí a mano.

```sql
-- 1 · Rescate idempotente de las cuatro tablas de configuración
UPDATE "kapso_connection"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "status" = 'active')
WHERE "operation_id" IS NULL;                       -- y dropi_connection, agent_settings, shopify_connection

-- 2 · La operación deja de ser opcional
ALTER TABLE "kapso_connection" ALTER COLUMN "operation_id" SET NOT NULL;   -- ×4

-- 3 · Una conexión y una configuración POR operación
CREATE UNIQUE INDEX "kapso_connection_operation_idx" ON "kapso_connection" ("operation_id");   -- ×4

-- 4 · dropi_orders: nullable → backfill → NOT NULL → FK
ALTER TABLE "dropi_orders" ADD COLUMN "operation_id" uuid;
UPDATE "dropi_orders"
SET "operation_id" = (SELECT "id" FROM "operations" WHERE "status" = 'active')
WHERE "operation_id" IS NULL;
ALTER TABLE "dropi_orders" ALTER COLUMN "operation_id" SET NOT NULL;

-- 5 · El único pasa a ser (operación, id de Dropi). El nuevo se crea ANTES de soltar el viejo.
CREATE UNIQUE INDEX "dropi_orders_operation_id_idx" ON "dropi_orders" ("operation_id","dropi_order_id");
DROP INDEX IF EXISTS "dropi_orders_id_idx";
```

Dos detalles que son decisiones:

**El backfill resuelve con `(SELECT id FROM operations WHERE status = 'active')`, no con
`country_code = 'GT'`.** Es el puente `requireSoleActiveOperation()` escrito en SQL: con dos
operaciones activas la subconsulta escalar falla —«more than one row returned by a
subquery»— y la migración se detiene en vez de repartir filas al país equivocado. La
seguridad la da que reviente, no que alguien se acuerde.

**Los cuatro únicos sobre `operation_id` no estaban en el encargo.** El lote 05 pidió el de
`agent_settings`; los otros tres salieron de mirar el modelo: nada impedía dos filas de la
misma operación, y cuál ganaba era arbitrario. El `id` entero con `default 1` sigue siendo la
clave primaria heredada del singleton — la clave del modelo es la operación, y ahora la base
lo hace cumplir. Los tres upserts del panel calculan el `id` siguiente al insertar, para que
la conexión de una segunda operación no choque contra la primaria.

**Probada en seco antes de producción.** Levanté una base desechable, apliqué las
migraciones `0000`–`0020`, le metí datos con la forma fea (29 pedidos de logística sin
contacto ni cruce, una conversación sin operación, y una fila de configuración puesta en
`NULL` a mano para ejercitar el rescate) y corrí la `0021`. Rescató la fila, backfilleó los
70 pedidos, dejó `conversations` nullable, y verifiqué la semántica nueva del único: el mismo
id de Dropi en dos operaciones **ahora se puede** guardar, y repetido dentro de una operación
**sigue sin poderse**.

### Verificación contra producción

**Antes** (lectura pura, inmediatamente antes de aplicar):

| Tabla | Filas | Con operación | En `NULL` |
| -- | -- | -- | -- |
| `kapso_connection` | 1 | 1 | 0 |
| `dropi_connection` | 1 | 1 | 0 |
| `agent_settings` | 1 | 1 | 0 |
| `shopify_connection` | 0 | 0 | 0 |
| `conversations` | 1.688 | 1.688 | 0 |
| `dropi_orders` | 1.758 | *(sin columna)* | — |

**Después:**

| Tabla | `NOT NULL` | Filas | Con operación |
| -- | -- | -- | -- |
| `kapso_connection` | sí | 1 | 1 |
| `dropi_connection` | sí | 1 | 1 |
| `agent_settings` | sí | 1 | 1 |
| `shopify_connection` | sí | 0 | 0 |
| `dropi_orders` | sí | 1.758 | **1.758** |
| `conversations` | **no**, a propósito | 1.688 | 1.688 |

Cero filas atribuidas a una operación que no sea Guatemala. Los cinco únicos nuevos, puestos.

**Intacto:** `phone_number_id` sigue en `1226267277233200`, la WABA en `1676368750161510`,
`kind: production`, el modelo en `openai/gpt-5.4-mini`, el prompt en 7.728 caracteres,
`dropi_enabled` en `true` y **`dropi_dry_run` en `true`** — no se tocó. Volumen igual:
26.184 mensajes, 1.681 pedidos de tienda, 1.758 de logística, 1.688 conversaciones.

**Y el código nuevo corrido contra producción, en lectura pura**, comparado con lo que
devolvía el viejo `where(id = 1)`: la conexión de WhatsApp da el mismo `phone_number_id`, la
misma WABA y el mismo `kind`; la de logística el mismo `api_base_url` y el mismo usuario; la
configuración de agente la **misma fila, con el prompt de 7.728 caracteres y las nueve FK a
plantillas idénticas**; la tienda `null`, como antes, por camino distinto. Las segundas
llamadas (caché) devuelven lo mismo. Y el aislamiento: pedir la conexión de una operación que
no existe devuelve `null` en los cuatro accesores, **nunca la de Guatemala**.

### Cómo se comprobó que Guatemala no cambia

1. **`pnpm -r typecheck` limpio en los 4 paquetes.** Es LA verificación de este ticket, no un
   trámite: al volver obligatorio el parámetro, el compilador enumeró los llamadores uno por
   uno —fueron ~35 archivos— y no hay forma de que quedara ninguno.
2. **`pnpm --filter @wa/worker test`: 73 tests en 7 archivos, en verde.** Los **41 originales
   pasan sin tocar una línea** (`kapso/inbound` 10, `kapso/delivery` 13, `dropi/normalize` 12,
   `dropi/movements` 6) y los 11 del cruce por operación del lote 04 tampoco se tocaron.
   Bajó de 81 a 73 y el delta es todo del código que este ticket borró: `resolve.test.ts`
   19 → 14 (mueren los 4 de `canUseSingleOperationFallback` y los 2 de la clave de la
   operación única; entran 2 nuevos) y `agent-settings.test.ts` 10 → 7 (mueren los 3 de
   `agentSettingsScope`; los 5 de aislamiento se conservan enteros y se suman 2 que fijan que
   la fila `id = 1` ya no le responde a nadie salvo a su propia operación).
3. **La búsqueda literal**, pegada abajo, vacía.
4. **Las tres cachés, a mano**, con veredicto arriba.
5. **Producción antes y después**, con los números arriba.

```
$ grep -rn "\.id, 1)" apps packages --include="*.ts" --include="*.tsx"
$ grep -rn "\.id, [A-Z_]*ID)" apps packages --include="*.ts" --include="*.tsx"
$ grep -rn "GLOBAL_AGENT_SETTINGS" apps packages --include="*.ts" --include="*.tsx"
```

Las tres sin una sola línea. La segunda es la que importa además de la del ticket: el
`eq(kapsoConnection.id, SINGLETON_ID)` no lo atrapaba el grep literal, y era el mismo `id = 1`
con otro nombre.

### Lo que encontré y dejé como está

- **`jobs/followup.ts`** — el heurístico R1 no se tocó. Solo cambió de dónde sale la
  configuración.
- **`dropi_dry_run`** sigue en `true`.
- **`upsertDropiOrder` no vuelve a cruzar un pedido ya cruzado** (`needsMatch` exige
  `!existing.shopifyOrderRowId`). Con la columna de operación puesta, un pedido mal cruzado
  del pasado no se re-evalúa nunca. Hoy no hay ninguno —los 1.758 son de Guatemala— pero es
  un ticket aparte si algún día hay que re-cruzar.
- **`shopify_orders.order_id` tiene un único global** y el número de pedido de Shopify es por
  tienda. Es el mismo problema que tenía `dropi_orders`, en la tabla que decidí no tocar. No
  muerde hasta que exista la segunda tienda, y para entonces el ticket 08 tiene que resolver
  la atribución del pedido web de todos modos: es ahí donde va, con el dato de qué tienda lo
  mandó, no aquí a ciegas.

### Lo que queda abierto

- **El selector de operación del panel (ticket 07) es ahora bloqueante para Colombia.**
  `panelOperation()` lanza con dos operaciones activas: ocho pantallas dejan de funcionar el
  día que Colombia se ponga `active`. Es deliberado —falla ruidosa antes que país equivocado
  en silencio— pero significa que el 07 va **antes** que el 08.
- **`conversations.operation_id` sigue nullable**, con su lista de ocho llamadores arriba.
- **`shopify_orders.operation_id`**, si el ticket 08 concluye que la atribución por tienda de
  origen la necesita en la fila.
- **La clave primaria entera de las cuatro tablas de configuración.** El único por operación
  ya hace cumplir el modelo; convertir el `id` es cosmética con riesgo, y no la hice.
- **`invalidateOperationsCache()` no tiene llamador.** Es para el ticket 08, que crea la
  operación colombiana: sin ella, darla de alta tarda hasta 30 s en verse.

### Sobre el deploy

**La `0021` deja de ser compatible con el worker viejo**, que inserta en `dropi_orders` sin
operación. El radio, medido: `upsertDropiOrder` corre con `try/catch` por fila, así que un
`INSERT` que falle mata esa fila y el bucle sigue; los pedidos ya existentes se siguen
actualizando (el camino `UPDATE` no toca `operation_id`) y el pedido nuevo que falle aparece
en el siguiente ciclo. O sea, retraso de hasta un ciclo de 15 min sobre los pedidos nuevos
—del orden de un pedido, a ~17 al día— y no pérdida. Aun así, el worker de esta rama tiene
que deployarse pronto.
