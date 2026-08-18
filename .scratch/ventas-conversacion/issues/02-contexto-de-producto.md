# 02 — Conversa con el contexto del producto

**What to build:** Sebastián responde sabiendo de qué producto le hablan: su descripción, sus especificaciones y qué archivos tiene disponibles. El lead puede preguntar por características concretas y obtener respuesta sin que nadie le pida que aclare qué producto es.

**Blocked by:** 01 · ventas-ingesta-reconocimiento 04 · Reconocimiento por ID de anuncio

**Status:** resolved — worktree `sebastian-persona`, 17-ago-2026

- [x] El contexto del producto identificado se arma como bloque y se compone en el prompt efectivo, igual que ya se hace con los contextos existentes.
- [x] Un producto conectado a la tienda toma su información **en tiempo de uso**, no copiada — editar el producto en la tienda se refleja en la siguiente conversación.
- [x] Un producto nativo toma su información del panel.
- [x] Mientras el producto no esté identificado, Sebastián conversa sin contexto de producto y sin inventarlo.
- [x] Los tests cubren el prompt efectivo con producto identificado y sin él.

## Answer — el bloque de producto (17-ago-2026, worktree `sebastian-persona`)

`apps/worker/src/sales/product-context.ts`. **No se inventó mecanismo**: es el mismo patrón de `agent/shopify-context.ts` y `agent/dropi-context.ts` —una función que devuelve un bloque de texto o `null`, y el constructor de prompt efectivo lo compone—, para otro agente y otra pregunta. Los de Katherine hablan del pedido que el cliente **ya hizo**; este habla del producto que **todavía no compró**.

### Las dos fuentes

- **Conectado a la tienda** (`source = 'shopify'`): se lee con `getProductsByIds(op, [...])`, el mismo accesor que ya usa el bloque de postventa, con su caché de diez minutos indexada por operación. **En tiempo de uso, nunca de una copia**: editar el producto en Shopify se refleja en la conversación siguiente sin que nadie sincronice nada.
- **Nativo** (`source = 'native'`): sale de la fila de `products`, que es lo que el panel llena. Sin precio ni presentaciones — la `0022` le dio a la tabla el mínimo que el reconocimiento necesitaba (nombre y descripción), y un precio nativo es una columna que todavía no existe, no un dato que este módulo pueda deducir.

### Los dos casos en que **no** hay bloque

1. **Sin producto identificado** (`conversations.product_id` en `null`): se devuelve `null` y Sebastián conversa sin ficha. Es lo que hace verdadera la frase del ticket; el prompt conserva la regla dura de no inventar características, precios ni disponibilidad.
2. **Producto de tienda que la tienda no devuelve** (sin conexión, o caída): también `null`. `products.name` puede tener una copia del nombre y usarla sería justo la información copiada que «en tiempo de uso» descarta. La dirección segura del error es conversar sin ficha, no con una vieja.

Y un tercero que es de aislamiento: si el `product_id` de la conversación pertenece a **otra operación**, no hay bloque y queda un `warn`. La clave foránea compuesta de `product_ads` ya impide cruzar operaciones por el lado del anuncio; esto cierra el lado de la conversación, que es una columna suelta sin esa garantía.

### Lo que este bloque **no** trae

Los **archivos enviables**. No existe tabla de archivos de producto —la `0022` no la creó— y el envío de apoyos visuales es el ticket 03, bloqueado por esquema. Cuando exista, es una sección más de este bloque y no un mecanismo nuevo.

### Tests

`sales/product-context.test.ts` (8) sobre las partes puras —render, traducción desde la tienda, traducción desde el panel— y `agent/effective-prompt.test.ts` sobre el prompt efectivo **con** producto identificado y **sin** él. No se prueba la lectura contra Shopify: eso es red, y el borde ya está partido para no tener que fingirla.
