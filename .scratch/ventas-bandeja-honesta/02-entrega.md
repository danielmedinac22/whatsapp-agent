# 02 — Entrega · Que responder deje huella

Rama `danielmedinac22/saliente-conversacional`, commit `1783abb`, empujada.
**Sin mergear y sin deployar.** `pnpm -r typecheck` limpio;
`pnpm --filter @wa/worker test` en verde: **843 pruebas en 55 archivos**
(la base eran 822 en 53).

Todo lo medido sale de producción de Guatemala, solo `SELECT`, 19/20-ago-2026.

## El agujero, medido de nuevo y más grande de lo que decía el ticket

| | |
| -- | --: |
| Conversaciones cuyo **último mensaje es una respuesta de verdad** (`agent`/`manual`) | 955 |
| **De esas, las que siguen con el contador en rojo** | **540** |

Las 30 de 54 del ticket son la rodaja que el panel marcaba «necesita atención».
Sobre las 1.760 conversaciones el agujero es de 540.

## Lo que cambió

Tres archivos nuevos y dos tocados, **todo dentro de `apps/worker`**. No se tocó
`apps/web`, ni `packages/db/src/schema.ts`, ni `markRead`, ni hubo migración ni
backfill.

- `apps/worker/src/inbox/saliente-conversacional.ts` — la decisión, pura.
- `apps/worker/src/inbox/saliente-conversacional.test.ts` — 17 pruebas.
- `apps/worker/src/lib/atribucion.ts` + su prueba — 4 pruebas.
- `apps/worker/src/jobs/outbound.ts` — la escritura, en el sitio donde ya estaba.
- `apps/worker/src/routes/wa.ts` — las tres rutas de envío manual atribuyen.

### 1 · Un solo sitio decide qué es una respuesta

`esSalienteConversacional(source)`, `switch` exhaustivo con `never`. Las dos
mitades de la guarda están comprobadas de verdad: agregando un noveno valor al
enum, `tsc` falla con

```
src/inbox/saliente-conversacional.ts(63,13): error TS2322:
  Type '"un_source_nuevo"' is not assignable to type 'never'.
```

y la prueba `cubre los ocho valores que el esquema permite, y solo esos`
—que compara la lista de casos contra `outboundSource.enumValues`— falla también.
El enum quedó revertido; `schema.ts` no tiene ni un cambio.

| Conversacional (5.211) | | Notificación (13.501) | |
| -- | --: | -- | --: |
| `agent` | 4.859 | `dropi_2fa` | 5.979 |
| `manual` | 352 | `dropi_status` | 4.542 |
| | | `confirmation_ack` | 1.528 |
| | | `followup` | 980 |
| | | `remarketing` | 379 |
| | | **`escalation`** | **93** |

`escalation` del lado de las notificaciones, con el porqué en el código: es el
aviso de que hace falta una persona, no la respuesta de esa persona. Apagar el
contador con ella escondería justo la conversación que el agente pidió mirar.

### 2 · La escritura

Una sola sentencia, sin consulta previa, idempotente, en el mismo sitio donde ya
se estampaban la fecha y la vista previa — **después** de que Meta aceptó el
mensaje. `huellaDelSaliente` devuelve `null` cuando no hay identificador de Meta,
que es la marca que este repo ya usa (`mirrorFailedSend`) para decir «el envío
murió antes de irse». Un envío que falla no marca nada.

### 3 · `sentByUserId`

Las tres rutas (`/send`, `/send-audio`, `/send-template`) lo aceptan y se lo
pasan al outbox, que ya lo persistía en `outbound_messages` y lo espejaba en
`messages`. Se comprueba en el borde —forma y existencia— y degrada a `null` ante
cualquier duda: la columna es clave foránea a `users` y un identificador
inventado reventaría el insert **en medio del envío**. No vive en el esquema de
zod por lo mismo: un valor mal formado no puede convertir un envío en un 400.
La mitad del panel es del ticket 03; hasta entonces funciona con `null`.

## El criterio que NO se cumplió al pie de la letra, y por qué

> «Una notificación logística **no** hace ninguna de las dos cosas.»

Se cumple la mitad que importa —**una notificación no apaga el contador**— y
**no** la otra: sigue estampando `last_outbound_at` y la vista previa, igual que
hoy. Tres razones, en orden de peso:

**1 · La columna ya no miente.** El ticket la da por rota con 855 desfases sobre
1.759. Los 855 son **todos anteriores al 28-jul-2026**:

| Mes del último saliente | Conversaciones | Sin estampa | Desfasada >5s |
| -- | --: | --: | --: |
| abr-2026 | 12 | 5 | 1 |
| may-2026 | 222 | 112 | 62 |
| jun-2026 | 334 | 159 | 94 |
| jul-2026 | 592 | 260 | 161 |
| **ago-2026** | **569** | **0** | **1** |

El corte es limpio entre el 27 y el 29 de julio. Desde entonces van 569
conversaciones con cero nulos. El ticket prohíbe el backfill, así que las 855 se
quedan como están de todos modos — no había nada que arreglar hacia adelante.

**2 · Recortarla sería una regresión sobre la pantalla de Katherine.** El último
saliente de **1.204 de las 1.760** conversaciones es una notificación. Recortar
la columna les cambiaría `lastActivityAt`
(`GREATEST(last_inbound_at, last_outbound_at, created_at)`, `queries.ts:67`), que
es como se ordena la bandeja y como el ticket 03 calcula su ventana de 30 días.
`no-regresion.md`, regla 1.

**3 · Rompería el número que el ticket 03 ya fijó.** El 03 dice que
`last_outbound_at` es «la fuente correcta una vez arreglada» para «el último
mensaje es entrante», y fija ese número en 68 calculándolo desde `messages` con
`direction='out'` — o sea, **todos** los salientes. Medido: con la columna como
está da 91; recortada a lo conversacional daría **611**. No es una diferencia de
redondeo, es otra definición.

`last_outbound_at` sigue queriendo decir «lo último que salió, del tipo que sea».
**Quién contestó de verdad, y cuándo, se lee de `outbound_messages` filtrado por
`source`** — el mismo `IN` que el 03 ya va a pagar para las escaladas.

## Cómo comprobar el deploy

### A · «No cambió qué se envía, solo qué se anota»

El perfil por `source` tiene que dar lo mismo antes y después. Base de hoy:

```sql
select source,
       count(*) as total,
       count(*) filter (where created_at >= now() - interval '7 days') as ult_7d,
       round(count(*) filter (where created_at >= now() - interval '7 days') / 7.0, 1) as por_dia,
       round(100.0 * count(*) filter (where status in ('sent','acked')) / count(*), 1) as pct_salio
from outbound_messages group by source order by total desc;
```

| source | total | últ. 7d | por día | % que salió |
| -- | --: | --: | --: | --: |
| `dropi_2fa` | 5.979 | 48 | 6,9 | 82,3 |
| `agent` | 4.859 | 624 | 89,1 | 100,0 |
| `dropi_status` | 4.542 | 712 | 101,7 | 98,6 |
| `confirmation_ack` | 1.528 | 174 | 24,9 | 99,9 |
| `followup` | 980 | 135 | 19,3 | 94,9 |
| `remarketing` | 379 | 58 | 8,3 | 88,4 |
| `manual` | 352 | 73 | 10,4 | 97,4 |
| `escalation` | 93 | 1 | 0,1 | 100,0 |

Lo que tiene que quedar igual es **`por_dia` y `pct_salio`**, no el total, que
crece. El cambio no toca ni una línea del envío: si alguna de esas dos columnas
se mueve, no fue este ticket anotando de más — fue enviando distinto.

Y el ritmo de `messages`, que tiene que seguir en la misma banda (95–342/día en
los últimos 8 días, mediana ~275):

```sql
select created_at::date as dia, count(*) as salientes
from messages where direction='out' and created_at >= now() - interval '8 days'
group by 1 order by 1;
```

### B · Que el contador se apague de verdad (la comprobación positiva)

Es la que dice si el ticket sirvió. Hoy da **955 / 540**; después del deploy los
540 dejan de crecer, y toda conversación contestada de ahí en adelante entra con
`pero_en_rojo = 0`.

```sql
with ult as (
  select c.id, c.unread_count, c.last_inbound_at,
         (select max(m.created_at) from messages m
            join outbound_messages o on o.wa_id = m.wa_id
           where m.conversation_id = c.id and m.direction = 'out'
             and o.source in ('agent','manual')) as resp
  from conversations c
)
select count(*) filter (where resp is not null and (last_inbound_at is null or resp > last_inbound_at))
         as contestadas_al_final,
       count(*) filter (where resp is not null and (last_inbound_at is null or resp > last_inbound_at)
                          and unread_count > 0) as pero_en_rojo
from ult;
```

### C · Que no se marque de más

La consulta del ticket —`unread_count = 0` con la última entrante posterior a
`last_outbound_at`— **da 97 hoy, antes de desplegar nada**, y no todas son un
problema: 41 tienen una notificación como último saliente, 21 no tienen saliente
conocido, y 34 son `agent`/`manual`. Lo que mide de verdad es «leída y no
contestada», que es un estado legítimo: `markRead` la apagó porque alguien la
abrió. **No sirve como criterio de fallo**; sirve como línea de base: si las 97
saltan de golpe después del deploy, hay que mirar.

La comprobación decisiva de que ninguna notificación apaga contadores es la
prueba `ninguna de las seis notificaciones apaga el contador`, que recorre los
seis `source` y falla si alguno devuelve `unreadCount`.

## Nada de esto se hizo

Ni se levantó el worker, ni se corrió el job de outbound, ni salió un mensaje a
ningún número. La verificación es por pruebas y por lectura de la base, como
pedía el encargo. `psql` solo con `SELECT`.
