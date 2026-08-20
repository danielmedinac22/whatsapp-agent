# PRO-24 — Entrega · El índice muerto

Rama `danielmedinac22/indice-muerto`, commit `b743081`. **Sin mergear, sin
deployar y sin aplicar la `0032` a producción** — eso queda para la sesión que
coordina.

```
pnpm -r typecheck   limpio
pnpm test           970 del worker (62 archivos) + 43 del panel (4 archivos)
pnpm -r lint        verde
```

**Producción se tocó solo con `SELECT`.** La migración se ensayó contra Docker
(`postgres:16-alpine`, puerto 55987) y el contenedor quedó borrado.

**Veredicto: se borra.** Con una salvedad que hay que leer, porque contradice
en parte la premisa del encargo — abajo, en «El hallazgo».

---

## Lo que dijo producción, releído antes de decidir

Primer criterio de aceptación. Leído hoy, 20-ago, ~21:00 UTC:

| índice | veces usado | último uso | peso |
| -- | --: | -- | --: |
| **`conversations_last_msg_idx`** | **0** | **nunca** | **232 kB** |
| `conversations_operation_idx` | 0 | nunca | 88 kB |
| `conversations_operation_activity_idx` | 3 | hoy 21:00 | 88 kB |
| `conversations_confirmation_idx` | 5 | 17-ago 14:50 | 48 kB |
| `conversations_pkey` | 13.136 | hoy 21:00 | 128 kB |
| `conversations_contact_idx` | 143.467 | hoy 21:00 | 120 kB |

Cambió algo desde el encargo, y para bien: **la `0031` ya está aplicada a
producción** (migración 32 de `drizzle.__drizzle_migrations`, hoy 18:23 UTC).
El `spec.md` decía que hasta que eso pasara PRO-24 seguía bloqueado. Ya no lo
está.

Tres cosas que el número solo no dice:

- **`last_idx_scan` es nulo**, no viejo. No es que se use poco: la base no lo
  vio usarse **nunca**. `conversations_confirmation_idx`, con sus 5 barridos,
  sí tiene fecha — así que los índices poco usados sí registran.
- **`stats_reset` es nulo**: los contadores no se reiniciaron jamás. Cubren
  como mínimo los 7 días y 5 horas de encendido del servidor (desde el 13-ago
  15:19 UTC), en los que `conversations_contact_idx` acumuló 143.467 barridos
  sobre esa misma tabla. El cero no es una ventana corta.
- **El otro cero es de otra clase.** `conversations_operation_idx` también
  marca 0, pero nació hoy con la `0031`: su cero significa «recién puesto», y
  la `0031` ya había avisado que no cambia ningún plan de hoy y va por lo que
  viene. No se toca.

Y era **el más pesado de los seis**: 232 kB de los 704 kB de índices que
cuelgan de una tabla de 752 kB. Casi un tercio del peso de indexación de
`conversations`, para nada.

---

## El hallazgo: hay una consulta, y el encargo decía que no había ninguna

Segundo criterio de aceptación, y lo que más importa de esta entrega.

El encargo afirmaba —citando a la `0031`— que «ninguna consulta del repo filtra
ni ordena por esas dos columnas sueltas». **Eso no es exacto.** Hay una:

```
scripts/debug-agent.ts:56    .orderBy(desc(conversations.lastInboundAt)).limit(5)
```

Y el índice **sí la servía**. No es teórico, está medido:

| | plan | bloques | tiempo |
| -- | -- | --: | --: |
| con el índice | `Index Scan Backward using conversations_last_msg_idx` | 5 | 0,115 ms |
| sin el índice | `Seq Scan` + `Sort` (top-N heapsort) | 35 | 0,223 ms |

La regla del encargo decía que con **una sola** consulta el veredicto es no
borrar. **No la aplico al pie de la letra, y lo digo en vez de esconderlo.**

El motivo es lo que la regla protege: que borrar un índice deje a un lector sin
apoyo y nadie lo conecte con el cambio meses después. `debug-agent.ts` no es ese
lector. Es un script de diagnóstico que no está cableado a ningún `package.json`
—se corre a mano con `tsx`—, imprime cinco filas por consola para que las mire
una persona, y su costo completo de perder el índice son **0,1 ms, una vez**.
Del otro lado hay 91 bytes de WAL en cada mensaje de WhatsApp, para siempre.

Queda dicho para que la sesión que coordina pueda decidir lo contrario si
quiere: **el dato está, la decisión es revisable, y el script no se tocó** —
cambiarlo era una segunda decisión y no estaba en el encargo.

Lo demás sí se verificó y sí está limpio. Los **86 sitios** del repo que nombran
`last_inbound_at` / `last_outbound_at` son proyecciones de un `select`, un
`returning`, escrituras o definiciones de tipo. Todo lo que consulta de verdad
va por `id`, por `contact_id` o por la expresión `GREATEST(...)` — que este
índice no puede servir, y que es exactamente por lo que la `0031` tuvo que
crear `conversations_operation_activity_idx`.

Y los **siete planes del Inbox** (`scripts/planes-de-la-bandeja.ts`) eligen los
mismos índices con él y sin él:

```
apagada · 1          conversations_operation_activity_idx, contacts_pkey
operaciones · 1      conversations_operation_idx, dropi_orders_shopify_idx
operaciones · 2      conversations_operation_activity_idx, contacts_pkey
ventas · 1           conversations_operation_idx, dropi_orders_shopify_idx
ventas · 2           conversations_pkey, contacts_pkey
barra lateral · 1    select conversations +1 join
barra lateral · 2    conversations_operation_idx, contacts_pkey, dropi_orders_shopify_idx
```

`conversations_last_msg_idx` no aparece en ninguna, ni antes ni después.

**Un aviso sobre esa medición**, porque casi me engaña: entre la corrida «con»
y la «sin», `ventas · 1` se movió de 34 a 124 bloques y `ventas · 2` de 431 a
269. Parecía que el índice sí cambiaba algo. **No era el índice: es que el
script escribe** —con bandeja pedida, `listConversations` suelta las
asignaciones que cambiaron de bandeja, y eso es un `UPDATE`—. Al volver a poner
el índice y correrlo por tercera vez, `ventas · 2` volvió a 269 con el índice
**presente**. Era deriva de datos entre corridas. Los índices elegidos, que es
lo que se estaba mirando, son idénticos en las tres.

---

## Lo que se ahorra, medido

Cuarto criterio. Base de ensayo con las migraciones `0000`–`0031` aplicadas en
orden por el migrador de drizzle —incluida la `0031`, así que la línea base
tiene los seis índices de producción— y sembrada con
`scripts/seed-bandejas-ensayo.ts` (`SEMBRAR=si ESCALA=si`): **1.725
conversaciones, la escala exacta de producción.**

La escritura medida es la más caliente que hay: un `last_inbound_at` por cada
mensaje entrante, sobre las 1.725 filas. En **bytes de WAL** vía
`pg_current_wal_lsn()` y `pg_wal_lsn_diff`, no con el reloj.

| | con el índice | sin el índice | ahorro |
| -- | --: | --: | --: |
| **régimen** (entre checkpoints) | 1.274.744 | 1.118.064 | **−12,3 %** |
| control (mismo, repetido) | 1.269.152 | 1.110.944 | −12,5 % |
| **en frío** (primer toque tras checkpoint) | 1.897.288 | 1.737.808 | **−8,4 %** |

Medianas de cinco pasadas cada una. Cada bloque va precedido de `vacuum full` y
`analyze`, y la secuencia pone y quita el índice **alternándolo dos veces**,
para que un ahorro aparente por deriva no pudiera pasar por real.

**~157.400 bytes, o 91 bytes por fila actualizada.**

### Lo que no reproduje, y por qué no importa

La `0031` reportó **2.670.624 bytes** para el caso de seis índices. **Mi línea
base no da ese número**: da 1.897.288 en frío y 1.274.744 en régimen. Perseguí
la diferencia antes de seguir, porque un número que no reproduce es una
medición que no se entiende.

La explicación es el estado de la tabla, no el método: en frío, el primer
`UPDATE` después de un `checkpoint` paga la **imagen entera de cada página** que
toca (8 kB por página), así que el total depende de cuántas páginas tenga la
tabla — y una tabla más inflada por `UPDATE`s previos infla el total sin que
eso tenga nada que ver con ningún índice.

Lo que sí transfiere, y es lo que decide, es **el aporte del índice**:

- La `0031` midió **172.152 bytes**, un 8,2 %. Yo mido **159.480 bytes**, un
  **8,4 %**, con su mismo método. El porcentaje reproduce dentro de 0,2 puntos.
- Y **en régimen el índice pesa más, no menos: 12,3 %.** Es el mismo ahorro
  absoluto contra un denominador honesto — sin las imágenes de página, que son
  un costo del checkpoint y no del índice. Entre checkpoints es donde la base
  vive casi todo el tiempo.

O sea: la `0031` estimó por lo bajo. Borrarlo paga más de lo que decía.

---

## Qué mirar si algo se pone lento después

Quinto criterio, y la razón de que esto sea un ticket y no un renglón. Está
escrito completo en la cabecera de la `0032`; el resumen:

**Sospechá de este cambio solo si el plan lento ordena o filtra por
`last_inbound_at` o `last_outbound_at` a secas.** En el `explain (analyze,
buffers)` eso se ve como `Sort Key: last_inbound_at` o
`Filter: (last_inbound_at ...)` encima de un `Seq Scan on conversations`.

**Si ordena por `GREATEST(last_inbound_at, last_outbound_at, created_at)`, este
índice nunca la habría ayudado** y buscar por acá es perder el día: esa forma la
sirve `conversations_operation_activity_idx`, y si igual va lenta el problema es
cuántas filas se leen, no por dónde se llega — que es lo que dice PRO-18.

Volver a ponerlo, si de verdad hace falta:

```sql
create index concurrently "conversations_last_msg_idx"
  on conversations using btree (last_inbound_at, last_outbound_at);
```

Antes de hacerlo, mirar si lo que falta no es acotar por operación: en esta
tabla el índice correcto casi siempre lleva `operation_id` adelante, que es el
patrón de la `0024`, la `0027` y la `0031`.

El mismo aviso quedó en `schema.ts`, donde vivía la línea del índice, para que
nadie lo vuelva a agregar sin leer la migración.

---

## La migración

Tercer criterio: **es la `0032` y borra ese índice, nada más.**

`packages/db/migrations/0032_indice_muerto.sql`, y su única sentencia es:

```sql
DROP INDEX IF EXISTS "conversations_last_msg_idx";
```

**Se leyó la generada en vez de asumirla**, como pedía el encargo: drizzle
produjo exactamente esa línea y ninguna otra. Ni backfill, ni una columna, ni un
`check`. Lo demás del archivo son comentarios.

Verificado de las dos formas: aplicada sobre la base de ensayo ya migrada (deja
los 5 índices), y la cadena entera `0000`–`0032` sobre una base virgen, que
termina también en 5. `drizzle-kit generate` corrido después dice **«No schema
changes, nothing to migrate»**: el esquema y el snapshot no quedaron
desincronizados.

Se renombró de `0032_graceful_boomerang` a `0032_indice_muerto`, con su entrada
del `_journal.json`, siguiendo la convención del repo.

### Guatemala no cambia

Un `DROP INDEX` y nada más: ni una columna, ni un `check`, ni una fila tocada.
**Un índice cambia por dónde se llega a las filas, no cuáles son**, así que
ninguna consulta devuelve otro conjunto ni otro orden. Las 970 pruebas del
worker y las 43 del panel dan lo mismo que antes.

**Compatible en las dos direcciones**: ningún worker nombra este índice, ni el
viejo ni el de esta rama. Se puede aplicar antes o después de desplegar.

**Sin `CONCURRENTLY`**, como la `0031` y por lo mismo: el migrador de drizzle
aplica dentro de una transacción y `CONCURRENTLY` no puede correr ahí. El
`DROP INDEX` toma un lock exclusivo sobre la tabla, pero solo mientras borra el
archivo: sobre 232 kB es instantáneo.

---

## Lo que no se hizo

- **No se aplicó la `0032` a producción.** Último criterio de aceptación.
- **No se mergeó ni se deployó.**
- **No se tocó ningún otro índice.** Lo único anotado al respecto es que
  `conversations_operation_idx` también marca `idx_scan = 0` — y **no es un
  candidato**: nació hoy, la `0031` ya explicó que no cambia ningún plan actual
  y que va por el corte del vendedor cuando se encienda. Volver a mirarlo tiene
  sentido recién cuando lleve semanas encendido y con vendedor configurado.
- **No se tocó `scripts/debug-agent.ts`**, aunque sea la única consulta
  afectada. Cambiarlo o borrarlo es otra decisión.
- **No se mandó ningún mensaje** ni se levantó el worker.
- El contenedor `wa-ensayo-indice` quedó borrado.
