# 08 — Crear la operación de Colombia

**What to build:** Colombia existe como segunda operación, con su número, su tienda, su logística, su moneda y su catálogo — y Guatemala sigue funcionando exactamente igual.

Es el ticket que demuestra que todo el trabajo anterior sirvió.

**Blocked by:** 07 · 09 · Migrar el número de Colombia a Cloud API

**Status:** ready-for-agent

- [ ] La operación de Colombia queda creada, con pesos colombianos como moneda.
- [ ] Su número de WhatsApp —**+57 304 5430173, ya existente y migrado a Cloud API**— queda conectado y los mensajes que llegan por él resuelven a Colombia.
- [ ] Queda claro que la **cuenta publicitaria opera en pesos** mientras Guatemala factura en quetzales, para que ningún cálculo de retorno cruce monedas sin darse cuenta.
- [ ] Su tienda queda conectada y los pedidos se crean ahí, no en la de Guatemala.
- [ ] Su lista de ciudades y divisiones administrativas es la de Colombia.
- [ ] **Un mensaje a Guatemala y uno a Colombia, en paralelo, no se contaminan** en catálogo, configuración ni tienda destino.
- [ ] La operación de Guatemala no sufre ninguna regresión.

## Dos cosas que dejó el contract (ticket 06, cerrado el 16-ago-2026)

**El ticket 07 pasó de recomendable a bloqueante duro.** El contract dejó el panel usando `panelOperation()`, un puente que **lanza con dos operaciones activas** en vez de resolver a `id = 1`. Es deliberado —fallar ruidosamente antes que editar el país equivocado en silencio— pero tiene una consecuencia concreta: **ocho pantallas del panel dejan de funcionar el día que Colombia se ponga `active`**. El selector de operación tiene que estar antes. Sin excepción y sin atajos.

Mitigación mientras tanto: crear Colombia en estado `inactive` no rompe nada. `status` existe desde el ticket 01 justamente para eso.

**La atribución del pedido web es tuya, y trae un bug latente que se decidió no arreglar antes de tiempo.**

`shopify_orders.order_id` tiene un **único global**, y el número de pedido de Shopify es **por tienda**: dos tiendas pueden emitir el mismo número. Es exactamente el mismo defecto que el contract sí arregló en `dropi_orders` —donde el único pasó a ser `(operación, id)`—, en la tabla que decidió no tocar.

No muerde hasta que exista la segunda tienda. Y se dejó aquí a propósito, no por descuido: **arreglarlo exige saber de qué tienda vino el pedido**, que es justo lo que este ticket tiene que resolver. Hacerlo antes habría sido elegir a ciegas.

Contexto de por qué la columna no está: el lote de la tienda (ticket 03) argumentó que `shopify_orders` no necesita `operation_id` porque la atribución vive en la conversación del pedido, y el contract le dio la razón con este criterio — **el sondeo de logística siempre sabe de qué cuenta de Dropi vienen los pedidos; el webhook de la tienda no puede saber de qué tienda viene hasta que haya dos**. Cuando este ticket conecte la segunda tienda, revisa las dos cosas juntas: la columna y el único.
