# Disparador del handoff a Katherine

Type: grilling
Status: resolved
Blocked by: —

## Question

Sebastián cierra la venta y crea la orden en Shopify. ¿Cómo llega ese pedido al flujo de Katherine? (PRD §12.2)

Dos caminos: Katherine jala el pedido por el mismo camino que ya usa hoy, o el Panel de Ventas se lo entrega directo.

Hecho verificado que condiciona la respuesta: el worker **no crea** pedidos en Dropi — solo los lista y los confirma. La guía nace de una integración Shopify↔Dropi ajena a WaiChat. Entre "orden creada en Shopify" y "Katherine tiene algo que rastrear" hay entonces un paso que no controlamos, y el documento tiene que describirlo sin prometerlo.

Decidir también: el primer toque de Katherine cae fuera de la ventana de 24 h, así que va con plantilla. ¿Cuál plantilla, y hay que crearla y aprobarla?

## Answer

**El handoff no necesita código nuevo: entra por el camino que ya existe.**

### Lo verificado

`apps/worker/src/routes/shopify.ts` ya recibe el webhook de Shopify con validación HMAC, hace un insert idempotente por `order_id` y agenda followup (5 min por defecto) más remarketing (3 h). Cuando Sebastián cree la orden por la Admin API, **Shopify dispara ese mismo webhook y el pipeline de Katherine la recoge sola**. Se responde el §12.2 del PRD con su propia recomendación: por el camino que ya usan, sin duplicar lógica.

### Lo que sí se decidió

**Katherine trata distinto los pedidos de Sebastián.** Los pedidos con tag `waichat-ventas` disparan una **plantilla diferente**, que reconoce la conversación previa y se enfoca en verificar los datos de envío — del tipo *"recibimos tu pedido, verifico los datos de envío"*.

El razonamiento: dejarlo idéntico a hoy le pide al cliente que confirme lo que acaba de confirmar comprando, y el sistema se ve roto. Pero **saltarse la confirmación entera no es opción**: es donde se valida la dirección, y en contraentrega ahí es donde se caen las entregas. La plantilla distinta conserva la validación y elimina la redundancia.

**El followup de pedidos de ventas sale a los 10 minutos**, no a los 5 de hoy.

### Dependencias que esto crea

- **Plantilla nueva, aprobada por Meta.** El primer toque cae fuera de la ventana de 24 h, así que es plantilla y hay que crearla y pasarla por aprobación. Es camino crítico: la aprobación de Meta no la controlamos.
- **El delay de 10 minutos necesita separarse del actual.** Hoy `followupDelayMs` es un campo único en la fila única de `agent_settings`; un tiempo distinto para pedidos de ventas es un campo aparte o lógica por origen del pedido.
- **Un mismo cliente tendrá dos hilos en dos números.** Sebastián en el de ventas, Katherine en el de confirmación, misma persona. El asesor lo verá en dos lugares. Sumado a que `kapso_connection` es fila única, esto confirma que el segundo número toca el modelo de datos.

Alimenta *Criterios de aceptación del alcance* y *Fases y cronograma del documento* — la aprobación de la plantilla tiene que caber en alguna fase.
