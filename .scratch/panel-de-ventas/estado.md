# Estado del Panel de Ventas — punto de entrada

**Si acabas de llegar a este proyecto con contexto fresco, lee este archivo primero.** Está al día al **18-ago-2026**.

## Lo primero, antes de tocar nada

1. **`.scratch/panel-de-ventas/no-regresion.md`** — la restricción que manda sobre todo. Guatemala factura hoy (~470 pedidos/mes, 88,4% de confirmación) y no puede cambiar de comportamiento. Si un ticket obliga a elegir entre avanzar y no tocar Guatemala, **no se toca Guatemala**.
2. **`.scratch/panel-de-ventas/map.md`** — por qué cada cosa es como es, y los términos comerciales que **no se re-litigan**.
3. El ticket que vayas a trabajar y su `spec.md`.

## Reglas de trabajo, aprendidas a golpes

- **`pnpm -r typecheck` y `pnpm --filter @wa/worker test` después de CADA ticket**, no al final. Hoy: **4 paquetes limpios, 597 tests en 38 archivos.**
- **`dropi_dry_run` está en `true` a propósito.** Confirmado intencional: es el default del esquema, está expuesto como interruptor en el panel, y `84b62c0` quitó el auto-confirm dejando el botón manual como único camino. **No lo cambies.**
- **Los tests van sobre funciones puras con fixtures**, en el estilo de `kapso/inbound.test.ts`. **Nombres en español que enuncian el comportamiento**, no la mecánica.
- **Si algo del ticket contradice el código real, para y pregunta. El código gana.** Pasó varias veces y las correcciones valieron más que los tickets.
- **El `.env` ES producción.** No hay base de desarrollo. Leer sí; escribir, solo lo autorizado.
- **No mandes mensajes a números de clientes reales.** No hay allowlist ni modo observador. No arranques el worker en local.
- **Railway:** hay un `RAILWAY_TOKEN` inválido en el entorno que tapa el login. Se ignora con `env -u RAILWAY_TOKEN`. Ver `CLAUDE.md`.

## Qué está construido y en producción

**33 de 42 tickets resueltos.** Seis migraciones aplicadas (`0020`–`0025`); la `0026` está mergeada y **sin aplicar**. Worker en Railway y dashboard en Vercel, desplegados y verificados.

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

**Se puede construir ya:**

- **`ventas-ingesta-reconocimiento/06`** — registrar el resultado de la cascada.
  Destraba `ventas-panel/04` y está debajo de `ingesta/05`. Es el candidato
  natural de la ola siguiente.
- **`ventas-ingesta-reconocimiento/05`** — parcial: falta la pregunta al lead con
  lista corta. Conviene construir el 06 antes.
- **`ventas-conversacion/03`** — envío de apoyos visuales. **Se destrabó**: la
  tabla `product_media` ya existe desde la `0025`.
- `ventas-multi-operacion/09` — migrar +57 304 5430173 a Cloud API. Runbook de 5
  pasos en el ticket; es trabajo de consola, no de código.

**El camino de venta está completo salvo el cierre.** Ingesta, atribución,
reconocimiento, persona, escalamiento, ruteo, bandeja y el lead nuevo llegando al
agente: todo construido y desplegado. Lo que falta para vender de verdad es
`ventas-cierre-orden/03` — crear el pedido en la tienda—, y **eso espera las
credenciales de administración de Shopify**.

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
