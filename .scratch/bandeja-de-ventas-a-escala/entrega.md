# PRO-10 — Entrega · La bandeja de ventas encendida, medida antes de encenderla

Rama `danielmedinac22/regla-de-medir`. **Sin mergear y sin deployar.**
`pnpm -r typecheck` limpio; `pnpm --filter @wa/worker test` en verde: **878
pruebas en 56 archivos**.

Medido con el instrumento de [PRO-9](../panel-viajes/entrega.md) contra base de
ensayo con datos sembrados. **Producción no se tocó más que con `SELECT`**, y no
se pudo tocar de otro modo: el código que este ticket mide no corre allá.

---

## El comando

```bash
docker run -d --name wa-ensayo-medir -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=wa -p 55981:5432 postgres:16-alpine

export DATABASE_URL="postgres://postgres:test@127.0.0.1:55981/wa"
pnpm --filter @wa/db migrate
SEMBRAR=si ESCALA=si npx tsx scripts/seed-bandejas-ensayo.ts
WA_SQL_TRACE=1 ENSAYAR=si npx tsx scripts/ensayo-bandeja-a-escala.ts

docker rm -f wa-ensayo-medir
```

`scripts/ensayo-bandeja-a-escala.ts` hace crecer la tabla hasta 1×, 5× y 10× la
escala de producción, mide cada escala, fabrica el caso de escritura, le pide el
plan a la consulta que corrió y declara el techo. Se niega a correr contra
producción y sin `ENSAYAR=si`.

**El sembrado no es un paso previo, es parte de la medición.** Con la tabla
vacía todo esto da cero milisegundos y no dice nada.

Una nota de método: la escena «hoy · bandeja apagada» **apaga al vendedor en la
base** (`display_name = ''`, que es `salesAgentIsConfigured`) en vez de pasar
`undefined` por parámetro. El layout no recibe el vendedor, lo lee: simularlo por
parámetro medía un render que no existe —sin bandeja pero con los contadores de
la barra encendidos— y sobreestimaba la línea base en 6 consultas.

---

## 1 · Los cuatro números que pedía el ticket

Escala de producción (**1.762 conversaciones**), base local, así que lo que se
lee es **trabajo**, no distancia:

| | consultas | idas y vueltas | cadena | ms de trabajo | filas leídas | escritas |
| -- | --: | --: | --: | --: | --: | --: |
| **hoy · bandeja apagada** | **13** | **23** | **4 / 6** | **19,8** | **1.256** | 0 |
| **encendida · operaciones** (la URL de Katherine) | **24** | **45** | **7 / 12** | **37,4** | **8.606** | 0 * |
| encendida · ventas (`?b=ventas`) | 23 | 43 | 6 / 10 | 27,7 | 7.216 | 0 * |
| — de eso, `listConversations()` con bandeja | 12 | 24 | 4 / 8 | 15,2 | 3.609 | |
| — de eso, **`countSalesInboxViews()`** · barra lateral | **6** | **12** | **2 / 4** | **14,9** | **3.605** | |

\* cero **mientras no haya asignaciones viejas**. Ver el punto 3.

El contador de la barra lateral queda medido aparte porque se paga aparte: la
barra se dibuja en **las siete pantallas** del panel, así que esas 6 consultas y
3.605 filas también se pagan en Pedidos, en Plantillas y en todas las demás —
pantallas que no tienen nada que ver con la bandeja de ventas.

---

## 2 · El hallazgo: la bomba no es el tiempo, es que deja de ser plana

El ticket dice que encender la bandeja es una bomba de tiempo. **Lo es, y no por
donde el ticket apuntaba.** A la escala de hoy, el trabajo extra son **18 ms**:
invisible al lado de los 1.193 ms que el render ya tarda desde Colombia. Si se
enciende a Sebastián el lunes, nadie va a notar nada el lunes.

Lo que cambia el lunes es la **forma** de la consulta:

| conversaciones | apagada | encendida (operaciones) | de más |
| --: | --: | --: | -- |
| 1.762 | 19,8 ms / **1.256 filas** | 37,4 ms / **8.606 filas** | ×1,9 tiempo, ×6,9 filas |
| 8.810 | 21,8 ms / **1.256 filas** | 125,4 ms / **35.918 filas** | ×5,7 tiempo, ×28,6 filas |
| 17.620 | 23,9 ms / **1.256 filas** | 266,2 ms / **70.056 filas** | ×11,1 tiempo, ×55,8 filas |

Mirar la columna de filas de la izquierda: **1.256, 1.256, 1.256**. Con la
bandeja apagada el render es plano — lee las 200 más recientes más las que están
sin responder, y eso no crece con el tamaño de la tabla. Con la bandeja
encendida crece en línea recta con cada conversación que la operación acumule.

**El render pasa de O(recientes) a O(todas), y ese cambio no avisa.** No hay un
día en que se rompa: hay un día en que empieza a costar el doble, y para entonces
nadie se acuerda de que fue el día que se encendió al vendedor.

### Y hay un costo que sí se paga el día uno

La cadena secuencial pasa de **6 a 12 idas y vueltas**. Eso no es trabajo, es
distancia, y no se ve en la base local porque allá la ida y vuelta es de 0,2 ms.
Con los **120,1 ms** medidos contra producción desde Colombia:

```
+6 idas y vueltas en la cadena × 120,1 ms  =  +721 ms por render
```

Sobre los 1.193 ms de hoy, eso es **casi el doble**. Es una proyección —la cadena
se midió en Docker y la latencia contra producción—, no una medición directa, y
está marcada como tal. `scripts/viajes-del-panel.ts` la verifica el día que se
encienda, sin montar nada.

---

## 3 · Sí: leer escribe

`conversationIdsOfInbox` termina llamando a `releaseStaleAssignments`, que es un
`UPDATE` sobre `conversations`. Solo dispara cuando hay algo que soltar, así que
la pregunta no es «¿escribe?» sino «¿cuántas filas, y cuándo?».

Se fabricó el caso normal de una venta —conversación sin pedido asignada al
vendedor, el cliente compra, el pedido nace **después** de la asignación, y desde
ese instante la conversación es de operaciones— sobre 200 conversaciones:

```
200 conversaciones asignadas antes de que naciera su pedido
→ un solo render de la bandeja escribió 199 filas de `conversations`
```

**Una carga de pantalla escribió 199 filas sin que nadie tocara un botón.**

En régimen normal el goteo es chico: una asignación se suelta una vez y ya
—después queda en `null` y no vuelve a entrar—, así que el volumen es del orden
de una fila por venta cerrada. Las ráfagas de 199 son el primer render después de
encender al vendedor, o después de cualquier carga masiva de pedidos.

Lo que no depende del volumen es la forma: **un `UPDATE` en el camino de
lectura, disparado por `router.refresh()` en cada evento SSE — o sea, una vez por
mensaje de WhatsApp que entra**, sobre la tabla más caliente del sistema. Eso es
lo que impide cachear la pantalla, servirla desde una réplica, o razonar sobre
ella como una lectura.

---

## 4 · El techo

### a. El borde nítido: entre 36.000 y 45.000 conversaciones

El plan de la consulta del ticket —el `SELECT` sin `LIMIT`, sacado de la traza y
no copiado a mano— a 17.620 conversaciones:

```
Sort  (cost=2625.41..2670.53 rows=18047 width=80) (actual time=8.232..8.638 rows=17620)
  Sort Key: (GREATEST(last_inbound_at, last_outbound_at, created_at)) DESC
  Sort Method: quicksort  Memory: 2007kB
  ->  Hash Join  (actual time=2.333..6.080 rows=17620)
        ->  Seq Scan on conversations  (actual time=0.003..1.679 rows=17620)
              Filter: (operation_id = '…'::uuid)
        ->  Hash  ->  Seq Scan on contacts  (actual time=0.002..0.993 rows=17620)
Execution Time: 9.481 ms
```

`Seq Scan` sobre las dos tablas —confirmado: `conversations` no tiene índice
sobre `operation_id`, sus cuatro índices son `pkey`, `contact_id`,
`confirmation_status` y `(last_inbound_at, last_outbound_at)`— y `quicksort` en
memoria. **El filtro por operación se aplica después de leer la fila**, no antes:
es un `Filter` sobre un `Seq Scan`, no un `Index Scan`.

**2.007 kB para 17.620 filas, con `work_mem` de 4 MB.** A ese ritmo el orden deja
de caber en memoria alrededor de las **36.000 conversaciones**, y ahí el plan
pasa a `external merge`: ordenar contra el disco, en un render que corre una vez
por mensaje entrante. Ese es el techo con borde, y es el único que no es una
pendiente: antes cuesta 9 ms, después cuesta otra cosa.

La misma consulta contra **producción hoy**, que es el «antes» contra el que
comparar cuando se pongan los índices de PRO-17:

```
Sort  (cost=313.66..318.07 rows=1764 width=80) (actual time=2.494..2.590 rows=1764)
  Sort Key: (GREATEST(last_inbound_at, last_outbound_at, created_at)) DESC
  Sort Method: quicksort  Memory: 159kB
  Buffers: shared hit=151
  ->  Hash Join  (actual time=0.672..1.967 rows=1764)
        ->  Seq Scan on conversations c  (actual time=0.015..0.838 rows=1764)
              Filter: (operation_id = '63937b3d-…'::uuid)
        ->  Hash  ->  Seq Scan on contacts ct  (actual time=0.007..0.315 rows=1764)
Execution Time: 2.829 ms
```

Producción también tiene `work_mem` de 4 MB, así que el cálculo aplica directo —
y con **sus** filas da un poco más de aire: 159 kB para 1.764 filas son 90 bytes
por fila contra los 114 de la base de ensayo, que las tiene con textos más
largos. **El derrame cae entre las 36.000 y las 45.000 conversaciones** según lo
que lleven las filas. Se toma el borde inferior, que es el que no sorprende.

### b. La pendiente: 14,4 ms por cada mil conversaciones

Ajustada sobre las tres escalas medidas:

| conversaciones | trabajo por render |
| --: | --: |
| 10.000 | 156 ms |
| 33.800 | **500 ms** |
| 50.000 | 733 ms |
| 68.500 | **1.000 ms** |
| 100.000 | 1.454 ms |

La recta vale hasta el derrame del punto (a); pasadas las ~36.000 deja de valer,
y hacia arriba.

### c. El multiplicador que no es de escala sino de tráfico

A 17.620 conversaciones son **70.056 filas leídas por render**, y el render
ocurre una vez por mensaje de WhatsApp que entra, por cada pestaña abierta. Con
dos asesores mirando el panel, **cada mensaje entrante cuesta 140.112 filas
leídas**. Es el número que convierte «lento» en «caro».

### La respuesta, escrita

> **La bandeja de ventas encendida deja de aguantar entre las 36.000 y las
> 45.000 conversaciones por operación**, y el borde lo pone el orden por
> `GREATEST(...)` cayéndose de `work_mem`, no la CPU. Antes de ese borde el costo
> sube en línea recta, 14,4 ms de trabajo por cada mil conversaciones; después,
> el orden se hace contra el disco y la recta deja de valer.
>
> Guatemala tiene 1.764 y viene creciendo **~180 conversaciones por semana**
> (171 y 209 en las dos semanas completas de agosto), o sea unas 9.400 al año.
> A ese ritmo el borde llega **alrededor de 2030**.

Dos cosas acortan ese plazo, y ninguna es el crecimiento de Guatemala:

**La segunda operación cuenta, aunque la consulta la filtre.** Sin índice sobre
`operation_id`, el `Seq Scan` lee **la tabla entera** y descarta después: las
conversaciones colombianas se leen en cada render del panel guatemalteco. El
`Sort` sí es por operación —así que el borde de `work_mem` es por operación—,
pero el escaneo no. Es exactamente la historia de usuario 8 del spec, y hoy la
respuesta es que sí, abrir Colombia empeora el rendimiento de Guatemala, fila por
fila, hasta que exista el índice.

**El refresh por SSE.** El techo de arriba es por render; lo que decide si duele
es cuántos renders hay. Con un render por mensaje entrante, la operación se
castiga a sí misma con su propio tráfico.

---

## 5 · Anotado y no tocado

**El índice que falta.** `conversations` no tiene índice sobre `operation_id`, y
el orden es sobre una expresión que ningún índice actual sirve. Es PRO-17 y no se
generó ninguna migración. Con 1.764 filas el escaneo cuesta **0,84 ms** y la
consulta entera 2,8 ms: no se nota, y por eso lleva ahí desde siempre. Los dos
planes de arriba —producción hoy y ensayo a 17.620— son el «antes» contra el que
comparar el «después».

**El corte antes de derivar** —traer las candidatas ya ordenadas y cortar antes
de derivar, en vez de traer todo y cortar después— es lo que baja las 8.606 filas.
Es el trabajo del spec, y lo que hay que vigilar al hacerlo está dicho ahí: si la
forma rápida trae otro conjunto, es un cambio de producto. La conversación vieja
que aparece por estar sin responder es el caso que más fácil se rompe.

**El contador de la barra sale casi gratis de lo mismo.** `countSalesInboxViews`
comparte forma con la bandeja: 6 consultas y 3.605 filas a escala de hoy, 34.330
a 10×, en las siete pantallas. Lo que arregle una arregla la otra.

**El orden de los tickets.** [Los diez viajes del panel](../panel-viajes/spec.md)
baja el costo de cada render y [La bandeja se actualiza sin
recargarse](../bandeja-sin-recargas/spec.md) baja cuántos ocurren. De los dos, el
segundo es el que le quita el filo a este: sin un render por mensaje, las 70.056
filas y el `UPDATE` dejan de estar atados al tráfico de la tabla que leen.
