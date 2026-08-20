# PRO-18 + PRO-20 — Entrega · La bandeja acotada, y la escritura fuera de la lectura

Rama `danielmedinac22/bandeja-acotada`. **Sin mergear, sin deployar y sin
aplicar la `0031` a producción** — eso queda para la sesión que coordina.

```
pnpm -r typecheck   limpio
pnpm test           970 del worker (eran 951) + 43 del panel
pnpm -r lint        verde
```

Va al lado de [`entrega.md`](./entrega.md) (PRO-10, la medición) y de
[`entrega-pro-17.md`](./entrega-pro-17.md) (los índices). Ninguna de las dos se
tocó.

---

## Lo que responde el ticket, en una tabla

Render del Inbox con la bandeja encendida, **la URL de Katherine** (sin
parámetro, o sea la bandeja de operaciones), a escala de producción y a diez
veces. Base de ensayo con Docker, datos sembrados, la `0031` aplicada.

| | idas y vueltas | filas leídas | filas escritas |
| -- | --: | --: | --: |
| hoy · bandeja apagada | 8 | 1.056 | 0 |
| **antes** · encendida, 1.762 conversaciones | 28 | **8.407** | 199 \* |
| **después** · encendida, 1.762 conversaciones | 28 | **1.611** | **0** |
| antes · encendida, 17.620 conversaciones | 28 | **69.857** | 199 \* |
| después · encendida, 17.620 conversaciones | 28 | **1.611** | **0** |

\* con asignaciones viejas que soltar; ver el punto 3.

**Mirar la columna de filas del «después»: 1.611 y 1.611.** Con la bandeja
apagada el render es plano —lee las 200 más recientes más las que están sin
responder, y eso no crece con la tabla—. Encendida, crecía en línea recta con
cada conversación que la operación acumulara. **Vuelve a ser plano.** Ése era el
hallazgo de PRO-10 —«el render pasa de O(recientes) a O(todas), y ese cambio no
avisa»— y es lo que este ticket deshace.

**Las idas y vueltas no cambian, y la cadena secuencial tampoco.** 28 y 28, con
cadena de 4 consultas / 8 idas y vueltas en los dos. Eso importa más que el
total: la cadena es lo que la distancia multiplica, y desde Colombia cada ida y
vuelta cuesta 120 ms. Encender la bandeja no le agrega ni un viaje al piso de
latencia del panel.

---

## 1 · Los números, escena por escena

`WA_SQL_TRACE=1 ENSAYAR=si ACTIVACION=… npx tsx scripts/ensayo-bandeja-a-escala.ts`,
mediana de tres pasadas. Base local: lo que se lee es **trabajo**, no distancia.

### El día del encendido (`ACTIVACION=reciente`)

`activated_at` es *ahora*, así que casi nada nació después del corte y a ventas
solo llega el recomprador. Es el escenario del lunes.

| escena | antes | después |
| -- | --: | --: |
| **1.762 conversaciones** | | |
| hoy · bandeja apagada | 11,9 ms / 1.056 | 12,3 ms / 1.056 |
| encendida · operaciones | 43,4 ms / 8.407 | **19,9 ms / 1.611** |
| encendida · ventas (`?b=ventas`) | 26,7 ms / 7.213 | **7,9 ms / 417** |
| — de eso, `listConversations()` | 16,4 ms / 3.608 | **6,7 ms / 210** |
| — de eso, **`countSalesInboxViews()`** | 13,0 ms / 3.605 | **2,9 ms / 207** |
| **17.620 conversaciones (10×)** | | |
| hoy · bandeja apagada | 28,8 ms / 1.056 | 43,5 ms / 1.056 |
| encendida · operaciones | 283,3 ms / 69.857 | **42,0 ms / 1.611** |
| — de eso, **`countSalesInboxViews()`** | 125,6 ms / 34.330 | **5,5 ms / 207** |

### Un año después (`ACTIVACION=vieja`)

`activated_at` 400 días atrás: **todo lo sembrado nació después del corte**, así
que la regla del lead está viva sobre la tabla entera. Es el escenario que
envejece, y el que decide si la mejora dura.

| escena | antes | después |
| -- | --: | --: |
| **1.762** · encendida · operaciones | 41,7 ms / 8.459 | **18,3 ms / 1.886** |
| **8.810** · encendida · operaciones | 126,3 ms / 35.771 | **27,5 ms / 2.766** |
| **17.620** · encendida · operaciones | 290,3 ms / 69.909 | **56,8 ms / 3.868** |
| 17.620 · `countSalesInboxViews()` | 115,6 ms / 34.331 | **25,4 ms / 1.310** |

Acá las filas **sí** crecen, y está bien que crezcan: 3.868 a diez veces la
escala de hoy es el tamaño de la bandeja de ventas, no el de la tabla. El render
pasó de costar **O(todas las conversaciones)** a costar **O(la bandeja que
dibuja)**, que es lo que uno espera pagar.

### El render entero, medido con la regla del panel

`WA_SQL_TRACE=1 BANDEJA=operaciones npx tsx scripts/viajes-del-panel.ts`, a
17.620 conversaciones con el corte viejo (el peor caso de los dos):

| | antes | después |
| -- | --: | --: |
| consultas por render | 14 | **14** |
| idas y vueltas | 28 | **28** |
| cadena secuencial | 4 / 8 | **4 / 8** |
| proceso caliente | 278,7 ms | **67,1 ms** |
| filas leídas | 69.907 | **3.867** |
| bloques tocados | 6.196 | 10.211 |
| filas escritas | 0 | **0** |

**Los bloques suben, y hay que decirlo con su razón.** No es trabajo escondido:
es que el acceso cambió de forma. Un `Seq Scan` recorre 17.620 filas en 331
bloques secuenciales; resolver 1.108 contactos por su clave primaria toca 3.324
bloques distintos. Se leen **muchas menos filas por muchos más bloques**, y a
esta escala eso son aciertos de caché —el render bajó de 279 ms a 67—. Dos
tercios del aumento son un solo nodo: el join a `contacts` que necesita el
contador de la barra para su vista «En automático». Ver el punto 5.

---

## 2 · Que el conjunto de filas no cambió: el diff

**Esto es lo que el ticket vigilaba, y es lo que más trabajo llevó.** El riesgo
de acotar antes de derivar no es no mejorar: es mejorar y traer otro conjunto de
filas sin que nadie lo note.

`scripts/volcado-de-bandeja.ts` es nuevo y vuelca a JSON **todo** lo que
devuelve `listConversations` —la fila de `conversations` y la de `contacts`
completas, el fallo del último saliente, el asignado, `sinResponder`, el resumen
de logística, el de tienda, el ruteo con sus escaladas, la preview, los no
leídos— en siete escenarios, más los tres números de `countSalesInboxViews` en
dos. Se corre antes y después, y se diffea.

```bash
ARCHIVO=/tmp/antes.json   npx tsx scripts/volcado-de-bandeja.ts              # rama vieja
ARCHIVO=/tmp/despues.json LIBERAR=si npx tsx scripts/volcado-de-bandeja.ts   # ésta
diff /tmp/antes.json /tmp/despues.json
```

Escribe **dos** archivos: el pedido, que es lo que devuelven las funciones y lo
único que hay que diffear, y un `.instrumento.json` al lado con lo que el script
anotó al medir. Van separados a propósito: `diff` no distingue una fila que
cambió de una nota al margen, y mezclarlas obliga a explicarle al lector cuáles
de las líneas del diff no cuentan — que es la forma de que alguna que sí cuenta
pase por nota.

| escenario | filas | qué vigila |
| -- | --: | -- |
| `apagada` | 370 | la no-regresión: sin vendedor, la lista de siempre |
| `ventas-reciente` | 1 | el día del encendido: a ventas solo llega el recomprador |
| `operaciones-reciente` | 369 | la URL de Katherine ese mismo día |
| `ventas-vieja` | 115 | un año después: las reglas 4 y 5 vivas |
| `operaciones-vieja` | 357 | 200 del corte **+ 157 rezagadas** por estar sin responder |
| `ventas-buscando` | 10 | con buscador la unión de rezagadas no se aplica |
| `operaciones-anclada` | 358 | la conversación pedida por id, de la **otra** bandeja |
| `contador-reciente` | 1 / 1 / 0 | todas / sin responder / en automático |
| `contador-vieja` | 115 / 16 / 99 | ídem |

**Resultado: idénticos.** Mismos ids, en el mismo orden, con los mismos valores
en todos los campos, y los mismos seis números de los contadores. No «parecidos»
ni «equivalentes»: `diff` de los dos archivos, **cero líneas**.

Tres cosas que el instrumento tiene resueltas y que sin ellas el diff no querría
decir nada:

1. **Volcar la bandeja escribía** (`releaseStaleAssignments`), así que la
   primera corrida cambiaba la base. El script fotografía las dos columnas de la
   asignación al empezar y **las restaura antes de cada escenario**: los dos
   volcados ven la misma base.
2. **`activated_at` es la línea de corte**, así que se mueve a propósito por
   escenario y se invalida la caché del vendedor, que si no devuelve la fila
   vieja.
3. **Es determinista**: dos corridas seguidas sobre la misma base dan JSON byte
   a byte iguales. Se verificó antes de usarlo para nada.

### La rezagada, que es la casilla del ticket

`operaciones-vieja` trae **357** filas: las 200 del corte por actividad y
**157 más que entran solo por estar sin responder**, viejas y fuera de cualquier
corte por actividad. Están en los dos volcados, las mismas. La criba no puede
esconderlas y no las esconde, y no por suerte: `SalesSieveFacts` **no tiene
ningún campo de actividad**, así que no es que no se use — es que no se puede
usar. Hay un test que lo afirma sobre la forma del tipo.

---

## 3 · PRO-20 · Leer no escribe

Con 200 conversaciones asignadas antes de que naciera su pedido —el caso normal
de una venta: se asigna el lead, el cliente compra, la conversación pasa a
operaciones—:

```
antes:    un solo render de la bandeja escribió 199 filas de `conversations`
después:  un solo render escribió 0
          y el camino nuevo miró 201 conversaciones y soltó 199 en 13,6 ms
```

**Miró 201 y no 17.620**, y ahí está el punto: solo puede haber que soltar donde
hay algo asignado. La versión de antes recorría las conversaciones de la
operación entera para encontrar las dos que tenían asignación; la nueva pregunta
por `assigned_user_id is not null`.

### Dónde vive ahora

`apps/worker/src/inbox/asignacion.ts`, con dos disparadores:

- **El hecho**: un pedido naciendo para el contacto, en el webhook de la tienda
  (`routes/shopify.ts`). Es el caso normal de una venta y ahí la liberación
  sigue siendo **inmediata** — el mismo webhook que crea el pedido suelta la
  asignación que ese pedido acaba de invalidar. Va envuelta: si falla, se anota
  y el pedido entra igual. Perder un pedido por no poder soltar una asignación
  sería cambiar un problema chico por el único que no se puede tener.
- **El barrido** (`jobs/liberar-asignaciones.ts`), cada **10 minutos**. Es la
  red, y es lo que hace que la garantía no dependa de acordarse de todos los
  sitios donde un pedido puede nacer: vuelve a preguntar por **todas** las
  asignaciones vivas.

Es el mismo reparto que ya usa el reporte de conversiones a Meta
(`jobs/capi-conversion.ts`), y por la razón que aquél escribe: el barrido lee
**hechos** —hay una fila de pedido, la bandeja de hoy no es la de entonces— y no
intenciones.

### Cuánto tarda en soltarse, que es la casilla que el ticket pide

| camino | cuándo | qué cubre |
| -- | -- | -- |
| gancho del pedido | inmediato | la venta que cierra — el caso normal |
| barrido | **≤ 10 minutos** | el clic de anuncio nuevo (regla 1), el pedido que entra solo por logística, y el atraso acumulado del día del encendido |

**Y la consecuencia del atraso, dicha entera:** mientras la asignación siga
puesta, la conversación se muestra como tomada por quien ya no la trabaja, y por
eso no aparece en «sin responder». Antes eso se corregía en el mismo render que
lo descubría; ahora se corrige en el barrido siguiente. En el volcado se ve
exactamente así: sin correr el camino nuevo, **una** fila difiere entre las dos
ramas —Elena Barrios, la conversación asignada a Ana que ya cambió de bandeja—
y difiere en `assignedUserId`, `assignedAt`, `assignedTo` y `sinResponder`.
Corriendo el camino nuevo antes del render (`LIBERAR=si`), el volcado vuelve a
ser idéntico. Es la diferencia entre los dos mundos, medida y acotada a su
ventana.

### Un efecto lateral que mejora, y conviene decirlo

En el volcado viejo, el escenario `ventas-buscando` deja **dos** asignaciones
puestas y los demás dejan una: buscando, la derivación se acotaba al término, no
llegaba a la conversación que había cambiado de bandeja, y **no la soltaba**.
O sea que soltar una asignación dependía de qué pantalla hubieras abierto y de
qué hubieras escrito en el buscador. El barrido no sabe de pantallas: mira todas
las asignaciones vivas. Es la misma clase de arreglo que el ticket busca —el
efecto deja de ser colateral—, y aparece en las notas del instrumento, no en el
payload: no cambia lo que el usuario ve en ese render.

**Con el vendedor apagado no cuesta ni una consulta.**
`liberarAsignacionesVencidas` sale antes de tocar la tabla si la operación no
tiene vendedor configurado, que es el estado de producción hoy.

---

## 4 · Cómo se acota, y por qué es exacto

La bandeja de una conversación se decide con sus pedidos y su fecha de
nacimiento. Leyendo las seis reglas al revés —qué hace falta para que alguna
mande a ventas— quedan dos motivos y nada más:

> **clic de anuncio alguna vez**, **o** **sin ningún pedido y nacida después del
> corte**.

Eso es `puedeSerDeVentas` (`packages/db/src/inbox.ts`), puro, al lado de la
regla que criba. Es un **superconjunto declarado**: puede dejar pasar de más
—una conversación con clic anterior a su último pedido la pasa y `resolveInbox`
la manda a operaciones— y no puede dejar fuera ninguna que la regla mandaría a
ventas. Esa asimetría es todo el contrato: equivocarse de más cuesta derivar una
fila de sobra; equivocarse de menos borra una conversación de la pantalla.

Es la misma forma que `puedeEstarSinResponder` tiene con `sinResponder`: en SQL
se dicen hechos, en TypeScript se decide.

**Lo que ata las dos es un test, no un comentario.**
`apps/worker/src/inbox/criba.test.ts` recorre las **700 combinaciones** de los
hechos que las seis reglas miran —cinco instantes de clic × siete juegos de
pedidos × cuatro nacimientos × cinco líneas de corte— y falla si alguna cae en
ventas sin haber pasado por la criba. Verifica además que las tres reglas que
mandan a ventas estén todas representadas: una cobertura que siempre ejercita lo
mismo no cubre nada.

### El «sin pedidos» es lo que la vuelve pequeña

Con solo las dos columnas de `conversations` —clic y nacimiento— la criba deja
pasar todo lo nacido desde el encendido: el día uno son cero filas y un año
después son todas las del año, o sea el mismo problema con un año de atraso.
Preguntar además si el contacto compró es lo que hace que la criba mida **la
bandeja** y no **el calendario**. Es el único de los tres hechos que vive en otra
tabla, y por eso está.

Va como dos `not exists` que son **exactamente** el complemento de lo que carga
`loadOrderFactsByContact`, tabla por tabla y filtro por filtro: los pedidos de
tienda de la operación, y los de logística que **no** cruzan con ninguno de
tienda. Esa segunda mitad no es un detalle: un pedido de logística que apunta a
un pedido de tienda de otra operación no es un pedido *de acá*, así que
preguntar por `dropi_orders` a secas diría «tiene pedidos» de un contacto que
para el ruteo no tiene ninguno — y la criba escondería un lead.

### La bandeja de operaciones no se enumera nunca

Las dos bandejas son complementarias y enumerarlas cuesta muy distinto: la de
ventas es un puñado y se puede nombrar; la de operaciones son casi todas, y
nombrarlas **es** el `SELECT` sin `LIMIT` que había que sacar. Derivando siempre
la de ventas, las dos preguntas se contestan: la de ventas es `id in (…)` y la
de operaciones es `id not in (…)`. Esa segunda la resuelve el corte de 200 con
su índice, leyendo 200 filas.

**El corte de 200 sigue aplicándose después de derivar.** Eso no cambió y no
podía cambiar: la bandeja de ventas de Guatemala está entera fuera de las 200
más recientes.

### El hallazgo que costó una tarde: el `or` que enciende el JIT

La primera versión escribió la criba como un solo `where` con un `or`. Postgres
solo convierte un `not exists` en un anti-join cuando es un conjunto de primer
nivel; colgado de un `or` lo resuelve como subplan. **Lo ejecuta bien** —lo
*hashea*, le cuesta 5 ms— y lo **cotiza** como si lo repitiera por fila:

```
Nested Loop  (cost=0.57..12213856.70 rows=4410) (actual time=126.589..136.022 rows=1110)
  Filter: ((ad_referral_at IS NOT NULL) OR ((created_at > …) AND (NOT (hashed SubPlan 2)) …))
  JIT:
    Functions: 37
    Timing: Generation 0,897 ms, Inlining 20,409 ms, Optimization 55,644 ms, Emission 54,805 ms, Total 131,755 ms
  Execution Time: 136,918 ms
```

**131,7 ms de los 136,9 eran compilar**, sobre un trabajo real de cinco: el
costo de 12.212.184 cruza `jit_above_cost` y enciende el compilador. La criba
va ahora como un `union` de dos ramas, cada una cotizada por su cuenta, y la
segunda como un `Hash Anti Join` de verdad:

```
Sort  (cost=2032.12..2034.89 rows=1108) (actual time=4,971..4,994 rows=1108)
  ->  Hash Anti Join  (actual time=2,015..4,845 rows=1108)
        ->  Hash Anti Join  … Seq Scan on conversations · Hash on shopify_orders
Execution Time: ~5 ms
```

`union` y no `union all` porque una conversación puede cumplir los dos motivos.
`union` y no dos consultas porque son dos viajes, y el ticket se mide en viajes:
con la unión el render se queda en **14 consultas / 28 idas y vueltas**, las
mismas de antes.

---

## 5 · Lo que **no** mejoró, con su número

**Los bloques suben: 6.196 → 10.211 por render** (17.620 conversaciones, corte
viejo). Explicado arriba: se leen 18 veces menos filas por más bloques, porque
el acceso pasó de secuencial a por índice. El render bajó de 279 ms a 67.

Dos tercios del aumento son **un solo nodo**: el join a `contacts` que el
contador de la barra lateral necesita para su vista «En automático» —3.324
bloques resolviendo `contacts_pkey` fila por fila sobre 1.108 candidatas—. Se
consideró sacarlo y **se decidió pagarlo**: la alternativa es pedir `agent_mode`
en una consulta aparte, después de saber qué conversaciones son de ventas, o sea
**un viaje más en la cadena secuencial**, que desde Colombia cuesta 120 ms
contra los 0,8 ms que cuesta este join. La bandeja, que no necesita esa columna,
**ya no hace el join**: sin buscador la criba no toca `contacts` (569 bloques
contra 4.094 con él).

**La criba corre dos veces por render**, una para la bandeja y otra para el
contador, sobre la misma operación y con el mismo corte. Compartirla sería una
caché por request, que es de otro ticket (PRO-15 puso las cuatro que hay hoy).
Queda anotado: es la mitad del costo restante.

**`ad_referral_at` no tiene índice**, así que la rama del clic escanea
`conversations` (331 bloques a 17.620 filas, 1,4 ms). Con Guatemala sin anuncios
corriendo devuelve cero filas. Un índice parcial —`on conversations
(operation_id) where ad_referral_at is not null`— lo dejaría en nada y sería
diminuto, pero es una migración nueva con su costo de escritura y **eso se
decide con la medición de PRO-17 al lado**, no de paso. No se agregó.

**El techo de las ~36.000 conversaciones ya no le aplica a esta consulta**, y no
porque se haya movido: la consulta que lo tenía —el `Sort` de la operación
entera por `GREATEST(...)`— **dejó de existir**. Lo que queda ordenando en el
render son 1.108 filas en 152 kB. El instrumento lo dice ahora en vez de
extrapolar: `puntoDeDerrame` se negaba a callarse y calculaba «se cae a disco a
las 1.147 conversaciones» a partir de un `Sort` de siete filas, cuyos 25 kB son
casi todo piso fijo. Ahora, por debajo de mil filas, dice que no hay de dónde
extrapolar. **El techo hay que volver a buscarlo**, y el sitio es
`planes-de-la-bandeja.ts`; no se hizo acá.

---

## 6 · Dos defectos del instrumento, encontrados al reproducir la línea base

Reproducir el número viejo antes de tocar nada destapó dos cosas en
`ensayo-bandeja-a-escala.ts`, las dos del mismo origen: **la caché del vendedor
dura cinco segundos y el ensayo no la invalidaba.**

1. **La escena «hoy · bandeja apagada» medía la encendida.** Apagar al vendedor
   es vaciar `display_name` en la base, pero el marco lo **lee** a través de
   `getSalesAgentSettings`, que cachea: con la caché caliente seguía viendo al
   vendedor configurado y `countSalesInboxViews` corría igual, sumándole 3.605
   filas a la línea base. Daba **4.661 filas donde PRO-10 midió 1.256**, y a 10×
   —donde la caché sí había expirado— daba 1.056. Una línea base que depende de
   si un TTL venció no es una línea base.
2. **La medición de la escritura daba 1 fila en vez de 199.** `medirLaEscritura`
   mueve `activated_at` 400 días atrás y vuelve a leer el vendedor; sin
   invalidar, leía el de antes, ninguna conversación caía en ventas y el render
   soltaba una sola asignación. **El número del ticket dependía de si habían
   pasado cinco segundos.**

Las dos se arreglan con `invalidateSalesAgentSettingsCache()` en el sitio, y con
eso el ensayo reproduce PRO-10 exacto: **199 filas escritas por un solo render**.

Y una perilla nueva, `ACTIVACION=reciente|vieja`, porque medir solo con el corte
recién puesto se lee como una mejora que no envejece, y medir solo con el corte
viejo esconde el caso que de verdad va a ocurrir el lunes.

`regla-de-medir.ts` cuenta ahora también **bloques del render entero**, sumando
todas sus consultas. `planes-de-la-bandeja.ts` cuenta bloques solo de las que
tocan `conversations`: eso servía para juzgar un índice sobre esa tabla (PRO-17)
y engaña para juzgar esto, que baja las filas de la derivación **y con ellas las
de la carga de pedidos** — consultas que aquel conteo no mira. Comparar por un
total parcial es elegir el marcador después del partido.

---

## 7 · Lo que entra

| | |
| -- | -- |
| `packages/db/src/inbox.ts` | `puedeSerDeVentas` y `SalesSieveFacts`: la criba, pura, al lado de la regla |
| `apps/web/src/lib/queries.ts` | la criba en SQL, la bandeja dicha como pertenencia, el contador compartiéndola, y **sin** `releaseStaleAssignments` |
| `apps/worker/src/inbox/asignacion.ts` | la liberación, en su casa nueva |
| `apps/worker/src/jobs/liberar-asignaciones.ts` | el barrido cada 10 minutos |
| `apps/worker/src/routes/shopify.ts` | el gancho donde nace el hecho |
| `apps/worker/src/inbox/facts.ts` | la carga de pedidos por conjunto, acotada por operación |
| `apps/worker/src/inbox/criba.test.ts` | 700 combinaciones + un caso con nombre por regla |
| `apps/worker/src/inbox/lectura-sin-escritura.ts` + su test | la red que impide que la escritura vuelva |
| `apps/worker/src/operations/consultas-del-panel.*` | las funciones nuevas en la lista de nombres; el partidor de funciones, exportado para la red nueva |
| `scripts/volcado-de-bandeja.ts` | **nuevo** — el instrumento de identidad |
| `scripts/ensayo-bandeja-a-escala.ts` | los dos arreglos del punto 6, la perilla `ACTIVACION`, y la medición del camino nuevo |
| `scripts/regla-de-medir.ts` | bloques del render entero |
| `scripts/viajes-del-panel.ts` | los bloques en el resumen; el guardia de producción, con su razón al día |

**Ninguna migración.** Este ticket no agrega ni quita índices ni columnas: la
`0031` es de PRO-17 y sigue sin aplicarse a producción.

### Las dos redes, al día

La red de alcance por operación ve las consultas nuevas y las dos acotan:
`traerCandidatas`, `traerCandidatasConModoAgente` y `sinPedidosEnSQL` están en
su lista de nombres. `countSalesInboxViews` **salió** de esa lista y no es un
descuido: desde este ticket no tiene consulta propia —cuenta sobre la criba
compartida, que es la que se vigila—, y una función sin consulta no es una fuga.

La red nueva (`lectura-sin-escritura`) lee `queries.ts` y falla si alguna
función del camino de lectura del Inbox escribe una fila. Verifica además que
todos los nombres que dice vigilar existan: un vigilante que no encuentra a
quien vigila tiene que decirlo.

---

## 8 · Cómo se repite, entero

```bash
docker run -d --name wa-ensayo-acotada -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=wa -p 55985:5432 postgres:16-alpine

export DATABASE_URL="postgres://postgres:test@127.0.0.1:55985/wa"
pnpm --filter @wa/db migrate                       # incluida la 0031
SEMBRAR=si ESCALA=si npx tsx scripts/seed-bandejas-ensayo.ts

# identidad (el diff)
ARCHIVO=/tmp/despues.json LIBERAR=si npx tsx scripts/volcado-de-bandeja.ts

# costo, a tres escalas y con los dos cortes
WA_SQL_TRACE=1 ENSAYAR=si ACTIVACION=reciente npx tsx scripts/ensayo-bandeja-a-escala.ts
WA_SQL_TRACE=1 ENSAYAR=si ACTIVACION=vieja    npx tsx scripts/ensayo-bandeja-a-escala.ts

# el render entero, y los planes
WA_SQL_TRACE=1 BANDEJA=operaciones npx tsx scripts/viajes-del-panel.ts
WA_SQL_TRACE=1 DETALLE=si npx tsx scripts/planes-de-la-bandeja.ts

docker rm -f wa-ensayo-acotada
```

El «antes» sale del mismo comando sobre `apps/web/src/lib/queries.ts` sin este
diff; cada escala necesita su base recién sembrada, porque el ensayo hace crecer
la tabla y mueve `activated_at`.

---

## 9 · Lo que no se hizo, y por qué

- **No se mergeó, no se deployó y no se aplicó la `0031` a producción**, como
  pedía el encargo.
- **No se tocó producción más que con `SELECT`.** El worker nunca se levantó con
  credenciales de producción y no salió ni un mensaje a ningún número.
- **No se borró `conversations_last_msg_idx`.** Es PRO-24.
- **No se agregó ningún índice.** El parcial sobre `ad_referral_at` está
  argumentado en el punto 5 y no se decide de paso.
- **No se buscó de nuevo el techo.** El viejo dejó de aplicar porque la consulta
  que lo tenía desapareció; encontrar el nuevo es una medición propia.
- **No se compartió la criba entre la bandeja y el contador dentro del mismo
  render.** Es una caché por request y es de otro ticket.

---

## Las casillas

### PRO-18

- [x] La carga de la bandeja de ventas no lee todas las conversaciones de la operación — de 69.857 filas a 1.611 a 10× de escala, y **planas** con el corte recién puesto
- [x] La bandeja devuelve exactamente el mismo conjunto de filas que antes — siete escenarios volcados a JSON, `diff` sin una línea
- [x] La conversación vieja que entra por estar sin responder sigue apareciendo — 157 rezagadas en `operaciones-vieja`, las mismas antes y después; y la criba no tiene ningún campo de actividad con el que cortarlas
- [x] Un caso de prueba nuevo por cada motivo por el que una fila entra a la bandeja — las tres reglas de ventas con nombre, más las 700 combinaciones que atan la criba a la regla
- [x] Los tests de derivación existentes siguen en verde **sin modificarse** — `resolve.test.ts` y `asignacion.test.ts` no se tocaron
- [x] La medición se repite y queda escrito el antes y el después — puntos 1 y 8
- [x] El contador de la barra lateral recibe el mismo tratamiento, y el número que muestra no cambia — de 34.330 filas a 207; los seis números del volcado, idénticos

### PRO-20

- [x] Cargar la bandeja no escribe ninguna fila — 199 → **0** sobre el caso fabricado de 200 asignaciones viejas
- [x] Una asignación que dejó de corresponder se sigue soltando, por el camino nuevo — las mismas 199, mirando 201 filas en vez de 17.620
- [x] Hay un test de que la lectura no dispara la liberación — `lectura-sin-escritura.test.ts`, y el volcado lo confirma en la base
- [x] Los tests de asignación existentes siguen en verde — `asignacion.test.ts`, sin tocar
- [x] Queda escrito cuánto tarda en soltarse por el camino nuevo — inmediato por el gancho del pedido, **≤ 10 minutos** por el barrido, con la consecuencia del atraso dicha entera en el punto 3
