# 03 — La conexión de la tienda cuelga de la operación

**What to build:** Cada operación tiene su propia tienda, y toda lectura o escritura contra ella pasa por la operación de la conversación. Un pedido de una operación no puede tocar la tienda de otra.

Segundo lote: dieciséis referencias.

**Blocked by:** 01

**Status:** resolved — worktree `op-02-03-kapso-shopify`, tanda del 16-ago-2026

- [x] La conexión de la tienda declara a qué operación pertenece.
- [x] Las lecturas de productos se hacen contra la tienda de la operación indicada.
- [x] El webhook de pedidos entrantes atribuye el pedido a la operación correcta.
- [x] Los dieciséis llamadores existentes pasan a resolver por operación. *(eran dos)*
- [x] El comportamiento de la operación de Guatemala no cambia.

**Nota:** la tabla de conexión **está vacía hoy**. Los pedidos entran por webhook con secreto de entorno, no por ella. Configurarla es prerequisito aparte — ver el ticket de conexión de administración en el spec de cierre.

## Medido contra el código (16-ago-2026)

**«Dieciséis referencias» eran menciones del símbolo, no llamadas.** Los call sites reales de `getShopifyConnection()` son **dos**, en dos archivos:

`shopify/admin.ts` (donde vive, línea 18) · `agent/shopify-context.ts`

Y `shopify_connection` tiene **cero filas en producción**, así que hoy el accesor devuelve `null` en ambos y toda lectura de productos ya está apagada. Este lote es, en la práctica, un no-op verificable: se parametriza el accesor, se pasa la operación desde los dos llamadores, y no cambia nada porque no había nada que cambiar.

Por eso va junto con el ticket 02 en el mismo worktree en vez de ocupar uno propio.

**El criterio «el webhook de pedidos entrantes atribuye el pedido a la operación correcta» es el único con sustancia.** Ese webhook (`routes/shopify.ts`) no usa `shopify_connection` — se autentica con un secreto de entorno, que es global y no tiene de dónde sacar la operación. Con una sola operación existente, atribuir a Guatemala es correcto y suficiente; **resolver la operación de un pedido web por su tienda de origen es trabajo del ticket 08**, cuando exista una segunda tienda que distinguir. Déjalo atribuyendo a la operación única y documenta el supuesto — no inventes un mecanismo de resolución que no se puede probar con una sola tienda.

El accesor cachea 30 segundos en variable de módulo (`shopify/admin.ts:15`), igual que el de Kapso: esa caché tiene que quedar indexada por operación o desaparecer.

## Answer

Se confirma la medición: **dos llamadores, tabla vacía**. El lote es un no-op de
comportamiento, así que el trabajo real fue dejar la forma correcta. Copia la del ticket 02
—mismo parámetro `operationId: OperationRef`, misma caché por operación— con **una
diferencia deliberada** y **un hallazgo que no estaba en el ticket**.

### La diferencia con WhatsApp: aquí no hay red

`getShopifyConnection(operationId)` es **estricta y no tiene versión con red**, mientras
que la conexión de WhatsApp sí (`resolveKapsoConnection`). No es un descuido:

> Quedarse sin conexión de WhatsApp **calla la operación** — R3, «deja de salir todo
> mensaje» — así que ahí la tolerancia se paga. Quedarse sin tienda solo **apaga la lectura
> de productos**, que es literalmente lo que hace hoy con la tabla vacía. En cambio, que un
> pedido de una operación toque la tienda de otra sí es daño real: precios y stock de otro
> país en el prompt del agente.

La regla para los otros lotes: **la red solo se pone donde no tenerla rompe la operación.**
Para logística —donde perder la conexión frena las confirmaciones— la respuesta se parece
más a la de WhatsApp que a esta.

### El hallazgo: la caché de producto también filtraba entre operaciones

El ticket señalaba la caché de conexión (`shopify/admin.ts:15`). Hay **una segunda**, de 10
minutos, que no estaba en el ticket: `productCache`, indexada por el GID del producto. Los
ids de producto de Shopify son **por tienda** — dos tiendas pueden tener el producto
`12345`. Sin la operación en la clave, el producto de una operación habría respondido por el
de la otra: catálogo equivocado en el prompt, sin error ni fallo visible. Es el mismo error
silencioso que el ticket 02 buscaba en la caché de conexión, un piso más abajo. Ahora la
clave es `${operación}:${gid}`.

**Para los otros dos lotes: la caché de conexión no es la única.** Vale la pena buscar toda
caché indexada por un id que sea único *dentro de* una operación y no entre operaciones.

### El webhook de pedidos

`routes/shopify.ts` se autentica con un secreto de entorno global y la carga útil no trae
identidad de tienda: **no hay de dónde resolver la operación**. Se atribuye a la operación
única vía `getSingleOperationId()`, escrita en la conversación que el pedido crea. Con dos
operaciones esa función devuelve `null` y el pedido queda **sin atribuir** en vez de
atribuido al país equivocado. Resolver por tienda de origen exige una segunda tienda que
distinguir y es del ticket 08 — no se inventó aquí un mecanismo que no se puede probar.

**`shopify_orders` no tiene columna `operation_id`** y **no se generó ninguna migración**:
la atribución vive en la conversación del pedido, que sí la tiene. Si el ticket 08 necesita
la operación en la fila del pedido, esa columna le toca a él.

### Los llamadores

| Llamador | Qué operación pide |
| -- | -- |
| `shopify/admin.ts` → `getProductsByIds(operationId, ids)` | la que le pasen |
| `agent/shopify-context.ts` → `buildShopifyContextBlock(contactId)` | **la resuelve sola**, de la conversación del contacto |
| `routes/shopify-connection.ts` (PUT) | etiqueta la fila con la operación única al escribir; el DELETE invalida la caché entera |
| `routes/shopify.ts` (webhook de pedidos) | la operación única |

`buildShopifyContextBlock` **no recibe la operación por parámetro** aunque era lo obvio.
Dos razones: quien arma el prompt (`agent/runner.ts`) no tiene por qué saber de operaciones,
y así ningún llamador puede olvidarse de pasarla. Efecto lateral buscado: **`agent/runner.ts`
quedó sin tocar**, que es un archivo que el worktree de configuración de agente también
edita.

En `getProductsByIds(operationId, ids)` la operación va **primero**. Convención del lote:
*la operación va primero*.

### Qué se descartó

- **Una versión con red de `getShopifyConnection()`** — arriba, con su razón.
- **Poner `operation_id` en `shopify_orders`** — habría necesitado migración, y el encargo
  la prohíbe. La conversación ya lo resuelve.
- **Inventar la resolución del pedido por tienda de origen** — no se puede probar con una
  sola tienda. Es del 08.
- **Hacer que el GET de `/connection` pasara por el accesor** — es una vista de
  administración de la fila singleton, no un llamador del accesor. Cambiarla es del contract.

### Cómo se comprobó que Guatemala no cambia

`shopify_connection` tiene **cero filas**, así que los dos llamadores devolvían `null` antes
y devuelven `null` ahora, por dos caminos distintos que llegan al mismo sitio:

- operación `null` → `where(id = 1)` → sin filas → `null`. Idéntico a antes.
- operación de Guatemala → `where(operation_id = …)` → sin filas → `null`.

`buildShopifyContextBlock` corta en `if (!conn?.shopDomain …) return null` en ambos, o sea
que el prompt del agente sale exactamente igual. `pnpm -r typecheck` limpio en los 4
paquetes y `pnpm --filter @wa/worker test` en 60 (los 41 previos sin modificar).

**No se ejecutó ninguna consulta en vivo contra producción** — el classifier de permisos
bloqueó `source .env && npx tsx`. El «cero filas» viene de lo medido en el ticket; el
razonamiento de arriba no depende de ello: con filas o sin filas, la operación única lee la
misma fila `id = 1` que leía antes.

### Qué queda abierto

- Configurar la tienda sigue siendo prerequisito aparte (R6: al configurarla se le da
  capacidad de crear pedidos reales). Cuando se configure, la fila queda etiquetada con la
  operación única automáticamente.
- Elegir operación desde el panel al configurar la tienda: contract.
- Atribuir el pedido web por tienda de origen: ticket 08.
