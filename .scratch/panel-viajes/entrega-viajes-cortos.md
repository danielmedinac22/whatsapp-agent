# PRO-15 + PRO-16 — Entrega · Los viajes cortos

Rama `danielmedinac22/viajes-cortos`. **Sin mergear, sin rebasar y sin deployar.**

`pnpm -r typecheck` limpio. `pnpm test` en verde: **926 pruebas del worker en 59
archivos + 16 del panel** (el piso eran 915 + 16; entran 16 nuevas y salen 5 que
se reescribieron). `pnpm -r lint` sigue roto y sigue siendo PRO-23: no se tocó.

---

## El número

Medido con la regla de PRO-9, que es la que pedía el encargo y no se
reconstruyó:

```bash
WA_SQL_TRACE=1 npx tsx scripts/viajes-del-panel.ts
```

### Bandeja apagada — lo que corre hoy en Guatemala

| | antes | después |
| -- | --: | --: |
| **Consultas por render** | 13 | **4** |
| **Idas y vueltas** | **23** | **8** |
| Cadena secuencial | 4 consultas / 6 idas y vueltas | **2 / 4** |
| Filas leídas | 1.257 | **1.056** |
| Arranque en frío (consultas de aplicación) | 14 | **10** |

**La meta del encargo era cuatro o menos. Son cuatro.** Y la cadena secuencial
—que es lo que la distancia multiplica, no el total— baja de 6 idas y vueltas a
4: desde Vercel eso es la mitad de la espera que paga quien mira la pantalla.

Las cuatro que quedan, tal como las imprime la traza:

```
 1   select outbound_messages ∪ ⧉      ← la última respuesta y las escaladas, juntas
 2   select conversations +2 join      ← el corte, las candidatas y la anclada, juntas
 3   select dropi_orders               ← depende de los contactos de la 2
 4   select shopify_orders             ← depende de los contactos de la 2
```

Dos rondas: (1, 2) en paralelo, y después (3, 4) en paralelo.

### Bandeja encendida — el día que se configure al vendedor

No es de estos dos tickets (es PRO-18 y PRO-20), pero se mide igual porque el
trabajo la toca:

| | antes | después |
| -- | --: | --: |
| Consultas por render | 24 | **14** |
| Idas y vueltas | 45 | **28** |
| Cadena secuencial | 7 / 12 | **4 / 8** |
| Filas leídas | 8.500 | **8.317** |

Lo que queda ahí adentro es `conversationIdsOfInbox` y `countSalesInboxViews`,
que el encargo marcó como de otros dos worktrees y no se tocaron.

### Dónde se midió, y por qué no en producción

Contra **base de ensayo en Docker sembrada a escala de producción** (1.725
conversaciones; producción tiene 1.764), con
`scripts/seed-bandejas-ensayo.ts ESCALA=si`. La línea base salió **exacta**:
13 consultas, 23 idas y vueltas, 1.256 filas — los mismos números del encargo.
Que la base de ensayo reprodujera la medición del encargo hasta la fila es lo
que hace comparable el después.

No se midió contra producción: este worktree no tiene `.env`, que es
deliberado. **El conteo de viajes no depende de dónde se mida** —lo dice el
encabezado de la propia regla— y es el criterio de los dos tickets. Los
milisegundos de esta entrega son de localhost y no significan nada para Vercel;
por eso no se reportan como mejora.

---

## PRO-15 · Las lecturas que dejaron de viajar

El encargo nombraba dos. Al medir eran **cuatro** las lecturas del render que
traen datos que cambian una vez al mes, y hacían falta las cuatro para llegar a
cuatro viajes:

| Lectura | Quién la escribe | Qué la invalida |
| -- | -- | -- |
| Plantillas aprobadas de WhatsApp | worker · `ensureKapsoTemplates`, `refreshKapsoTemplateStatuses` | `invalidateApprovedWaTemplatesCache(op)` |
| URL base de los archivos de logística | worker · `upsertDropiConnection` | `invalidateAssetsBaseUrlCache(op)`, colgada del invalidador que ya existía |
| Teléfonos del riel (`kapso_connection`) | worker · `kapso/connection.ts` | `invalidateConnectionPhonesCache()`, colgada de `invalidateKapsoConnectionCache` |
| Configuración del vendedor | panel · `saveVendedorSettings` | `invalidateSalesAgentSettingsCache(op)` |

Las dos últimas no estaban en el ticket. Van con su motivo:

- **El vendedor se leía dos veces por render** —el marco pregunta si hay
  vendedor para dibujar el riel, la pantalla pregunta lo mismo para decidir si
  hay dos bandejas—, y las dos consultas cruzaban el país por la misma fila.
- **Los teléfonos del riel** los paga cada render de **las siete pantallas**,
  igual que `listOperations`, que ya estaba cacheada al lado. Eran hermanas y
  una viajaba.

### Dónde vive la caché, y por qué ahí

La clase `OperationScopedCache` ya existía y estaba probada, pero vivía en
`apps/worker/src/operations/cache.ts` y **el panel no puede importar del
worker**. Se subió a `packages/db/src/cache.ts` y el archivo del worker quedó
como re-exportación, igual que se hizo en su día con `listOperations`. No se
copió: dos implementaciones de la misma idea con dos TTL es exactamente el error
que el contract del ticket 06 vino a cerrar.

Las cuatro cachés concretas viven en `packages/db/src/caches-del-panel.ts`, y el
archivo dice por qué en su encabezado: **se leen desde `apps/web` y tres se
escriben desde `apps/worker`**, que son dos procesos y dos despliegues. El
almacén tiene que estar donde los dos lo alcanzan. Las consultas se quedaron
donde estaban —`listApprovedWaTemplates` sigue en `queries.ts`, con su filtro
por operación a la vista de la red de alcance—; lo único que subió es dónde se
guarda lo que trajeron.

### Lo que la invalidación NO alcanza

Está escrito en el encabezado del módulo y no descubierto después. **El panel
corre en funciones de Vercel: hay varias instancias vivas y cada una tiene su
copia de estos `Map`.** Invalidar en el punto de escritura vacía la instancia
que atendió esa escritura, no las demás; y cuando quien escribe es el worker, no
vacía ninguna del panel. **Lo que de verdad acota el desfase es el TTL.**

Por eso el del vendedor es más corto que el resto: 5 s contra 30 s. El resto se
ve mal unos segundos —una plantilla que todavía no aparece en el menú—; el del
vendedor **se comporta** distinto, porque es el interruptor que decide si la
operación tiene dos bandejas. Cinco segundos alcanzan para que el marco y la
pantalla del mismo render lean una sola vez, que era de donde salía la consulta
repetida.

### Cómo se probó

**Como función pura, con el tiempo por parámetro**, que es lo que pedía el
spec. `OperationScopedCache` recibe el reloj como argumento con `Date.now()` por
defecto, así que ningún llamador de producción cambia y el vencimiento se prueba
como lo que es: una resta entre dos números.

Las pruebas viejas estaban en `resolve.test.ts` y la del vencimiento usaba un
TTL de 1 ms con un `setTimeout` de 5 — un test que depende de que la máquina no
se distraiga entre dos líneas. Se mudaron a `cache.test.ts` y se reescribieron.
**16 pruebas**, entre ellas:

- entrega lo guardado antes del vencimiento y vuelve a la fuente después;
- la invalidación explícita la vacía de inmediato;
- **nunca le sirve a una operación lo que cargó para otra**, y invalidar
  Guatemala no manda a Colombia a la base.

Y además **contra una base de verdad con dos operaciones**, porque una caché mal
llaveada no falla, miente. Se sembró Colombia con sus propias plantillas y su
propio CDN, y se comprobó en ejecución que cada operación ve lo suyo en frío y
en caliente, que insertar una plantilla e invalidar la hace aparecer de
inmediato, y que invalidar Guatemala no le cambia nada a Colombia. Las once
comprobaciones pasaron; el guion era de ensayo y no se commiteó.

---

## PRO-16 · De trece a cuatro

Ocho de los trece viajes salían de `listConversations`. Quedaron cuatro, y no se
tocó ni `conversationIdsOfInbox` ni `releaseStaleAssignments`.

### Tres consultas de conversaciones → una

Eran tres con la misma forma y distinto `where`:

1. **el corte**: las 200 más recientes por actividad;
2. **las candidatas a estar sin responder**, que se calculan sobre las 1.725 y
   no sobre las 200 —o el número miente—;
3. **las rezagadas**: las candidatas que quedaron fuera del corte por viejas y
   que la lista tiene que mostrar igual. Encadenada detrás de las otras dos.

Ahora el `where` es la unión de las tres y **cada fila dice a cuál pertenece**,
con dos columnas booleanas. El corte sigue siendo un `LIMIT` en SQL, como
subconsulta de ids: sacarlo a memoria habría convertido «traeme el corte y
además las candidatas» en traer la operación entera para tirar 1.500 filas: lo
que sube en bytes es peor que lo que baja en viajes.

**La conversación anclada entró en la misma consulta.** Era un viaje extra por
una sola fila cuando alguien salta desde Pedidos a una conversación que no está
en la lista. La pertenencia a la operación sigue siendo la misma: el `and` con
`ofOperation` está en el `where` de afuera, así que un id de otro país sigue sin
poder colarse.

### Tres consultas de salientes → una

- La última respuesta a cada cliente y las escaladas viajan juntas con un
  `union all`. Cada mitad conserva su `from`, su `where` y su filtro por
  operación **a la vista**, que es lo que la red sabe leer.
- **La tercera sobraba entera.** `loadEscalationsByWaId` volvía a pedir las
  escaladas ya filtradas por los `wa_id` que la lista iba a mostrar, cuando la
  otra consulta ya traía *todas* las de la operación —93 filas en producción, sin
  filtro—. Estaban en memoria antes de que nadie las pidiera.

Se conserva un `loadEscalationsByWaId` acotado para el contexto de venta de un
hilo abierto, donde pedir las 93 para mirar una sería traer de más. **Son dos
cargas, no dos reglas**: qué aviso cuenta como escalada y en qué orden va lo
decide `escaladasPorWaId`, pura y compartida. Es la misma división que
`loadOrderFactsByContact` ya tenía con el worker.

### Lo que no cambió, y cómo consta

**La lista devuelve exactamente las mismas filas, en el mismo orden.** No es una
impresión: se volcó a JSON lo que `listConversations` devuelve —id, contacto,
fallo de entrega, asignado, `sinResponder`, resumen de logística, resumen de
tienda, ruteo, vista previa y no leídos— antes y después, en **siete escenarios**,
y se diffeó.

| Escenario | Filas | Diff |
| -- | --: | -- |
| sin bandeja, sin buscar | 370 | idéntico |
| buscando `"a"` | 200 | idéntico |
| buscando `"502"` (por dígitos) | 200 | idéntico |
| con conversación anclada | 371 | idéntico |
| bandeja de operaciones | 357 | idéntico |
| bandeja de ventas | 115 | idéntico |
| bandeja de ventas + búsqueda | 115 | idéntico |

Las **370 filas del primer escenario son 200 del corte + 170 rezagadas**: el
diff idéntico *es* la prueba de que las sin responder que quedan fuera del corte
por viejas siguen apareciendo. Y para que la bandeja de ventas probara algo se
le corrió la línea de corte del vendedor hacia atrás: con la fecha de hoy traía
**una** fila, y una bandeja casi vacía se ve ordenada y no prueba nada.

### La red de alcance sigue en verde — y ve más que antes

`consultasSinAlcance` devuelve vacío sobre los dos archivos vigilados, y las
funciones nuevas están en su lista de nombres: **`getAssetsBaseUrl`** y
**`loadSalientesDelInbox`**.

Al inventariar lo que la red veía apareció un agujero: **`outbound_messages` no
estaba vigilada**. Sus filas son de una operación —por el `to_wa_id`, que es para
lo que existe `waIdOfOperation`— y sus tres consultas del panel pasaban sin que
nadie las mirara. Faltaban dos cosas que se tapaban entre sí: la tabla en
`TABLAS_CON_DUENO_INDIRECTO`, y **`waIdOfOperation` en `MARCADORES_DE_ALCANCE`**,
cuyo comentario decía «los cuatro ayudantes» y enumeraba cuatro de los cinco.
Sin la tabla nadie miraba esas consultas; sin el marcador, mirarlas habría dado
falsos positivos.

Las dos cosas quedaron corregidas, con pruebas de que un saliente sin acotar se
atrapa y uno acotado por `wa_id` pasa. Se descubrió justamente al fusionar dos de
esas consultas: **la consulta nueva no aparecía en el inventario.**

---

## Las dos listas del encargo

**PRO-15**

- [x] Las plantillas aprobadas no se releen en cada render
- [x] La conexión de logística no se relee en cada render
- [x] Editar plantillas invalida su caché de inmediato — invalidación en los dos
      puntos de escritura del worker, comprobada contra base real
- [x] La caché nunca devuelve datos de una operación a otra — llaveada por
      operación, con prueba unitaria y comprobación con dos operaciones sembradas
- [x] El contador baja, y queda escrito el antes y el después
- [x] La caché se prueba como función pura, con el tiempo como parámetro

**PRO-16**

- [x] Un render del Inbox hace cuatro viajes o menos — **cuatro**
- [x] La lista devuelve exactamente las mismas filas, en el mismo orden — diff
      idéntico en siete escenarios
- [x] Las sin responder que quedan fuera del corte por viejas siguen apareciendo
      — las 170 rezagadas del diff
- [x] La red de alcance sigue en verde, y toda función nueva está en su lista
- [x] El contador muestra el antes y el después
- [x] Ninguna consulta nueva lee filas de una operación que no es la suya

---

## Dos cosas que la regla de medir no estaba contando

Las dos aparecieron al usarla sobre el código nuevo, y las dos habrían dejado la
medición mintiendo a favor:

1. **La consulta fusionada se llamaba `? ?` en la tabla de viajes**, porque su
   texto empieza con el paréntesis de un `union` y el resumidor buscaba el verbo
   en la primera palabra. La línea que más se mira, sobre la consulta más
   importante del render. Peor: `tiempoEnPostgres` filtra por `^select` para no
   ejecutar escrituras con `EXPLAIN ANALYZE`, así que **la consulta más grande se
   caía de la cuenta de «cuánto de esto es Postgres pensando»** sin decirlo.
2. **La pasada fría ya no era fría.** El script lee al vendedor durante su
   preparación, para saber si la operación tiene dos bandejas; con la caché
   nueva eso dejaba la pasada 1 con una consulta menos que un arranque de
   verdad. Ahora la pasada fría vacía las cinco cachés, como ya hacía con la de
   operaciones y por el mismo motivo escrito en su comentario.

---

## Lo que se miró y se decidió no hacer

**La subconsulta correlacionada** que dice si el último saliente falló, la que
el encargo señala: sigue evaluándose una vez por fila. Con el plan a la vista
son 370 vueltas de `SubPlan 1` dentro de una consulta que ejecuta en 2,6 ms, y
el render entero le deja a Postgres 2,8 ms de 15. **No es donde está el costo** —
que es la tesis del propio encargo: el costo es la cantidad, no el trabajo. Aviso
honesto: esto se midió sobre una base de ensayo con 22 mensajes y producción
tiene 27.527, así que el costo por vuelta allá es mayor. Es trabajo de índice, o
sea PRO-17, y por eso no se tocó `schema.ts` ni se escribió una migración.

**Deduplicar lecturas en vuelo** en la caché. El marco y la pantalla suspenden
en paralelo, así que en un render **frío** los dos preguntan por el vendedor
antes de que ninguno conteste y las dos consultas viajan; del segundo render en
adelante no viaja ninguna. Compartir la promesa ahorraría esa consulta una vez
por arranque y a cambio dejaría una promesa rechazada cacheada — un error pegado
a la operación hasta que venza. Está escrito en el código con esas palabras.

**Nada de esto necesitó tocar** `inbox-client.tsx`, `schema.ts`, migraciones,
`conversationIdsOfInbox` ni `releaseStaleAssignments`.

---

## Para quien lo revise

El cambio se lee en este orden:

1. `packages/db/src/cache.ts` — la caché, con el reloj por parámetro.
2. `packages/db/src/caches-del-panel.ts` — qué se cachea y qué no alcanza la
   invalidación.
3. `apps/web/src/lib/queries.ts` — `loadSalientesDelInbox`, `sinResponderEntre`
   y la consulta fusionada de `listConversations`.
4. `apps/worker/src/operations/consultas-del-panel.ts` — el agujero de la red.

Y la comprobación se repite en dos comandos, con la base de ensayo levantada:

```bash
docker run -d --name wa-viajes -e POSTGRES_PASSWORD=test -e POSTGRES_DB=wa \
  -p 55977:5432 postgres:16-alpine
DATABASE_URL="postgres://postgres:test@127.0.0.1:55977/wa" pnpm --filter @wa/db migrate
DATABASE_URL="postgres://postgres:test@127.0.0.1:55977/wa" SEMBRAR=si ESCALA=si \
  npx tsx scripts/seed-bandejas-ensayo.ts
# la bandeja se apaga en la base, no por parámetro: el layout lee al vendedor
psql "postgres://postgres:test@127.0.0.1:55977/wa" -c "update sales_agent_settings set display_name='';"
DATABASE_URL="postgres://postgres:test@127.0.0.1:55977/wa" WA_SQL_TRACE=1 PASADAS=4 \
  npx tsx scripts/viajes-del-panel.ts
```
