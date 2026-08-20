# PRO-17 — Entrega · Los dos índices que la consulta ya pedía

Rama `danielmedinac22/indices`. **Sin mergear, sin deployar y sin aplicar la
migración a producción** — eso queda para la sesión que coordina.
`pnpm -r typecheck` limpio. `pnpm test` en verde: **915 del worker + 16 del
panel**, los mismos que antes de tocar nada.

Va al lado de [`entrega.md`](./entrega.md), que es la de PRO-10 y no se tocó.

---

## Lo que entra

| | |
| -- | -- |
| `packages/db/src/schema.ts` | los dos índices, con por qué cada uno |
| `packages/db/migrations/0031_indices_de_la_bandeja.sql` | la migración, generada con `drizzle-kit generate` |
| `packages/db/migrations/meta/0031_snapshot.json` + `_journal.json` | lo que drizzle escribe con ella |
| `scripts/planes-de-la-bandeja.ts` | el instrumento con el que se midió, para poder repetirlo después de aplicarla |

```sql
CREATE INDEX conversations_operation_idx
  ON conversations (operation_id, created_at);
CREATE INDEX conversations_operation_activity_idx
  ON conversations (operation_id, GREATEST(last_inbound_at, last_outbound_at, created_at));
```

**La migración no se aplicó a producción.** Se aplicó y se midió contra una base
de ensayo con Docker, sembrada a la escala de producción y hecha crecer hasta
10×. Se verificó además que aplica limpia **desde cero**: base recreada,
`pnpm --filter @wa/db migrate`, las 32 migraciones al hilo.

---

## Cómo se repite

```bash
docker run -d --name wa-ensayo-indices -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=wa -p 55983:5432 postgres:16-alpine

export DATABASE_URL="postgres://postgres:test@127.0.0.1:55983/wa"
pnpm --filter @wa/db migrate
SEMBRAR=si ESCALA=si npx tsx scripts/seed-bandejas-ensayo.ts
WA_SQL_TRACE=1 npx tsx scripts/planes-de-la-bandeja.ts     # el plan de cada consulta
WA_SQL_TRACE=1 ENSAYAR=si npx tsx scripts/ensayo-bandeja-a-escala.ts   # el costo del render

docker rm -f wa-ensayo-indices
```

`planes-de-la-bandeja.ts` es nuevo y es lo que hacía falta para decidir esto.
`ensayo-bandeja-a-escala.ts` (PRO-10) mide el costo del render y le saca el plan
a **una** consulta; un índice no se juzga por la consulta que arregla sino por
todas las que cambia, incluidas las que empeora. Éste saca el plan de las doce
consultas que tocan `conversations` en los tres renders del Inbox, tomando el
SQL de la traza y no de una transcripción a mano. Se niega a correr contra
producción, y no por prudencia genérica: con bandeja pedida
`listConversations()` suelta asignaciones, o sea escribe, y `EXPLAIN ANALYZE`
ejecuta de verdad lo que explica.

---

## El plan de ejecución, antes y después

A **17.620 conversaciones** (10× la escala de hoy), tres corridas de cada lado.
Los bloques son idénticos en las tres; los milisegundos van con su rango.

| | antes | después |
| -- | --: | --: |
| consultas que escanean `conversations` entera | **12 de 12** | **7 de 12** |
| consultas que ordenan por `GREATEST(...)` | 5 de 12 | 4 de 12 |
| bloques tocados en los tres renders | **8.380** | **7.278** |

Consulta por consulta, las dos que cambian:

| consulta | antes | después |
| -- | -- | -- |
| **la lista del Inbox** (`listConversations`, corte de 200) | `Seq Scan` de 17.620 filas + `Sort` de todas · 831 bloques · 11,3–12,6 ms | `Index Scan Backward` de 200 entradas, **sin `Sort`** · 847–849 bloques · **0,5–0,8 ms** |
| ↳ solo el nodo de `conversations` | 329 bloques, 17.620 filas leídas | **34 bloques, 200 filas** |
| **sin responder** (`puedeEstarEnSQL`, el rango de 30 días) | `Seq Scan` · 619 bloques · 1,6–2,2 ms | `Bitmap Heap Scan` · **339 bloques** · 0,9–1,2 ms |
| ↳ solo el nodo de `conversations` | 329 bloques, 17.620 leídas para quedarse con 1.724 | **47 bloques** |

**La lista del Inbox es la pantalla que Katherine abre todo el día, y hoy —con
la bandeja apagada— ya pasa por ahí.** Es la mejora que no hay que esperar a
encender nada para cobrar.

El plan completo de las doce, antes y después, sale de
`DETALLE=si npx tsx scripts/planes-de-la-bandeja.ts`.

---

## Lo que **no** arreglan, dicho con el número

El ticket pedía que «el escaneo completo de la tabla desaparezca del plan».
Desapareció de cinco consultas de doce. **Las otras siete tienen razón en
seguir escaneando**, y esto es el hallazgo del ticket:

**Con una sola operación, `operation_id = X` selecciona el 100 % de la tabla.**
Ningún índice puede ganarle a un `Seq Scan` cuando hay que leer todas las
filas — leerlas por índice es más caro, no menos. Forzándolo sobre la consulta
del ticket (`enable_seqscan=off`): **35.792 bloques contra 619**, 16,2 ms contra
7,0. El planificador elige bien.

Las siete que quedan son de tres clases, y ninguna es un índice que falte:

1. **La derivación sin `LIMIT`** (`conversationIdsOfInbox`, la del ticket) lee
   el 100 % de las filas de la operación para quedarse con 200. **Eso es
   PRO-18**: acotar antes de derivar. Un índice no arregla leer de más; arregla
   por dónde se llega. Este índice es contra lo que PRO-18 se apoya cuando lo
   haga, no su reemplazo.
2. **El contador de la barra lateral** cuenta sobre todas las de la operación,
   por la misma razón. Con una segunda operación abierta sí cambia: medido con
   la tabla partida en dos, el `count` pasa de `Seq Scan` de 481 bloques a
   `Index Only Scan` de **47**.
3. **Las rezagadas** (`id IN (...)`) las resuelve la clave primaria o un
   `Seq Scan`, según el tamaño; el planificador decide y a esta escala decide
   escanear. No es de este ticket.

Y por lo mismo: **el techo de las ~36.000 conversaciones sigue exactamente donde
estaba.** A 17.620 filas ese `Sort` usa 2.007 kB con un `work_mem` de 4 MB;
bajando `work_mem` a 1 MB se cae a `external merge` con el índice puesto igual
que sin él. El índice no mueve ese borde — lo mueve leer menos filas.

El costo del render tampoco se mueve, y es coherente con lo anterior: la bandeja
encendida sigue en **45 idas y vueltas y 8.606 filas** a escala de producción,
igual que midió PRO-10. Lo que bajó son las consultas que leen un subconjunto,
no las que leen todo.

---

## Por qué son dos índices, y no uno

Ésta era la pregunta abierta, porque **un índice de más se paga en cada
escritura** y la bandeja escribe todo el tiempo.

**`conversations_operation_activity_idx`, el de la expresión, es el que cambia
lo que corre hoy.** Es también, él solo, «el compuesto por operación y
actividad»: su primera columna es `operation_id`, así que sirve la igualdad
sola, el rango y el orden.

**`conversations_operation_idx` no cambia ni un plan de hoy.** Se midió con los
dos juegos de índices por separado y los planes salen idénticos: con solo el de
expresión, 7 de 12 escaneos; con los dos, 7 de 12; con solo el de `created_at`,
12 de 12 — o sea, igual que sin ningún índice.

Va igual, y no por respetar el ticket: **es el que PRO-18 va a necesitar.**
`born_after_activation` (`packages/db/src/inbox.ts`) es una de las dos reglas
que mandan una conversación a la bandeja de ventas, y dicha en SQL es
`created_at > activated_at`. El día que se encienda al vendedor ese corte es
*ahora*, así que casi ninguna fila lo pasa — y **una condición muy selectiva sin
índice es el peor caso que hay**: Postgres escanea la tabla entera para devolver
cero filas. Medido a 17.620 filas:

| | bloques |
| -- | --: |
| `... and created_at > (hace 1 hora)` con `conversations_operation_idx` | **5** |
| lo mismo sin él (`Seq Scan`) | **332** |
| el contador de ventas con el mismo corte | **2** (`Index Only Scan`) |

Un índice que hoy no hace nada y el día del encendido ahorra 66×. Se pone ahora
porque ponerlo después es ponerlo con la pantalla ya lenta.

---

## Lo que cuestan en la escritura

El encargo pedía medir esto antes de agregar nada. La escritura más caliente que
existe es la del webhook de entrada: un `last_inbound_at` por cada mensaje de
WhatsApp que llega.

Medido en **bytes de WAL** y no en milisegundos: a esta escala el reloj de un
portátil da ±4 ms sobre 24, que es ruido, mientras el WAL es determinista —
repetido, varía en decenas de bytes sobre millones. Y es lo que de verdad se
paga en Railway, donde el disco y la réplica cobran por byte escrito. `UPDATE`
de 1.725 filas:

| índices | WAL |
| -- | --: |
| hoy (4) | 2.275.616 |
| + `conversations_operation_idx` (5) | 2.518.000 · **+10,7 %** |
| + los dos de la `0031` (6) | 2.670.624 · **+17,4 %** |

**+17,4 %, o 229 bytes por fila actualizada.** Ése es el precio y está pagado a
sabiendas.

**Sin `INCLUDE`.** El encargo avisaba que un covering index con las columnas del
preview puede inflar más de lo que ahorra: ninguna de las consultas medidas lo
pidió, así que no se agregó ninguna columna.

Crear los dos tardó **27 ms sobre 17.620 filas** (13,7 + 13,6), diez veces la
tabla de producción, y ocupan 712 kB cada uno. Van **sin `CONCURRENTLY`**: el
migrador de drizzle aplica dentro de una transacción y `CONCURRENTLY` no puede
correr ahí. A esta escala no hace falta; si esta tabla llega a los millones, la
cuenta se vuelve a hacer.

---

## Al margen: `conversations_last_msg_idx` no lo usa nadie

`conversations_last_msg_idx (last_inbound_at, last_outbound_at)` **no aparece en
ninguna consulta del repo.** Nadie filtra ni ordena por esas dos columnas
sueltas: todo lector va por `id`, por `contact_id`, o por la expresión
`GREATEST(...)`, que ese índice no puede servir — que es precisamente por lo que
existe este ticket.

Y cuesta: **172.152 bytes de WAL** en el mismo `UPDATE`, un 8,2 %. Borrarlo
pagaría casi la mitad de lo que cuestan los dos nuevos.

**No se borra en esta rama.** Borrar un índice es otra decisión y necesita el
`idx_scan` de producción para confirmarse, no una lectura del código. La
consulta que lo confirma, que es de solo lectura:

```sql
select i.relname as indice, s.idx_scan as barridos, s.idx_tup_read as tuplas,
       pg_size_pretty(pg_relation_size(i.oid)) as tam
  from pg_stat_user_indexes s join pg_class i on i.oid = s.indexrelid
 where s.relname = 'conversations' order by s.idx_scan desc;
select stats_reset from pg_stat_database where datname = current_database();
```

---

## Guatemala no cambia

Dos índices y nada más: ni una columna agregada, renombrada ni borrada, ni un
`check` nuevo, ni una fila tocada. **Un índice cambia por dónde se llega a las
filas, no cuáles son**, así que ninguna consulta devuelve otro conjunto ni otro
orden. Las 915 pruebas del worker y las 16 del panel dan lo mismo que antes.

**Sin backfill, y se verificó en vez de asumirlo.** El encargo avisaba que
drizzle no escribe backfill y que la migración generada hay que leerla: se leyó.
Son dos `CREATE INDEX` y nada más.

**Compatible en las dos direcciones**: un worker viejo no sabe que existen y
funciona igual; el de esta rama tampoco los nombra. Se puede aplicar antes o
después de desplegar.

---

## Lo que quedó sin hacer, y por qué

**No se leyó el plan de producción.** El encargo traía el `.env` de producción
para eso, y la sesión tiene bloqueado conectarse a esa base — el intento se
rechazó por política del entorno, tanto por `psql` como por un script del repo.
No se buscó rodearlo.

Lo que se pierde con eso es acotado y conviene decirlo: la forma de los planes
no depende de producción —la base de ensayo tiene el mismo esquema, la misma
proporción de filas y estadísticas frescas—, pero **el `work_mem` real de
Railway sí cambia dónde cae el techo**, y el `idx_scan` de producción es lo que
haría concluyente lo de `conversations_last_msg_idx`. Las dos consultas están
escritas arriba; son de solo lectura y la sesión que aplique la migración las
puede correr.

**No se aplicó la migración a producción, no se mergeó y no se deployó**, como
pedía el encargo.

**No se tocó** `apps/web/src/lib/queries.ts` ni
`apps/web/src/app/(app)/inbox/inbox-client.tsx`: son de otros dos worktrees.
Cero mensajes a números reales; el worker nunca se levantó con credenciales de
producción.

---

## Las casillas del ticket

- [x] Hay un índice compuesto por operación y actividad sobre `conversations` — `conversations_operation_activity_idx`
- [x] Hay un índice que sirve el orden real de la bandeja, el de la expresión — el mismo, y por eso sirve las dos casillas; el segundo (`conversations_operation_idx`) va por PRO-18, con su medición
- [x] La migración se genera con el flujo del repo y queda como `0031`
- [x] El plan de ejecución queda anotado antes y después
- [~] **El escaneo completo de la tabla desaparece del plan** — de 5 consultas de 12. Las otras 7 leen el 100 % de las filas de la operación y el planificador tiene razón en escanearlas; forzarlo cuesta 35.792 bloques contra 619. Eso es PRO-18, no un índice
- [x] Ningún test existente cambia de resultado — 915 + 16 en verde
- [x] La migración NO se aplica a producción — ensayada contra Docker y entregada
