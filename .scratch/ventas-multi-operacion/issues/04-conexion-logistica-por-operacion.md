# 04 — La conexión de logística cuelga de la operación

**What to build:** Cada operación tiene su propia conexión de logística, y el seguimiento de guías, novedades y entregas ocurre dentro de su operación.

Tercer lote: diecinueve referencias.

**Blocked by:** 01

**Status:** resolved — worktree `op-04-dropi`, tanda del 16-ago-2026

- [x] La conexión de logística declara a qué operación pertenece.
- [x] El sondeo, la sincronización y las notificaciones se ejecutan por operación.
- [x] Los pedidos de logística se cruzan solo contra pedidos de su misma operación — con un hueco medido, ver abajo.
- [x] Los diecinueve llamadores existentes pasan a resolver por operación.
- [x] El comportamiento de la operación de Guatemala no cambia.

**Nota para revisar antes de replicar en Colombia:** el modo simulación está activo — las confirmaciones a logística no se envían de verdad. Confirmar si es intencional.

## Medido contra el código (16-ago-2026)

**«Diecinueve referencias» eran menciones del símbolo.** Los call sites reales de `getDropiConnection()` son **once**, en nueve archivos:

`dropi/config.ts` (donde vive, línea 9) · `dropi/auth.ts` · `dropi/notify.ts` · `dropi/2fa-inbound.ts` · `agent/escalation.ts` · `jobs/dropi-auth-refresh.ts` · `jobs/dropi-novedad-handoff.ts` · `jobs/dropi-novedad-reminder.ts` · `routes/dropi.ts`

`upsertDropiConnection()` (`dropi/config.ts:28`) escribe con `where(eq(dropiConnection.id, 1))` y también hay que parametrizarlo. El accesor cachea 30 segundos en variable de módulo: esa caché tiene que quedar indexada por operación o desaparecer, o devolverá la conexión de otro país sin fallar.

**Este worktree es el dueño único de `apps/worker/src/dropi/notify.ts`.** El ticket 05 corre en paralelo y ese archivo es el único que ambos rozan — pero el 05 solo lo usa como *anotación de tipo* (`typeof agentSettings.$inferSelect` en las líneas 41 y 194: recibe la configuración por parámetro, no la lee). Su tipo no cambia, así que el 05 no tiene por qué editarlo. Tú sí: la línea 139 llama `getDropiConnection()`.

**`dropi_dry_run` está en `true` y no se toca.** Es el único freno del sistema y cubre solo las confirmaciones a logística. Cambiarlo dispararía confirmaciones reales sobre 1.755 pedidos; es una decisión con dueño, no un efecto colateral de un refactor.

**Producción:** 1 fila, `https://api.dropi.gt/api`, user 12178, con auto-login y 2FA por WhatsApp. `dropi/auth.ts` son 585 líneas — el archivo más grande que toca este lote.

## Answer — construido el 16-ago-2026

**La conexión de logística cuelga de su operación, y todo lo que habla con Dropi recibe la operación como parámetro obligatorio.** Ningún accesor de este lote sigue devolviendo «la» conexión.

### La forma del accesor

El parámetro es la fila de operación entera (`Operation` de `@wa/db`), no un id suelto:

```ts
getDropiConnection(op: Operation): Promise<DropiConnection | null>
upsertDropiConnection(op: Operation, patch: Partial<DropiConnection>): Promise<void>
invalidateDropiConnectionCache(op: Operation): void
```

Pasar la fila y no un `string` es lo que hace que el error no se pueda escribir: un id de conversación o de contacto es también un `string` y habría compilado. Y de paso el llamador tiene el `country_code` a mano para los logs, que es cómo se ve en producción qué operación corrió.

Hay además una versión **con red**, siguiendo el patrón que dejó el lote de WhatsApp:

```ts
resolveDropiConnection(op: Operation): Promise<DropiConnection | null>
```

Cae en la fila singleton **huérfana** —la que quedaría si alguien creara una conexión con el código viejo, que insertaba sin operación— y **solo si `op` es la única operación activa**: en ese caso esa fila no puede ser de otro país. Deja un `logger.error` y se desarma sola el día que Colombia opere, sin que nadie tenga que acordarse de quitarla.

**La red va donde perderla frena la operación** —autenticación, renovación de token, el CDN de la guía, el teléfono del admin— y **no** en la ruta que pinta el panel, que usa la estricta porque la pantalla tiene que decir la verdad de lo que hay configurado. `upsertDropiConnection` usa la misma red y de paso la repara: escribir sobre la fila huérfana la deja asociada a su operación en vez de crear una duplicada.

La lectura ya no es `where(id = 1)` sino `where(operation_id = op.id)`, y la escritura actualiza por la clave primaria de la fila encontrada. Al insertar —camino muerto para Guatemala, que ya tiene su fila— el `id` sale de `max(id) + 1`: es un entero con `default 1` heredado del singleton, y la conexión de una segunda operación chocaría contra la clave primaria.

**Los helpers de operación quedaron locales a `dropi/config.ts`**, por acuerdo con la sesión que coordina la tanda: el lote de kapso+tienda define la forma común y ahí se unifican.

```ts
listActiveOperations(): Promise<Operation[]>
requireSoleActiveOperation(): Promise<Operation>
resolveOperationForContact(contactId: string | null): Promise<Operation>
findOperationByDropiAdminPhone(digits: string): Promise<{operation, connection} | null>
```

Cada uno responde a un modo distinto de saber la operación, y ninguno es un default global:

- **Por el llamador** — el sondeo y la sincronización recorren `listActiveOperations()` y trabajan una por una.
- **Por el dato** — `findOperationByDropiAdminPhone` es el camino del 2FA entrante: un código que llega por WhatsApp no trae más contexto que quién lo mandó, así que se busca la operación cuya logística tiene ese teléfono de administrador. Sustituye a leer «la» conexión y comparar.
- **Por la conversación** — `resolveOperationForContact` lee `conversations.operation_id`, la columna que backfilleó el ticket 01. La usan la escalación, el recordatorio y el handoff de novedades: el admin a avisar es el de la operación del cliente.
- **El puente** — `requireSoleActiveOperation` es para quien todavía no puede recibir la operación: el panel, que no tiene selector hasta el ticket 07, y las conversaciones nuevas, que todavía no traen `operation_id` porque quien la escribe es el lote 02.

**El puente lanza con dos operaciones activas en vez de elegir.** Elegir en silencio es exactamente el error que este lote existe para hacer imposible. Lanzar lo convierte en algo que hay que quitar antes de abrir Colombia, no en un default que sobrevive callado al contract.

### Qué se hizo con la caché

Pasó de una variable de módulo con **una sola entrada** a un `Map` indexado por `operation.id`, con el mismo TTL de 30 segundos. `invalidateDropiConnectionCache(op)` ahora borra solo la operación tocada: la de al lado sigue siendo válida.

Era el error silencioso más probable del lote. Con una sola entrada, el sondeo de Colombia habría recibido la conexión de Guatemala durante 30 segundos —sin fallar, sin compilar mal— y habría pedido guías a la cuenta Dropi del país equivocado.

### El cruce contra los pedidos de tienda

Vive en `dropi/match-shopify.ts`, en dos funciones puras probadas con fixtures (`match-shopify.test.ts`, 11 casos):

```ts
belongsToOperation(candidate: {currency: string | null}, op: MatchOperation): boolean
pickShopifyMatch({operation, customerName, candidates}): {match, rejected}
```

La lógica de puntaje por nombre es la que ya vivía en `jobs/dropi-sync.ts`, movida sin cambios: el mismo umbral de 0,8, el mismo margen de 0,15 sobre el segundo candidato, la misma confianza alta/baja. Lo único nuevo es que **la operación es un parámetro obligatorio y los candidatos ajenos se descartan antes de puntuar**.

El test que importa es el de un candidato colombiano con el nombre exacto compitiendo contra uno guatemalteco con el nombre distinto: sin el filtro ganaba el colombiano.

**El hueco, medido:** `shopify_orders` y `dropi_orders` **no tienen `operation_id`** — el expand del ticket 01 llegó a las cuatro conexiones y a `conversations`, no a las tablas de datos. La única señal que ata hoy un pedido de tienda a su operación es la **moneda**, que el ticket 01 dejó con vocabulario compartido a propósito (`operations.currency` ISO-4217, igual que `shopify_orders.currency`). Sobre eso se apoya el filtro, y un pedido **sin** moneda no se atribuye a ninguna operación: un cruce que no ocurre queda visible como no cruzado en /pedidos, mientras que un cruce al país equivocado no lo nota nadie hasta que sale el envío.

En producción los 1.681 pedidos de tienda traen `GTQ` y ninguno viene vacío, así que hoy el filtro no descarta absolutamente nada.

**Lo que falta para cerrarlo del todo son dos columnas, y no las generé** porque el encargo lo prohíbe explícitamente: `dropi_orders.operation_id` y `shopify_orders.operation_id`. Con ellas, el sondeo acotaría su conjunto activo por operación y el cruce filtraría en SQL en vez de por moneda. Es decisión del dueño del expand — ver «Lo que queda abierto».

### Las otras claves que eran únicas *dentro* de una operación, no *entre* operaciones

Aplicado el criterio que trajo el lote de la tienda —donde apareció una `productCache` indexada por el GID del producto, que es por tienda—, en `dropi/` había cuatro claves con el mismo problema, todas construidas sobre el **id de pedido de Dropi**, que es único dentro de una cuenta y no entre cuentas:

- El `dedupKey` de la notificación por estado (`dropi:<id>:<estado>`).
- Los tres de novedad: primer aviso, recordatorio, escalación y handoff.

Dos operaciones con el pedido número 942698 se habrían tapado el mensaje una a la otra: el cliente del segundo país no recibe nada, y no falla nada. Ahora la clave lleva el **uuid de la fila** (`dropi:<uuid>:<estado>`), que es único por construcción. Es seguro cambiarlas porque cada envío tiene además su guarda en base de datos —`last_notified_status`, `novedad_first_notified_at`, `novedad_reminder_at`, `novedad_escalated_at`—, que es la que de verdad impide el duplicado; el `dedupKey` es la segunda línea. Y el id legible de Dropi sigue a mano: `sourceRef` guarda la misma fila.

El quinto era el ping de 2FA (`dropi-2fa-<hora>`), que lleva el país porque el bucket horario es lo único que lo hacía único.

Revisadas y **sin** problema: `cachedPublicIp` en `auth.ts` (es la IP de la máquina, la misma para todas las operaciones) y los `singletonKey` de pg-boss, que ya usan uuid de fila.

### Por operación: el sondeo, la sincronización, el token y las notificaciones

Cada job quedó partido en dos: la unidad real de trabajo, que recibe la operación, y el recorrido, que las visita todas.

| Job | Unidad | Recorrido |
| -- | -- | -- |
| Sincronización | `runDropiSyncForOperation(op, s, opts)` | `runDropiSync(opts)` |
| Sondeo | `runDropiPollForOperation(op, s)` | `runDropiPoll()` |
| Renovación de token | `runDropiAuthRefreshForOperation(op)` | `runDropiAuthRefresh()` |

Un fallo de una operación no calla a las demás; **si ninguna pudo correr, el error se propaga igual que antes**, para que el job se reintente y el panel muestre el error en vez de un resultado vacío. Con una sola operación, eso es exactamente el comportamiento de hoy.

`maybeNotifyDropiStatus(op, order, s)` recibe la operación porque de ahí sale el CDN del PDF de la guía. El resto de su firma no cambió: la configuración de agente sigue llegando por parámetro, que es lo que el lote 05 necesita.

También bajaron a la operación `dropiFetch`, `getValidDropiAuth`, `refreshDropiAuth`, `submitDropi2FACode`, `listOrders`, `listAllOrders` y `confirmOrder`. El id de Dropi es único **dentro** de una cuenta, no entre cuentas: sin la operación, confirmar el pedido `942698` podría confirmar el de otro país con el mismo número.

Dos detalles que eran bugs de multi-operación agazapados y quedaron corregidos de paso: el `dedupKey` del ping de 2FA (`dropi-2fa-<hora>`) ahora lleva el país, porque dos logísticas pidiendo código en la misma hora se tapaban una a la otra; y `persistDropiToken` ya no cae a la constante `https://api.dropi.gt/api`, que es guatemalteca, sino a la URL de la conexión de su operación.

### Cómo se comprobó que Guatemala no cambia

1. **`pnpm -r typecheck` limpio en los 4 paquetes.** Es la red principal: con el parámetro obligatorio, un llamador sin migrar no compila. Los once call sites salieron todos por ahí.
2. **`pnpm --filter @wa/worker test`: 52 tests en 5 archivos.** Los 41 anteriores pasan **sin una sola modificación** —`dropi/normalize.test.ts` y `dropi/movements.test.ts` incluidos— y los 11 nuevos son del cruce por operación.
3. **Contra producción, en lectura, con el código nuevo.** Un script desechable comparó el accesor nuevo contra el viejo:
   - `getDropiConnection(Guatemala)` devuelve **byte por byte la misma fila** que `where(id = 1)`: id 1, `https://api.dropi.gt/api`, user 12178.
   - La segunda llamada (caché) devuelve lo mismo.
   - El 2FA entrante encuentra Guatemala por el teléfono del admin, y **no** encuentra nada con un teléfono ajeno.
   - Los **1.758 pedidos de logística resuelven todos a Guatemala**: los 1.729 con contacto por su conversación, y los 29 sin contacto por el puente. Ninguno queda sin operación.
4. **Los datos que sostienen el filtro por moneda**, consultados antes de escribirlo: 1.681 pedidos de tienda, todos `GTQ`, cero nulos; `dropi_connection.operation_id` apuntando a Guatemala; 0 conversaciones sin operación entre las de los pedidos de logística.

Lo que **no** se hizo, a propósito: no se arrancó el worker, no se hizo login contra Dropi, no se mandó ningún mensaje y no se escribió una sola fila.

### Para quien mergee

Esta rama sale de `cdc6cf8`, o sea de antes de que entraran los lotes 02–03 y 05. Cuatro archivos se cruzan con ellos: `jobs/dropi-confirm.ts`, `jobs/dropi-poll.ts`, `jobs/dropi-sync.ts` y `jobs/dropi-novedad-notify.ts`.

**En los cuatro, este lote toca solo líneas de la conexión de logística.** Ninguna lectura de configuración de agente se reescribió. Para que el merge de tres vías tenga menos que resolver, `runDropiSync` y `runDropiPoll` **conservan su nombre, su posición en el archivo y sus primeras líneas** —justo donde vive la lectura de configuración que el lote 05 cambió—; lo nuevo (`runDropiSyncForOperation`, `runDropiPollForOperation`) va debajo.

Lo único que hay que empatar a mano es el tipo del parámetro de configuración de las dos funciones nuevas, hoy `s: typeof agentSettings.$inferSelect`, que en `main` puede llamarse de otra forma. Y los helpers locales de operación de `dropi/config.ts` tienen equivalente directo en `apps/worker/src/operations/` de `main`: `listActiveOperations` ↔ el listado de activas, `requireSoleActiveOperation` ↔ `getSingleOperationId` (con la diferencia de que el mío lanza en vez de devolver `null`), y la caché por operación ↔ `OperationScopedCache`.

### ¿El modo simulación es intencional? Sí, y no está frenando lo que parece

`dropi_dry_run` **no se tocó**. Lo que dice el código y el historial:

- Es el **valor por defecto**, en el esquema (`.notNull().default(true)`) y en la validación (`z.boolean().default(true)`). Nadie lo encendió: nunca se apagó.
- Está **expuesto como interruptor en el panel** (/agente → «Seguimiento Dropi → Dry-run», con la ayuda «No envía PUT a Dropi — solo registra lo que haría»). Es una bandera de producto, no una constante olvidada en el código.
- `git log -S dropiDryRun` da dos commits. Nace con la integración (`27a0ddc`, 1-may-2026) y en el segundo (`84b62c0`) pasa lo decisivo: **«quita auto-confirm: classifier y ruta web/inbox ya no disparan PUT a Dropi — único camino es el botón manual»**. Y el botón manual llama `confirmDropiOrderById(id, {force: true})`, que **salta el dry-run a propósito**.

O sea: la simulación cubre el camino automático, que además ya fue desconectado por otra vía; el camino manual confirma de verdad. Producción lo confirma: de 1.758 pedidos, **5 simulacros** (2–6 de mayo, los días en que el auto-confirm todavía existía) y **3 PUT reales** (6-may, 1-jul y 3-jul, ya con el botón manual). El camino de confirmación, en cualquiera de sus dos formas, se usa en 8 pedidos de 1.758.

**Para replicar en Colombia:** copiar `dropi_dry_run: true` es reproducir la decisión que ya está tomada, no arrastrar un olvido. La pregunta de verdad no es si la bandera está bien, sino si la confirmación automática a la logística debe existir — hoy no existe, y encender la bandera sin más no la resucita.

### Lo que queda abierto

- **Las dos columnas del cruce.** `dropi_orders.operation_id` y `shopify_orders.operation_id` son lo único que cierra el criterio 3 al nivel de los datos. Sin ellas, el sondeo de una operación puede toparse con un pedido guardado de otra que tenga el mismo id de Dropi; el guardia que quedó puesto (comparar la moneda del pedido de tienda cruzado) tapa el caso de los pedidos ya cruzados —1.729 de 1.758— pero no el de los 29 sin cruzar. Es el expand que quedó corto, y es decisión del dueño de la migración, no de este lote.
- **El puente `requireSoleActiveOperation`.** Lo borra el contract (ticket 06). Mientras exista, el panel resuelve la única operación activa; cuando llegue el selector (ticket 07) se cambia `panelOperation()` en `routes/dropi.ts` y las seis rutas quedan migradas de una vez.
- **La clave primaria entera de `dropi_connection`.** Sigue siendo el `id` con `default 1` del singleton. El upsert ya calcula el siguiente, pero el modelo pide una clave por operación; es material del contract.
- **Los helpers de operación son locales a `dropi/config.ts`** a propósito, para que la sesión que coordina unifique las tres formas al mergear.
- **Las seis lecturas de `dropiEnabled` / `dropiDryRun` en ámbito global explícito**, que el ticket 05 dejó a propósito en `dropi-confirm`, `dropi-poll`, `dropi-sync` y `dropi-novedad-notify`: lo que decide si se confirma en logística pertenece a la conexión de logística, y cuando el 05 trabajó, la conexión todavía no declaraba su operación. **Este lote las desbloquea pero no las cierra**: ahora la conexión ya dice de qué operación es, así que convertirlas en resolución por operación es del ticket 06. Este lote no las tocó.
- **`apps/worker/src/index.ts` no necesita ningún cambio.** Los nombres que el arranque importa —`startDropiSyncWorker`, `scheduleDropiSync`, `startDropiPollWorker`, `scheduleDropiPoll`, `startDropiAuthRefreshWorker`, `scheduleDropiAuthRefresh` y los tres de novedades— siguen existiendo con la misma firma sin parámetros. El recorrido por operaciones ocurre dentro de cada job.
