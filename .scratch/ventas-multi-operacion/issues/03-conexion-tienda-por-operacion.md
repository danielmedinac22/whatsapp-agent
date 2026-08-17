# 03 — La conexión de la tienda cuelga de la operación

**What to build:** Cada operación tiene su propia tienda, y toda lectura o escritura contra ella pasa por la operación de la conversación. Un pedido de una operación no puede tocar la tienda de otra.

Segundo lote: dieciséis referencias.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] La conexión de la tienda declara a qué operación pertenece.
- [ ] Las lecturas de productos se hacen contra la tienda de la operación indicada.
- [ ] El webhook de pedidos entrantes atribuye el pedido a la operación correcta.
- [ ] Los dieciséis llamadores existentes pasan a resolver por operación.
- [ ] El comportamiento de la operación de Guatemala no cambia.

**Nota:** la tabla de conexión **está vacía hoy**. Los pedidos entran por webhook con secreto de entorno, no por ella. Configurarla es prerequisito aparte — ver el ticket de conexión de administración en el spec de cierre.

## Medido contra el código (16-ago-2026)

**«Dieciséis referencias» eran menciones del símbolo, no llamadas.** Los call sites reales de `getShopifyConnection()` son **dos**, en dos archivos:

`shopify/admin.ts` (donde vive, línea 18) · `agent/shopify-context.ts`

Y `shopify_connection` tiene **cero filas en producción**, así que hoy el accesor devuelve `null` en ambos y toda lectura de productos ya está apagada. Este lote es, en la práctica, un no-op verificable: se parametriza el accesor, se pasa la operación desde los dos llamadores, y no cambia nada porque no había nada que cambiar.

Por eso va junto con el ticket 02 en el mismo worktree en vez de ocupar uno propio.

**El criterio «el webhook de pedidos entrantes atribuye el pedido a la operación correcta» es el único con sustancia.** Ese webhook (`routes/shopify.ts`) no usa `shopify_connection` — se autentica con un secreto de entorno, que es global y no tiene de dónde sacar la operación. Con una sola operación existente, atribuir a Guatemala es correcto y suficiente; **resolver la operación de un pedido web por su tienda de origen es trabajo del ticket 08**, cuando exista una segunda tienda que distinguir. Déjalo atribuyendo a la operación única y documenta el supuesto — no inventes un mecanismo de resolución que no se puede probar con una sola tienda.

El accesor cachea 30 segundos en variable de módulo (`shopify/admin.ts:15`), igual que el de Kapso: esa caché tiene que quedar indexada por operación o desaparecer.
