# Reconocimiento de producto: ad-id o semántico

Type: grilling
Status: resolved
Blocked by: 01

## Question

Un solo número de ventas recibe leads de muchos productos. ¿Cómo resuelve Sebastián de cuál se trata?

El PRD §6 propone una cascada de tres niveles y deja abierto cuál es el primario (§12.1):

1. Por `referral.source_id` — cada producto guarda en el panel su lista de IDs de anuncio.
2. Match semántico del LLM sobre `referral.headline` + `body` contra el catálogo.
3. Preguntarle directamente al cliente.

Decidir cuál es el primario, y con eso: qué se le pide a Vorare cargar en el panel, cuánta operativa recurrente genera eso, y qué pasa con los mensajes orgánicos que llegan sin `referral`.

## Contexto ya resuelto

*Confirmar que Kapso entrega `referral` en el webhook* está cerrado y **desbloquea este ticket**. Lo que dejó sobre la mesa:

- Kapso **documenta** que entrega `referral` con `source_id` (= ID del anuncio), `headline`, `body`, `source_url` y `ctwa_clid` en `message.received`. El nivel 1 de la cascada es viable.
- Pero la ruta exacta del campo **no está verificada**, y se comprobó que el serializador de Kapso recorta otros campos que Meta sí manda. La verificación empírica va aparte, en *Verificar `referral` con un anuncio CTWA real*.
- **`referral` solo llega en el primer mensaje.** No viene en respuestas interactivas de botón o lista. Decidir el mecanismo implica decidir también **dónde se persiste la atribución** del lead a su anuncio, porque después no se puede recuperar.
- Si el campo se recorta, existe salida por webhook `kind: "meta"` (passthrough del payload de Meta), con sus costos: no se puede cambiar el `kind` de un webhook existente, uno por número, y la firma HMAC en ese modo no está documentada.

Con esto, la decisión ya no es "¿se puede usar el ad-id?" sino **"¿el ad-id vale la operativa recurrente de cargar los IDs cada vez que Vorare lanza un anuncio, o el match semántico alcanza?"** — y eso conecta con la niebla del mapa sobre quién carga esos IDs y si cabe en "mantener".

## Answer

**Cascada fija de tres niveles, con el ID de anuncio como primario.** La decisión no la ganó la escala: la ganó la ambigüedad.

### El dato que decidió

Consulta de solo lectura a producción (15-ago-2026): 1.640 pedidos en 3,5 meses, **17 productos**, con *REVITALHAIR – DHT ANTICALVICIE* en el **77%** del volumen y los tres primeros sumando el **96%**.

Con 17 productos, cargar IDs de anuncio a mano es trabajo de una tarde — la escala nunca fue el problema. El problema es que Vorare vende **cuatro SKUs de nombre casi idéntico** (*DHT ANTICALVICIE*, *DHT BLOCKER ANTICALVICIE*, *COMBO DHT + SERUM 360*, *Hair Recovery 3X*), y el match semántico sobre el copy del anuncio no los distingue con confianza. Es exactamente donde está el 77% del volumen. El PRD lo intuía; el catálogo lo confirma.

### Mecanismo

1. **`referral.source_id` → conjunto de productos del anuncio.** La relación anuncio→producto es **N:M**. Si el conjunto tiene un producto, queda resuelto; si tiene varios, se pasa al paso 3 con la lista corta *de ese anuncio*.
2. **Match semántico** sobre `headline` + `body` solo cuando el `source_id` no está registrado. **Nunca desempata entre nombres casi idénticos**: si la confianza es baja, cae al paso 3 en vez de adivinar.
3. **Preguntar**, con lista corta. Tras **dos intentos** sin producto identificado, escala a humano — un vendedor que sigue vendiendo sin saber qué vende es peor que uno que pide ayuda.

### Decisiones de soporte

- **Atribución persistida en el primer contacto.** `referral` solo llega en el primer mensaje, nunca en respuestas de botón o lista. Si no se guarda ahí, se pierde.
- **Cascada fija, sin perillas.** Vorare configura únicamente el catálogo y el mapeo anuncio→productos. No se puede prender, apagar ni reordenar niveles, ni tocar umbrales del match semántico. Cada perilla es superficie de falla y soporte no cotizado a precio fijo.
- **No se introduce el concepto de "familia" de productos.** Se verificó que los cuatro REVITALHAIR son **cuatro `product_id` distintos en Shopify, sin variantes**. En vez de agrupar con un concepto nuevo, la agrupación la expresa el mapeo N:M: el anuncio de la familia mapea a los cuatro y el paso 3 pregunta cuál. Los productos quedan 1:1 con Shopify — sin schema nuevo y sin reestructurar el catálogo de Vorare.
- **Los IDs de anuncio los carga Vorare** desde el panel, con la interacción más barata posible (pegar el ID desde el Ads Manager). Va en el documento como responsabilidad del cliente: es Vorare quien lanza campañas, y absorber eso convertiría cada lanzamiento suyo en trabajo no cotizado.

### Promesa para el documento

> Identifica el producto automáticamente cuando el anuncio está registrado; cuando no, pregunta con una lista corta antes de seguir.

No promete acertar siempre. Alimenta *Criterios de aceptación del alcance*.
