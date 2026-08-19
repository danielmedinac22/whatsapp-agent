# Estado del Panel de Ventas — punto de entrada

**Si acabas de llegar a este proyecto con contexto fresco, lee este archivo primero.** Está al día al **18-ago-2026**.

## Lo primero, antes de tocar nada

1. **`.scratch/panel-de-ventas/no-regresion.md`** — la restricción que manda sobre todo. Guatemala factura hoy (~470 pedidos/mes, 88,4% de confirmación) y no puede cambiar de comportamiento. Si un ticket obliga a elegir entre avanzar y no tocar Guatemala, **no se toca Guatemala**.
2. **`.scratch/panel-de-ventas/map.md`** — por qué cada cosa es como es, y los términos comerciales que **no se re-litigan**.
3. El ticket que vayas a trabajar y su `spec.md`.

## Reglas de trabajo, aprendidas a golpes

- **`pnpm -r typecheck` y `pnpm --filter @wa/worker test` después de CADA ticket**, no al final. Hoy: **4 paquetes limpios, 787 tests en 49 archivos.**
- **`dropi_dry_run` está en `true` a propósito.** Confirmado intencional: es el default del esquema, está expuesto como interruptor en el panel, y `84b62c0` quitó el auto-confirm dejando el botón manual como único camino. **No lo cambies.**
- **Los tests van sobre funciones puras con fixtures**, en el estilo de `kapso/inbound.test.ts`. **Nombres en español que enuncian el comportamiento**, no la mecánica.
- **Si algo del ticket contradice el código real, para y pregunta. El código gana.** Pasó varias veces y las correcciones valieron más que los tickets.
- **El `.env` ES producción.** No hay base de desarrollo. Leer sí; escribir, solo lo autorizado.
- **No mandes mensajes a números de clientes reales.** No hay allowlist ni modo observador. No arranques el worker en local.
- **Railway:** hay un `RAILWAY_TOKEN` inválido en el entorno que tapa el login. Se ignora con `env -u RAILWAY_TOKEN`. Ver `CLAUDE.md`.

## Qué está construido y en producción

**37 de 43 tickets resueltos.** Ocho migraciones aplicadas (`0020`–`0027`) y la **`0028` sin aplicar**. Worker en Railway y dashboard en Vercel, desplegados y verificados.

- **Migración multi-operación completa** (tickets 01–06). Existe `operations`; Guatemala registrada (`GT`/`GTQ`/`active`); **cero `eq(<tabla>.id, 1)` en toda la base** — ningún accesor devuelve conexión o configuración sin decir de qué operación.
- **La atribución del primer contacto** — referencia del anuncio y `ctwa_clid` se capturan y persisten. Era irreversible: no existe endpoint de Meta para recuperarlos después.
- **El reconocimiento de producto** — cascada pura con matcher inyectado; REVITALHAIR da *ambiguo*, nunca una elección.
- **El ruteo de bandeja** — derivado, no guardado, con el recomprador cubierto.
- **El constructor de orden** — validación geográfica de los dos países, clamp de descuento, idempotencia por lead.
- **El constructor del evento CAPI**.
- **Sebastián** — persona, contexto de producto y escalamiento.
- **Roles de ventas y operaciones**, sin que ningún admin pierda acceso.
- **El pulido de comportamiento del panel** (móvil y escritorio).
- **Los tres niveles del árbol de diseño**, cerrados con el usuario. Prototipos en `.scratch/ventas-pulido-ui/prototipos/`.

## Ola 5 del 19-ago-2026 — los dos últimos tickets construibles, SIN DESPLEGAR

Un solo worktree, `cierre-final`. Suite: **787 tests en 49 archivos** (venía de
725 en 46). **Migración `0028` generada y sin aplicar.**

| Ticket | Estado |
| -- | -- |
| `ventas-panel/05` — el precio del producto nativo | `resolved` |
| `ventas-capi/05` — el estado del reporte, en el panel | `resolved` |

**Con esto se acabó lo construible.** Todo lo que queda abierto espera algo que
no depende del código: credenciales de Shopify, el permiso de Meta, el token con
`ads_read`, la migración del número colombiano y el guardia de `agent_mode`.

### Lo que entró

1. **Un producto creado en el panel ya se puede vender.** Tiene precio
   (`products.price`, migración `0028`) y con precio la venta se cierra sola en
   vez de escalar. Sin precio sigue escalando, que estaba bien. **Un producto
   conectado sigue leyendo su precio de la tienda en tiempo de uso**, y ahora
   *no puede* tener uno propio: lo impide un `check` de la base, comprobado
   contra una base desechable escribiendo por SQL directo.
2. **Un producto que la tienda no conoce entra como línea suelta** —título y
   precio, sin variante— y el pedido queda marcado para logística por dos vías:
   la etiqueta buscable `producto-fuera-de-la-tienda` y una línea de la nota que
   dice **cuál** renglón es. Se descartó crear el producto en Shopify al vuelo
   (pediría `write_products`) y colgarlo de un genérico (el pedido dejaría de
   decir qué se vendió).
3. **El reporte de conversiones a Meta tiene pantalla**: Ventas → **Reporte a
   Meta** (`/reporte-meta`). Sólo lectura, no enciende nada, y no ofrece
   reintentar un `pending` viejo — a propósito, y lo dice.

### Dos cosas de esta ola que vale la pena no perder

- **La forma de `GET /api/capi/estado` es ahora un contrato compartido**
  (`@wa/shared/capi-estado.ts`), y el worker está tipado contra él. La razón no
  es ceremonia: el modo de fallar de ese tablero **es el silencio**, así que una
  pantalla leyendo un campo renombrado diría «no hay conversiones sin llegar» y
  nadie lo notaría.
- **La derivación del carrito estaba escrita dos veces** —en la llave de
  idempotencia de `sales/order.ts` y en la deduplicación de cola de
  `sales/closing.ts`— y ahora es una sola (`cartOf`). Separadas, el mismo cierre
  podía colisionar en una y no en la otra, y esa grieta se paga con un segundo
  envío contraentrega.

### Y una corrección al ticket de CAPI

Decía que hoy el estado contesta «falta el token de usuario de sistema». Medido:
contesta **«el reporte a Meta está apagado (META_CAPI_MODE sin poner)»**. El
interruptor se comprueba antes que la credencial a propósito. Faltan las dos, y
también el dataset.

## Ola final del 19-ago-2026 — cerrada. NO QUEDA NADA CONSTRUIBLE.

**37 de 44 tickets resueltos. Los 7 que quedan esperan algo que no es código.**
Migración `0028` aplicada. Suite: **787 tests en 49 archivos.**

Entraron los dos últimos: el **precio del producto nativo** —sin él, para vender
había que estar conectado a la tienda, que era matar la razón por la que la mitad
nativa existe— y **la pantalla del estado de CAPI**, que hasta ahora solo se veía
por `curl`.

El precio lo protege la base, no el código: `products_price_check` impide que un
producto **conectado** tenga precio propio, así que el suyo sigue viniendo de la
tienda en tiempo de uso y no puede desincronizarse.

## Lo único que falta, y todo depende del cliente

| Qué falta | Quién lo trae | Qué destraba |
| -- | -- | -- |
| **Token de administración de Shopify** | Vorare | `cierre-orden/01`, `03`, `04` — y con eso el pedido real |
| **Token de sistema con `ads_read`** | Vorare | `panel/03` — elegir el anuncio por su nombre |
| **Permiso `whatsapp_business_manage_events`** | Vorare | `capi/04` — verificar la conversión en Meta |
| **Configurar a Sebastián** (`display_name`) | El dueño de la operación | Que el vendedor atienda. Hoy `sales_agent_settings` está vacía **a propósito** |
| **Cargar el catálogo** | El dueño de la operación | Que haya productos que vender. `products` = 0 filas |
| **Migrar +57 304 5430173 a Cloud API** | Consola de Meta | `multi-op/08` y `09` — Colombia, **pospuesto por el usuario el 19-ago** |

**Artefacto con las dos credenciales, listo para pasarle a Vorare:**
https://claude.ai/code/artifact/d4014b57-11a2-400c-a63f-5a4c70bad9da

## Los tres interruptores, todos apagados a propósito

El camino de venta está construido de punta a punta y **no se ejecuta**, por tres
frenos independientes. Encender es un acto deliberado, no un descuido pendiente:

1. **`sales_agent_settings` vacía** → toda conversación resuelve a Katherine. El
   listón es `display_name` no vacío, no la existencia de la fila.
2. **Modo de escritura de tienda en seco** → se arma el pedido y no se manda.
3. **`META_CAPI_MODE=off`** y sin token → ni una llamada a Meta.

**Encenderlos tiene orden**: primero catálogo y vendedor, después la tienda (y
antes, un pedido desechable), y CAPI al final con el código de prueba de Meta.
Ver el riesgo R6 y R7 de `no-regresion.md`.

## Ola 4 del 19-ago-2026 — cerrada, en producción

Tres worktrees. Migraciones `0026` y `0027` aplicadas. Suite: **725 tests en 46
archivos** (venía de 597 en 38).

| Worktree | Tickets | Estado |
| -- | -- | -- |
| `datos-del-cliente` | cierre-orden **03 + 04** | abiertos: falta la tienda real |
| `matcher-semantico` | ingesta **05** | `resolved` |
| `capi-envio` | capi **03** | `resolved`, apagado |

**El camino de venta está completo de punta a punta**, y apagado a propósito en
tres lugares: sin vendedor configurado, sin credencial de tienda (modo seco), y
sin token de Meta (CAPI en `off`).

### Lo que enseñó esta ola: ejecutar encuentra lo que leer no

Los cinco hallazgos serios salieron de **correr el código**, no de revisarlo:

1. **El worker de cierres no arrancaba en producción** — pg-boss guarda la cola
   de descarte como clave foránea y hay que crearla **antes** que la que la
   referencia. Solo se veía en los logs de Railway.
2. **Un fallo de la cola se llevaba por delante la alerta al equipo** — el fallo
   se comía el mecanismo que existe para que ningún fallo se coma una venta.
3. **El reintento de CAPI no reintentaba**: reusaba la consulta del barrido, que
   salta todo pedido con fila en el libro — incluida la que su propio primer
   intento acababa de escribir. **Una conversión se perdía para siempre al primer
   fallo temporal.**
4. **El tablero de CAPI decía «no hubo pedidos»** sobre una operación que factura
   470 al mes, porque el filtro de SQL descartaba antes de contar.
5. **El modelo redactaba «tu pedido quedó registrado» por su cuenta** al recibir
   el resultado de la herramienta — mentira en modo seco. La regla que quedó es
   dura, no de prompt.

**Ninguno lo habría encontrado un typecheck ni una revisión de código.** Tres
salieron de levantar una base desechable con Docker y correr el camino entero;
dos, de mirar los logs de producción después de desplegar.

### Dos decisiones de diseño que vale la pena no perder

- **La deduplicación de una conversión va en tabla, no en la cola.** Una llave
  que vive lo que vive el job no protege algo que dura para siempre: pg-boss
  archiva a los catorce días y desde ahí el barrido reenviaría la misma venta.
- **El fallo de CAPI se parte en tres, no en dos.** El corte no es «hubo error»
  sino **si la petición llegó a salir**: «no me pude conectar» (Meta no vio nada
  → reintentar) y «me colgué esperando» (Meta puede tenerlo adentro → **no**
  reintentar) son opuestos, y contra un destino que no deduplica esa es la única
  distinción que importa.

### Tool calling: verificado, no supuesto

Antes de construir el cierre sobre tool calling se **midió contra el modelo de
producción** —por el antecedente de `reasoning_effort`, que se guarda, se lee, se
pasa y no llega al proveedor—. Resultado: las herramientas sí viajan en el cuerpo
de la petición. **El mapa decía que el agente corría «sin tool calls»; ahora las
usa, y está comprobado.**

## Ola 3 — mergeada, PENDIENTE DE DESPLIEGUE

**Migración `0026` mergeada y SIN APLICAR.** No se puede deployar el worker hasta
aplicarla: el esquema nuevo selecciona `product_recognition` de `conversations`,
y sin la columna eso **rompe el camino de entrada de todo mensaje**.

```
set -a && source .env && set +a && pnpm --filter @wa/db migrate
env -u RAILWAY_TOKEN railway up --service whatsapp-worker --ci
vercel --prod --yes
```

Tres worktrees, mergeados y verdes: **597 tests en 38 archivos**.

| Worktree | Tickets | Estado |
| -- | -- | -- |
| `reconocimiento-registrado` | ingesta **06**, panel **04**, ingesta 05 parcial | 06 y panel/04 `resolved` |
| `cierre-tienda` | cierre-orden **01+03+04+05** | 05 `resolved`; 01, 03 y 04 abiertos |
| `apoyos-visuales` | conversacion **03** | `resolved` |

### Lo más importante que entró

**El heurístico de `followup` ya no auto-confirma una venta.** Era el riesgo R1:
daba por confirmado todo pedido con un mensaje entrante posterior, y en una venta
la conversación *es* el origen — habría dejado toda venta confirmada **sin
verificar la dirección**, que en contraentrega es la causa número uno de
devolución. La decisión salió a una función pura y hay tests que fijan que **un
pedido que no viene del vendedor recorre exactamente el camino de antes**.

### El eslabón que faltaba, y lo destapó una sesión al pararse

El cierre a la tienda está construido entero **y no se puede usar todavía**:
Sebastián no tiene cómo **entregar los datos del cliente** para dispararlo. Eso
vive en `agent/runner.ts`, que era de otro worktree, y la sesión **paró y avisó**
en vez de meter mano. Es trabajo de la ola 4.

**Ojo con esto al construirlo:** el mapa dice que el agente corre hoy **sin tool
calls**, y está registrado que `reasoning_effort` **no llega al proveedor** porque
el SDK de OpenRouter descarta `providerOptions`. Antes de construir sobre tool
calling, **hay que comprobar que funciona**.

## Ola 2 del 18-ago-2026 — cerrada, en producción

Tres worktrees, siete tickets, **mergeados y desplegados**. Migración `0025`
aplicada. Suite: **489 tests en 31 archivos** (venía de 423 en 27).

| Worktree | Tickets | Estado |
| -- | -- | -- |
| `bandejas` | modulos **03 + 04**, panel **04** | 03 y 04 `resolved`; panel/04 abierto |
| `assets-0025` | panel **01 + 02 + 03** | 01 y 02 `resolved`; 03 abierto |
| `lead-nuevo` | conversacion **05** | `resolved`, no observable todavía |

**Esta vez la unión NO se rompió.** La lección de la ola 1 se aplicó antes de
repartir: mover la función de ruteo a `@wa/db` (`e4cc81b`) desde la sesión
coordinadora, porque el archivo a tocar era de otro ticket de la misma ola.

### Lo que quedó abierto, y de quién depende

- **`ventas-panel/03`** — solo le falta la lista de anuncios de Meta. Espera un
  **token de usuario de sistema con `ads_read` sobre `act_2042265076620189`**,
  que trae Vorare. Los archivos enviables ya están.
- **`ventas-panel/04`** — cinco de seis criterios. Falta distinguir «ambiguo», y
  **no es derivable**: lo destraba el ticket nuevo de abajo.

### El hallazgo de la ola, y ya tiene ticket

**`ventas-ingesta-reconocimiento/06`** — el resultado de la cascada no queda
registrado. Solo se guarda `conversations.product_id`, así que con `NULL` la base
cuenta igual tres historias distintas: *ambiguo*, *sin candidatos* y *todavía no
corrió*. Y las dos primeras piden cosas **opuestas** del asesor — desempatar
versus cargar el anuncio en el catálogo. Lo levantó el worktree `bandejas` al
chocar con el criterio, no es una idea de escritorio.

**Está debajo de `ingesta/05`**, que sigue parcial: sin registrar los candidatos,
la pregunta al lead con lista corta no tiene de dónde sacarlos.

### Verificado tras desplegar

Guatemala siguió operando durante todo: 12 mensajes salientes en 30 min con
**0 muertos**, 1.736 conversaciones con **cero sin operación**. Los dos contactos
nuevos del período tienen el agente encendido, y **no es la regla nueva**: se
crearon 01:40 y 01:52 UTC, antes de que el worker nuevo arrancara (01:53:30), y
los dos nacieron de un pedido. **La regla nueva no se ha ejecutado ni una vez**,
que es lo esperado con `sales_agent_settings` en 0 filas.

## Ola del 18-ago-2026 — cerrada, en producción

**Tres worktrees en paralelo, los tres mergeados y desplegados.** Migración
`0024` aplicada. Suite: **423 tests en 27 archivos** (venía de 334 en 22).

| Worktree | Tickets | Estado |
| -- | -- | -- |
| `selector-operacion` | multi-op **07 + 10** | ambos `resolved` |
| `catalogo` | ingesta **03** + panel **02 + 03** | ingesta 03 `resolved`; panel 02 y 03 abiertos |
| `vendedor-config` | panel **01** | abierto |

**Los tres tickets abiertos lo están a propósito**, y cada uno dice qué le falta:
panel/01 el borde del límite de descuento, panel/02 los archivos enviables, y
panel/03 esos mismos archivos **más** la lista de anuncios de Meta.

### Dos cosas que esta ola enseñó, y que valen para la próxima

1. **Dos verdes por separado se rompieron al unirse, otra vez.** `catalogo` y
   `vendedor-config` llamaban `panelOperation()` de `@wa/db`, que el ticket 07
   retiró justo al poner el selector. Ningún check local podía verlo: el
   conflicto solo existe en la unión. El arreglo no fue cosmético — reconectarlas
   a `resolvePanelOperation()` es lo que hace que el selector las afecte de
   verdad. **Al repartir, la función que un ticket retira es superficie
   compartida aunque no aparezca en ningún diff.**

2. **El ticket 10 afirmaba que `templates.operation_id` ya existía desde la
   `0022`, y era falso.** La sesión midió el esquema real en vez de creerle, y
   por eso la `0024` la agrega. Si hubiera obedecido al ticket, el `ALTER TABLE`
   habría reventado a mitad de migración **contra producción**. Es la regla de
   «el código gana» pagando por sí sola.

### Ola siguiente, ya perfilada

1. **Esquema `0025`** — `product_media` (bytes en Postgres, decidido el 18-ago) y
   `sales_agent_settings.discount_limit_behavior`. Más las pantallas que cuelgan,
   que cierran panel/01 y panel/02.
2. **`bandejas`** — `ventas-modulos-y-ruteo/03 + 04` y `ventas-panel/04`. Van
   juntos porque los tres caen en `inbox-client.tsx` (1.026 líneas), y **un
   archivo grande tiene un solo dueño por vez**.

**Sigue siendo una migración por ola.** Drizzle reescribe
`migrations/meta/_journal.json` y dos ramas que generen en paralelo chocan
siempre, sin que ningún check local lo vea.

## Qué sigue, y qué lo bloquea

**No queda nada construible, y todo está desplegado.** Los dos últimos
—`ventas-panel/05` y `ventas-capi/05`— se cerraron en la ola final, la `0028`
está aplicada, y worker y dashboard están en producción y verificados.

**Todo lo demás que queda espera algo que no depende del código.** El camino de
venta está construido de punta a punta: ingesta, atribución, reconocimiento con
sus dos niveles, persona, escalamiento, ruteo, bandeja, catálogo, apoyos
visuales, el lead nuevo llegando al agente, el cierre a la tienda con su cola de
reintentos, y el reporte de la conversión a Meta.

**Depende del usuario, no del código:**

| Qué | Bloquea |
| -- | -- |
| Decidir el guardia de `agent_mode` (`ventas-conversacion/05`) | Que Sebastián conteste a un lead nuevo. **Es la última condición del camino de venta.** |
| Credenciales de administración de Shopify | Todo `ventas-cierre-orden` |
| Permiso `whatsapp_business_manage_events` de Meta | `ventas-capi/03` y `04` |
| Migrar +57 304 5430173 a Cloud API | `ventas-multi-operacion/08`. Runbook de 5 pasos en el ticket 09. |
| Crear el dataset de CAPI de Guatemala | El envío de conversiones |
| Token de usuario de sistema con `ads_read` sobre `act_2042265076620189` | `ventas-panel/03` — sin él, el anuncio se registra a mano y no por su nombre, que es lo que se eligió |

## Trampas que ya costaron tiempo. No las redescubras.

- **El destino de una conversión CTWA no es el píxel**, es un *dataset* de la cuenta de WhatsApp. El mapa daba el píxel por verificado; configurarlo así habría mandado los eventos a un destino real pero equivocado, sin error y sin alarma.
- **`reasoning_effort` no llega al proveedor**: el SDK de OpenRouter descarta `providerOptions`. El campo se guarda, se lee, se pasa y no hace nada.
- **`contacts.agent_mode` no significa «un humano lo tomó»**: arranca en `false` y solo pasa a `true` cuando la confirmación habla. Derivar «humano» de ahí marca justo a los leads nuevos.
- **No inventes vocabulario para actos que el panel ya nombra.** «Tomar el chat» ya es *Agente: ON/OFF*; la cola de triage ya es `needsAttention`. Una ronda entera de prototipos se descartó por esto.
- **`shopify_orders.order_id` tiene único global** y el número de pedido es por tienda. No muerde hasta la segunda tienda; es del ticket 08.
- Al mergear ramas paralelas: **dos verdes por separado pueden romperse al unirse.** Pasó con un fixture al que otra rama le agregó un campo, y otra vez el 18-ago con una función *retirada*: dos ramas seguían llamando `panelOperation()` mientras una tercera lo quitaba. **Lo que un ticket elimina es superficie compartida aunque no aparezca en ningún diff** — al repartir, hay que nombrarlo igual que un archivo.

## Cómo se ha venido trabajando

Con el skill **`/tanda-de-tickets`**: esta sesión planea, mide, reparte a worktrees en paralelo y es la única que mergea y deploya. Las hijas entregan rama verde y avisan. Los encargos van en un archivo, no en el prompt.

Lo que hace que funcione: **medir antes de repartir** (las «110 referencias» del spec eran menciones del símbolo, no call sites: los reales eran 39), **repartir por superficie y no por ticket**, y **un dueño único por archivo compartido**.
