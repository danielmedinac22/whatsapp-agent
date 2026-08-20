# 02 — Que responder deje huella

**What to build:** Que contestar una conversación apague su contador de sin leer
y quede registrado, sin importar desde dónde se conteste.

**Blocked by:** nada. Va en paralelo con el 01 y con el 03 — es el único de los
tres que vive en `apps/worker`.

**Status:** resolved — desplegado 20-ago-2026; la confirmación en producción espera tráfico

## Qué está mal hoy, medido

`unread_count` se incrementa en cada entrante
(`apps/worker/src/inbound/pipeline.ts:360`) y se pone en cero **en un solo
sitio**: `markRead` (`apps/web/src/lib/queries.ts:795`), que corre cuando alguien
**abre la conversación en el panel**. Si el agente contesta, o el asesor contesta
desde el celular, el contador queda en rojo para siempre.

El resultado en Guatemala, 19-ago-2026: de las 54 conversaciones que el panel
marcaba como «necesita atención», **30 ya habían sido respondidas**.

Y `last_outbound_at`, que sería la forma barata de saberlo, **no sirve**. Lo
escribe un solo sitio (`apps/worker/src/jobs/outbound.ts:616`) y no cubre todo lo
que sale:

| | |
| -- | --: |
| `last_inbound_at` desfasado más de 5s de la realidad | **0** de 1.759 |
| Desfase medio del entrante | 0,01 s |
| **`last_outbound_at` en `null` habiendo salientes** | **536** |
| `last_outbound_at` desfasado más de 5s | 319 más |

O sea: la columna del entrante es confiable y la del saliente miente en **855 de
1.759**.

## La taxonomía ya existe, y está limpia

`outbound_messages.source`, contra producción:

| Conversacional | | Notificación | |
| -- | --: | -- | --: |
| `agent` | 4.859 | `dropi_2fa` | 5.979 |
| `manual` | 352 | `dropi_status` | 4.542 |
| | | `confirmation_ack` | 1.528 |
| | | `followup` | 980 |
| | | `remarketing` | 379 |
| | | `escalation` | 93 |

**`escalation` no es conversacional**: es el aviso de que hace falta una persona,
no la respuesta. Que salga no significa que alguien contestó.

**Y `messages` sola no alcanza.** Hay 19.281 salientes en `messages` y 18.712
filas en `outbound_messages`: ~569 salieron por otra puerta. Dentro de `messages`
lo único confiable es `from_agent` —exactamente los 4.859 del agente—, porque
**`sent_by_user_id` está en `null` en los 19.281**. La tubería existe
(`enqueueOutbound` lo acepta, `outbound.ts:69`) y nadie se la pasa.

## Qué hay que construir

### 1. Un solo sitio que decida «este saliente es conversacional»

Una función pura sobre `source`, con su test, que **no compile si aparece un
`source` nuevo** sin que alguien diga de qué lado cae. Es el mismo patrón que
`logisticsPhase` en `packages/db/src/inbox.ts:104` — `never` exhaustivo, no un
`else`.

### 2. En ese envío, dos escrituras

- `conversations.unread_count = 0`
- `conversations.last_outbound_at = <ahora>`

Las dos en el mismo sitio, porque son la misma verdad dicha dos veces. Que la
columna del saliente deje de mentir es un efecto secundario gratis de arreglar el
contador.

### 3. El panel pasa `sentByUserId`

El envío manual del panel identifica a quién lo mandó. Es un parámetro que ya
existe y nadie alimenta. Sin él, «Asignadas» y «quién contestó» no van a poder
decir nada nunca — que era medio el punto de «TRABAJARLA YO».

**El reparto:** vos hacés la mitad del worker —que `enqueueOutbound` acepte y
persista `sentByUserId`, y que el envío manual lo guarde—. La mitad del panel
—pasarlo desde la acción de enviar— **es del ticket 03**, que es dueño de
`apps/web`. Dejá la tuya funcionando con `null` y andá.

## Lo que NO hay que hacer

**No hay backfill.** El corte de recencia de 30 días del ticket 03 ya deja fuera
todo lo que un backfill arreglaría, y a cambio sería una escritura masiva sobre
la tabla viva de Guatemala. Se arregla **solo hacia adelante**.

**No uses `messages.sent_by_user_id` como señal.** Está muerto: 0 de 19.281.
Arreglarlo hacia adelante (punto 3) es parte del ticket; leerlo como si ya
funcionara, no.

**No toques `markRead`.** Sigue siendo válido: abrir la conversación también es
haberla leído. Este ticket **agrega** un segundo sitio, no reemplaza el primero.

## Superficie y dueño

Este ticket vive **entero en `apps/worker`** y es dueño de:

- `apps/worker/src/jobs/outbound.ts`
- El módulo nuevo que clasifica el `source` (elegí vos dónde, dentro de
  `apps/worker/src/`)

**No toques `apps/web` ni `packages/db/src/schema.ts`.** El 01 corre en paralelo
con vos en `packages/db` y en la barra lateral; el 03 arranca después en
`apps/web`. No comparten un solo archivo con este ticket, y así queremos que siga.

Si necesitás un tipo nuevo en `@wa/db`, **pedímelo a mí** en vez de agregarlo:
`schema.ts` es la costura del monorepo y este ciclo la tiene el 01.

## Lo que hay que respetar

- **Este es el ticket riesgoso del lote: toca el camino de envío del número que
  factura.** Leé `.scratch/panel-de-ventas/no-regresion.md` antes de empezar.
- **No le mandes mensajes a números de clientes reales.** No hay allowlist ni
  modo observador en este repo, y `dropi_dry_run` cubre solo las confirmaciones a
  Dropi, no el envío de WhatsApp. Un worker local con el `.env` de producción le
  escribe a gente de verdad. Si necesitás probar un envío, el número y la
  autorización los pone el humano.
- La escritura tiene que ser **idempotente y barata**: sale en cada mensaje
  saliente conversacional, que hoy son ~5.200 de 18.700.
- Si el envío falla, la conversación **no** se marca como respondida. Se estampa
  cuando el mensaje salió, no cuando se encoló.

## Criterios

- [ ] Existe una función pura que clasifica un `source` como conversacional o no,
      con un caso de test por cada uno de los ocho valores que existen en
      producción, y que **no compila** si aparece uno nuevo.
- [ ] `escalation` está del lado **no conversacional**, con el porqué escrito.
- [ ] Un envío del agente pone `unread_count` en 0 y estampa `last_outbound_at`.
- [ ] Un envío manual del panel hace lo mismo **y** deja `sent_by_user_id`.
- [ ] Una notificación logística (`dropi_status`, `followup`, `remarketing`,
      `confirmation_ack`, `dropi_2fa`) **no** hace ninguna de las dos cosas.
- [ ] Un envío que falla no marca nada.
- [ ] `markRead` sigue funcionando igual.
- [ ] `pnpm -r typecheck` limpio y `pnpm --filter @wa/worker test` en verde.

## No-regresión

La afirmación más riesgosa de este ticket es **«no cambió qué se envía, solo qué
se anota»**. Compruébala: `outbound_messages` agrupado por `source` antes y
después de desplegar tiene que dar el mismo perfil, y `messages` con
`direction='out'` tiene que seguir creciendo al mismo ritmo.

La segunda: que ninguna conversación quede marcada como respondida sin haberlo
sido. Contra producción, después del deploy, no debería existir ninguna fila con
`unread_count = 0` cuyo último mensaje sea entrante y posterior a
`last_outbound_at`.

## Answer

**Contestar apaga el contador, y avisar no.** Desplegado el 20-ago-2026.

Hasta hoy el rojo solo se apagaba abriendo la conversación en el panel, así que
contestar desde el celular lo dejaba puesto para siempre. El agujero medido era
más grande que el del ticket: **540 conversaciones** cuya última respuesta real
seguía con el contador encendido, no las 30 de la rodaja que el panel marcaba.

La decisión vive en un solo sitio,
`apps/worker/src/inbox/saliente-conversacional.ts`, con `switch` exhaustivo: si el
esquema gana un `source` nuevo, deja de compilar. Se comprobó agregando un noveno
valor al enum y viendo fallar tanto `tsc` como la prueba que compara la lista de
casos contra `outboundSource.enumValues`.

`escalation` quedó del lado de las notificaciones, y es la que más se parece a una
respuesta: es el aviso de que hace falta una persona, no la respuesta de esa
persona. Apagar el contador con ella escondería justo la conversación que el
agente pidió mirar.

### La corrección al ticket, con el número en la mano

El ticket daba `last_outbound_at` por rota (855 desfases sobre 1.759) y mandaba
recortarla a lo conversacional. **Las dos cosas eran incorrectas**, y salieron al
agrupar los desfases por fecha:

| Mes del último saliente | Conversaciones | Sin estampa | Desfasada >5s |
| -- | --: | --: | --: |
| may-2026 | 222 | 112 | 62 |
| jun-2026 | 334 | 159 | 94 |
| jul-2026 | 592 | 260 | 161 |
| **ago-2026** | **569** | **0** | **1** |

El corte es limpio entre el 27 y el 29 de julio: la columna ya estaba arreglada.
Y recortarla habría sido una regresión, porque `lastActivityAt` la usa para
ordenar la bandeja de Katherine, y en 1.204 de 1.760 conversaciones el último
saliente es una notificación.

`last_outbound_at` sigue queriendo decir «lo último que salió, del tipo que sea».
**Quién contestó de verdad se lee de `outbound_messages` filtrado por `source`.**

Esa distinción destapó un error en el ticket 03, que comparaba el último entrante
contra *cualquier* saliente y por lo tanto contaba una notificación automática
como «ya contestamos». Corregido antes de que el 03 arrancara: el número sube de
20 a 39, y los 19 que entran son clientes a los que nadie contestó.

### `sentByUserId`

Las tres rutas de envío manual lo aceptan y lo persisten. Se comprueba en el
borde y degrada a `null` ante cualquier duda: es clave foránea a `users`, y un
identificador inventado reventaría el insert **en medio de un envío**. La
atribución es un dato de más; el mensaje es el trabajo. La mitad del panel es del
ticket 03.

### Lo que falta para darlo por confirmado en producción

**El código está desplegado; el efecto todavía no se vio.** Desde el deploy
(05:08 UTC) no salió ni un mensaje, que a esa hora es lo esperado. Con tráfico,
esta consulta tiene que mostrar `pero_en_rojo` dejando de crecer sobre los 540:

```sql
with ult as (
  select c.id, c.unread_count, c.last_inbound_at,
         (select max(o.created_at) from outbound_messages o
           where o.conversation_id = c.id and o.source in ('agent','manual')) as resp
  from conversations c
)
select count(*) filter (where resp is not null and (last_inbound_at is null or resp > last_inbound_at)) as contestadas,
       count(*) filter (where resp is not null and (last_inbound_at is null or resp > last_inbound_at) and unread_count > 0) as pero_en_rojo
from ult;
```

Y el perfil por `source` tiene que quedar igual en `por_dia` y `pct_salio`, que es
la prueba de que no cambió *qué* se envía. Línea de base del 20-ago: `agent` 88,9
por día al 100%, `dropi_status` 101,6 al 98,6%, `manual` 10,4 al 97,4%.

**Status:** resolved en código y desplegado — la confirmación en producción espera
tráfico, con la consulta de arriba
