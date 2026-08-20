# PRO-9 — Entrega · El contador de viajes vive en el repo

Rama `danielmedinac22/regla-de-medir`. **Sin mergear y sin deployar.**
`pnpm -r typecheck` limpio; `pnpm --filter @wa/worker test` en verde: **878
pruebas en 56 archivos** (el piso con el que arrancó).

Todo lo medido sale de producción de Guatemala, **solo `SELECT`**, 20-ago-2026,
desde una máquina en Colombia. Va junto con [PRO-10](../bandeja-de-ventas-a-escala/entrega.md),
que mide con este mismo instrumento.

---

## El comando

```bash
WA_SQL_TRACE=1 npx tsx scripts/viajes-del-panel.ts
```

Tres archivos, y el reparto importa:

| Archivo | Qué es |
| -- | -- |
| `packages/db/src/sql-trace.ts` | La traza. **Apagada salvo `WA_SQL_TRACE=1`.** |
| `scripts/regla-de-medir.ts` | La regla: la secuencia real del panel y las cuentas. No es un comando. |
| `scripts/viajes-del-panel.ts` | El comando de este ticket. |

`packages/db/src/client.ts` cambió en dos líneas y **las dos son nada con la
variable apagada**: `sqlTraceOptions()` devuelve `{}` e `instrumentarTrazaSql()`
devuelve el cliente sin tocar. Verificado en el sitio:

```
sin la variable:  opción debug del cliente = false   unsafe envuelto = false
con la variable:  opción debug del cliente = [Function]   unsafe envuelto = true
```

Corre contra la base que se le indique por `DATABASE_URL`; con la de producción
se niega a derivar bandeja, porque derivar escribe.

---

## 1 · Los números de hoy

Producción, Guatemala, **1.764 conversaciones**, 27.572 mensajes. Medido desde
Colombia con **120,1 ms** de ida y vuelta a `shuttle.proxy.rlwy.net`.

| | |
| -- | --: |
| **Consultas por render** (marco ∥ pantalla) | **13** |
| **Idas y vueltas de red** | **23** |
| **Cadena secuencial** | **4 consultas = 6 idas y vueltas** |
| Render, proceso caliente | **1.193 ms** (promedio de 5) |
| Render, proceso frío | **3.081 ms** · 19 consultas |
| Filas leídas | **1.322** |
| Filas escritas | **0** |
| De ese tiempo, Postgres ejecutando SQL | **20,3 ms — 1,7 %** |

Desglose, con las conexiones ya calientes:

| | consultas | i/v | cadena | ms | filas |
| -- | --: | --: | --: | --: | --: |
| marco · `layout.tsx` | 2 | 2 | 2 / 2 | 240 | 2 |
| pantalla · `page.tsx` | 11 | 21 | 4 / 7 | 1.025 | 1.320 |
| `listConversations()` | 8 | 16 | 3 / 6 | 1.067 | 1.303 |
| `listApprovedWaTemplates()` | 1 | 2 | 1 / 2 | 244 | 15 |

Las trece consultas de un render caliente, en orden:

```
 #   ms      filas  cnx  consulta
 1   118,3       1   4*  select sales_agent_settings      ← marco
 2   119,5       1   3*  select kapso_connection          ← marco
 3   256,9      45   8*  select conversations +1 join     ┐
 4   292,6     406   2*  select outbound_messages ⧉       │ loadSinResponderIds
 5   244,0      93   5*  select outbound_messages         ┘
 6   404,5     200   7*  select conversations +2 join     ← la lista
 7   238,2      15   6*  select wa_templates              ← plantillas
 8   239,2       1   4   select dropi_connection          ← CDN de guías
 9   119,6       1   3   select sales_agent_settings      ← pantalla (otra vez)
10   276,2      34   3   select conversations +2 join     ← las rezagadas
11   244,0      62   6   select outbound_messages         ← escaladas
12   323,9     236   4   select dropi_orders
13   259,9     227   5   select shopify_orders
── 13 consultas = 23 idas y vueltas · cadena de 4 (6 i/v) · 1.131,9 ms
```

---

## 2 · Cuatro correcciones al diagnóstico del 20-ago

Ninguna lo contradice de fondo —**el problema es la distancia y no la base**, y
eso queda más firme que antes—. Las cuatro cambian con qué número comparar.

### a. No son diez consultas, son trece

Las diez del diagnóstico son la pantalla **sin contar su propio
`getSalesAgentSettings`**. El render completo incluye el marco, que es parte de
cada carga: `layout.tsx` lee `kapso_connection` y `sales_agent_settings` antes
de dibujar el riel.

```
marco      2  (kapso_connection, sales_agent_settings)
pantalla  11  (sales_agent_settings, listConversations ×8, dropi_connection, wa_templates)
          ──
render    13
```

Las 8 de `listConversations` del diagnóstico están confirmadas exactas.
`sales_agent_settings` se lee **dos veces por render**, una por el marco y otra
por la pantalla, con el mismo texto y el mismo resultado.

### b. Trece consultas son veintitrés idas y vueltas

`client.ts` construye el cliente con `prepare: false`. Con eso, `postgres-js`
marca `describeFirst` para **toda consulta que lleve parámetros**
(`connection.js`: `q.describeFirst = q.onlyDescribe || (parameters.length &&
!q.prepared)`), manda `Describe` con `Flush`, **espera la respuesta**, y recién
entonces manda `Bind`/`Execute`. Dos vueltas enteras por consulta.

Medido contra producción, sin discutirlo de memoria:

| | mediana de 9 |
| -- | --: |
| `select 1` (sin parámetros) | **120,8 ms** |
| `select $1::int` (un parámetro) | **240,8 ms** |
| `select $1::int, $2::int` (dos) | 240,7 ms |

El doble exacto, y da igual cuántos parámetros. De las 13 consultas del render,
10 llevan parámetros: **23 idas y vueltas, no 13**. El script imprime los dos
números y nunca uno solo.

### c. Lo que la distancia multiplica no son los viajes, es la cadena

Trece viajes × 120 ms da 1.561 ms, que es **más que el render entero**. La cuenta
no cierra porque casi todas salen en paralelo y sus latencias se solapan. Lo que
se paga en fila india es la cadena más larga de consultas que no se solapan:
**4 consultas, 6 idas y vueltas**.

```
piso por distancia   720,4 ms  = 6 idas y vueltas × 120,1 ms  (60,4 % del render)
lo demás             473,1 ms  (traer las filas por el cable, derivar en memoria)
…de eso, SQL          20,3 ms  (1,7 %)
```

Los dos números importan y dicen cosas distintas: **los viajes son la carga que
se le pone a la base; la cadena es el tiempo que espera quien mira la pantalla.**
El script calcula la cadena sobre la traza —la selección de actividades de
siempre— y no sobre el código, así que sigue siendo cierta cuando `queries.ts`
cambie.

### d. La introspección de tipos es por conexión, no por consulta con arreglos

Con `prepare: false`, cada conexión **recién abierta** gasta un viaje extra
preguntándole a `pg_catalog.pg_type` por los tipos de arreglo
(`connection.js`, `fetchArrayTypes`, disparada desde `connect()` y no desde una
consulta). En la pasada fría son **5 consultas de introspección** —una por cada
conexión nueva más allá de la primera—, y en las calientes cero.

Eso es lo que separa el proceso frío del caliente, y por eso el script los
imprime aparte:

```
proceso frío       3.081 ms · 19 consultas (5 de introspección)
proceso caliente   1.193 ms · 13 consultas
primera vez       +1.888 ms  TCP, TLS e introspección de tipos
```

---

## 3 · Contra qué comparar, y desde dónde

**El conteo de viajes no depende de dónde se mida; el tiempo sí.** Por eso el
script mide la ida y vuelta *antes* de medir el render y la imprime arriba de
todo. Estos 1.193 ms son desde Colombia con 120,1 ms de latencia; desde Vercel
`iad1` el mismo render dará otro número **con las mismas 13 consultas, las
mismas 23 idas y vueltas y la misma cadena de 6**.

Para que PRO-14, PRO-15 y PRO-16 se comparen contra algo y no contra una
sensación, la línea base es esta:

| Lo que no cambia con el sitio de medición | |
| -- | --: |
| Consultas por render | **13** |
| Idas y vueltas | **23** |
| Cadena secuencial | **4 consultas / 6 idas y vueltas** |
| Filas leídas | **1.322** |
| SQL ejecutado en Postgres | **~20 ms** |

| Lo que sí cambia | desde Colombia |
| -- | --: |
| Ida y vuelta | 120,1 ms |
| Render caliente | 1.193 ms |
| Render frío | 3.081 ms |

---

## 4 · Anotado y no tocado

El encargo dice medir, no arreglar. Tres cosas que la medición destapó y que le
sirven a los tickets de arreglo:

**`prepare: false` es una línea y vale 10 idas y vueltas por render.** Está en
`packages/db/src/client.ts:19`. Quitarlo haría que las consultas con parámetros
pasen de dos vueltas a una después de la primera. No se toca acá: hay que ver
qué hace con el proxy TCP de Railway y con `max: 10`, y eso es un ticket.

**Cachear plantillas y logística baja la carga, no el reloj.** Es el segundo
frente del spec. `wa_templates` y `dropi_connection` son 2 de las 13 consultas y
4 de las 23 idas y vueltas, pero corren dentro del mismo `Promise.all` que
`listConversations`, que sola tarda 1.067 ms de los 1.025 ms de la pantalla —
las dos cortas terminan holgadamente dentro de esa ventana. **La ganancia
esperable en tiempo de pared es cercana a cero** mientras no se acorte la cadena.
Sigue valiendo la pena por la carga sobre la base y porque son datos que cambian
una vez al mes, pero conviene declararlo antes para que después el número no
decepcione. Este script lo va a medir el día que se haga.

**`sales_agent_settings` se lee dos veces por render**, marco y pantalla, misma
consulta. Es un viaje de 120 ms desde Colombia.

Sobre la meta declarada del spec —«cuatro viajes o menos por render»—: hoy son
13 consultas y la cadena ya es de 4. Son dos metas distintas y conviene que el
ticket diga a cuál apunta, porque bajar consultas y bajar cadena no se logran con
los mismos cambios.
