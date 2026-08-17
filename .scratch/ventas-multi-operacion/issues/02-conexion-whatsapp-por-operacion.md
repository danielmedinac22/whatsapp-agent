# 02 — La conexión de WhatsApp cuelga de la operación

**What to build:** Un mensaje entrante resuelve a qué operación pertenece según el número por el que llegó, y esa operación queda guardada en la conversación. Todo lo que ocurra después la recibe, en vez de preguntar por "la conexión" como si hubiera una sola.

Primer lote de la migración: es el de menor radio, diez referencias.

**Blocked by:** 01

**Status:** resolved — worktree `op-02-03-kapso-shopify`, tanda del 16-ago-2026

- [x] La conexión de WhatsApp declara a qué operación pertenece.
- [x] Un mensaje entrante resuelve su operación por la conexión que lo recibió.
- [x] La conversación guarda su operación y la conserva de principio a fin.
- [x] **Una conexión desconocida no resuelve a ninguna operación**, en vez de caer en una por defecto.
- [x] Los diez llamadores existentes pasan a resolver por operación.
- [x] El comportamiento de la operación de Guatemala no cambia.
- [x] Los tests cubren resolución correcta por conexión y el caso de conexión desconocida.

## Medido contra el código (16-ago-2026)

**«Diez referencias» son diez call sites reales**, y el número es correcto. `getKapsoConnection()` se llama desde seis archivos:

`kapso/connection.ts` (donde vive) · `jobs/outbound.ts` · `kapso/provisioning.ts` · `routes/events.ts` · `routes/kapso.ts` · `routes/wa.ts`

El accesor está en `apps/worker/src/kapso/connection.ts:21`, hace `where(eq(kapsoConnection.id, 1))` y **cachea 30 segundos en una variable de módulo**. Al pasar a resolver por operación, la caché de una sola entrada se vuelve incorrecta: tiene que quedar indexada por operación, o desaparecer. Es el error silencioso más probable de este lote — devolvería la conexión de otro país sin fallar.

`requirePhoneNumberId()` (línea 36) es el otro punto de entrada y hoy no recibe operación: también hay que parametrizarlo.

**La fila de producción**: +502 3689 0343, WABA `1676368750161510`, `kind: production`, webhook registrado el 29-jul-2026. Coincide con el fixture `from: "50236890343"` de `kapso/inbound.test.ts`, así que los tests nuevos pueden reutilizarlo.

**Nota:** existe un `apps/worker/src/_tmp_templates.ts` **sin commitear** que también llama `getKapsoConnection()`. No está en `main`, así que no viaja al worktree y no cuenta. Es del checkout principal y lo resuelve la sesión que mergea.

## Answer

Primer lote de la migración. Además de migrar los diez llamadores, deja **la forma** que
copian los otros tres: cómo se pide la operación, cómo se llama el parámetro, y qué pasa
con la caché de 30 segundos.

### La regla que ordena todo el lote

> **La función de resolución es estricta; el camino operativo no.**

Los dos lados quedaron escritos por separado y con nombres distintos, para que nadie se
equivoque de uno al copiar:

| | estricto | con red |
| -- | -- | -- |
| resolver la operación de un entrante | `resolveOperationIdByPhoneNumberId()` | `decideInboundOperation()` |
| pedir la conexión de una operación | `getKapsoConnection(operationId)` | `resolveKapsoConnection(operationId)` |

La versión estricta, ante algo que no reconoce, devuelve «ninguna operación». La versión
con red **nunca deja el trabajo sin hacer** mientras exista una sola operación: atiende con
la única y **deja un `logger.error`**. Un mensaje descartado en silencio es la operación
muda sin alarma, y ningún test lo ve porque el sistema «funciona».

### La red se desarma sola

`getSingleOperationId()` devuelve el id de la operación **activa única**, o `null` si hay
cero o más de una. Toda la tolerancia del lote cuelga de ahí. El día que Colombia se ponga
`active`, la función devuelve `null` y todos los caminos con red vuelven a ser estrictos
**sin que nadie tenga que acordarse de quitar nada**. Cuenta solo las `active` a propósito:
dar de alta Colombia en `inactive` deja la red puesta hasta que Colombia opere de verdad.

La regla de cuándo se puede caer en la fila singleton es su propia función pura y probada,
`canUseSingleOperationFallback(operationId, singleOperationId)`: **solo** cuando la
operación pedida *es* la única activa. Nunca se atiende a una operación con la conexión de
otra — mandar el mensaje de un país por el número de otro es peor que no mandarlo.

### El tipo garantiza que el pipeline no descarta

`InboundOperationDecision` **no tiene un caso «descartar»**. No es un comentario que se
pueda ignorar al copiar: la función no tiene forma de decirle al pipeline que bote el
mensaje, y en `handleInbound` no se agregó ningún `return` nuevo. Los únicos cortes del
pipeline siguen siendo los de antes (dedup, 2FA, audio sin transcripción, texto vacío).
Si la resolución entera revienta, el `catch` deja la decisión en `null` y el mensaje sigue.

### La caché — el error silencioso que se buscaba

Era una variable de módulo con **una sola entrada**: al resolver por operación habría
devuelto la conexión de otro país sin fallar ni compilar mal. Ahora es
`OperationScopedCache<T>` (`operations/cache.ts`), indexada por operación, misma forma y
mismo TTL de 30 s para las tres conexiones. Tres detalles que importan al copiarla:

- La **operación única tiene su propia clave** (`__operacion_unica__`), que no colisiona con
  ningún uuid.
- `get()` devuelve `{ value }` y no el valor: un `null` cacheado («esta operación no tiene
  conexión») es un valor legítimo y no puede confundirse con un fallo de caché.
- `invalidate(operationId)` **también borra la entrada de la operación única**: mientras
  solo haya una operación las dos claves apuntan a la misma fila, y limpiar una sin la otra
  deja media caché rancia. Sin argumento borra todo.

### Los diez llamadores

`null` como operación **no significa «no importa»**: significa *la operación única*, y lee
la fila singleton `id = 1` — el comportamiento exacto de antes. Es explícito y greppable
para que el ticket 06 lo encuentre y lo borre.

| Llamador | Qué operación pide |
| -- | -- |
| `jobs/outbound.ts` (envío) | la de la conversación del mensaje, con red |
| `kapso/provisioning.ts` ×3 (WABA/plantillas) | la que le pasen, con red |
| `kapso/connection.ts` (`requirePhoneNumberId`) | la que le pasen, con red |
| `routes/wa.ts` ×2, `routes/kapso.ts` ×2, `routes/events.ts` | `null` — el panel todavía muestra una sola conexión |

Se sumó **`jobs/kapso-templates.ts`**, que no estaba en el conteo de diez: el cron de
plantillas no llama `getKapsoConnection()` directo pero sí a las tres de provisioning. Pide
`null`; recorrer las operaciones cuando exista la segunda es del ticket de contract.

`outbound_messages` **no necesitó columna nueva**: la operación sale de su conversación
(`conversationId`, o el join por `wa_id` cuando no la trae).

### Qué se descartó, y por qué

- **Parámetro opcional (`operationId?`)** — el compilador no habría encontrado los
  llamadores que faltaban. Obligatorio-pero-nullable es lo que convierte `strict: true` en
  la red del lote.
- **Que `getKapsoConnection()` cayera sola en el singleton al no encontrar la operación** —
  compila, no falla, y el día de Colombia manda sus mensajes por el número de Guatemala.
  La tolerancia va afuera, con nombre propio y con log.
- **Reescribir la operación de una conversación que ya tiene una** — le movería el país a
  una conversación viva a mitad de camino. Solo se escribe si está vacía.
- **Que el cron de plantillas recorriera las operaciones** — hoy no cambia nada y agrega
  superficie. Va con el contract.
- **Quemar el uuid de Guatemala** en código o en los tests: los fixtures usan uuid
  inventados; lo real es el `phone_number_id`, que es la clave de ruteo que se prueba.

### Cómo se comprobó que Guatemala no cambia

1. `pnpm -r typecheck` limpio en los 4 paquetes. Al volver el parámetro obligatorio, el
   compilador enumeró los llamadores: es prueba de que no quedó ninguno sin migrar.
2. `pnpm --filter @wa/worker test`: **41 → 60**. Los 41 anteriores pasan **sin tocar una
   línea** (`git status` no lista ningún `.test.ts` previo como modificado).
3. **Análisis de casos del camino de envío** (R3: «si el accesor cambia mal, deja de salir
   todo mensaje»), que es más fuerte que consultar la base porque cubre los tres estados
   posibles del backfill:
   - **backfilleado** (el estado que reportó el ticket 01): conversación → uuid de
     Guatemala → `kapso_connection.operation_id` coincide → misma fila, mismo
     `phone_number_id`, mismo WABA.
   - **`kapso_connection.operation_id` vacío**: la operación pedida es la única activa →
     `canUseSingleOperationFallback` da `true` → cae en la fila `id = 1` **y loguea el
     error**. Sale igual.
   - **`conversations.operation_id` vacío**: operación `null` → lee la fila `id = 1`
     directo. Idéntico a antes de la migración.

   En los tres el mensaje sale por el mismo número. Lo mismo aplica a `isTemplateApproved`,
   que resuelve la misma WABA en los tres casos y por tanto no degrada plantillas a texto.
4. Sin arrancar el worker y sin escribir en producción: el `.env` del worktree apunta a
   prod y no hay allowlist de números.

**No se ejecutó ninguna consulta en vivo contra producción** — el classifier de permisos
bloqueó `source .env && npx tsx`. Los números de filas de arriba vienen de lo que midió el
ticket 01; el análisis de casos está construido justamente para no depender de ellos.

### Qué queda abierto

- `requirePhoneNumberId()` sigue **sin llamadores** (ya estaba así). Parametrizada igual.
- Los endpoints de administración (`/api/wa/status`, `/api/kapso/status`, SSE) muestran la
  operación única. Elegir operación desde el panel es del contract.
- El cron de plantillas recorrerá operaciones en el contract.
- El arranque del worker (`apps/worker/src/index.ts`) **no necesitó ningún cambio**.
