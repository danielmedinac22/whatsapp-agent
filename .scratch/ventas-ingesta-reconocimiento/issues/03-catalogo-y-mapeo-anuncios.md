# 03 — Catálogo y mapeo anuncio→productos

**What to build:** El admin puede crear un producto y asociarle uno o varios identificadores de anuncio. Un mismo anuncio puede apuntar a varios productos, para que los anuncios de familia o de combo funcionen sin inventar productos falsos.

Es el mínimo de catálogo que el reconocimiento necesita para existir. La experiencia completa de catálogo vive en el spec del Panel de Ventas.

**Blocked by:** None — can start immediately.

**Status:** claimed — worktree `catalogo`, ola del 18-ago-2026

- [ ] Existe la entidad producto del panel, con su origen declarado: conectado a la tienda o nativo.
- [ ] La relación anuncio→productos es de muchos a muchos en ambos sentidos.
- [ ] El admin puede crear un producto y asociarle identificadores de anuncio sin editar la base a mano.
- [ ] Asociar el mismo anuncio a varios productos funciona y queda consultable como conjunto.
- [ ] No se introduce ningún concepto de familia o agrupación de productos: la agrupación la expresa el mapeo.
- [ ] Los productos quedan uno a uno con los de la tienda; no se reestructura el catálogo del cliente.

## Answer — esquema puesto por la `0022` (17-ago-2026), la funcionalidad sigue abierta

El worktree `esquema-0022` dejó las dos tablas aplicadas en producción y vacías. **Este ticket no genera migración**: construye encima de esto.

### `products` — el catálogo, por operación

| columna | tipo | notas |
| -- | -- | -- |
| `id` | uuid pk | |
| `operation_id` | uuid **NOT NULL** → `operations` (`restrict`) | un producto guatemalteco no aparece en el catálogo colombiano |
| `source` | enum `product_source`: `shopify` \| `native` | el origen declarado |
| `shopify_product_id` | text, nullable | GID de Shopify (`gid://shopify/Product/NNN`, lo que devuelve `ShopifyProduct.id`; `getProductsByIds` acepta también el numérico). **Obligatorio si `source = 'shopify'`, nulo si `native`** |
| `name` | text, nullable | **obligatorio si `native`**; para los conectados va nulo: el nombre se lee de la tienda en tiempo de uso, no se copia |
| `description` | text, nullable | idem: solo los nativos la guardan aquí |
| `created_at`, `updated_at` | timestamptz | |

Restricciones: `products_source_check` hace cumplir en la base que cada origen traiga lo suyo (`native` → `name` no nulo y sin id de tienda; `shopify` → id de tienda no nulo). Único parcial `products_operation_shopify_idx (operation_id, shopify_product_id) where shopify_product_id is not null`: **uno a uno con la tienda**, el mismo producto no se conecta dos veces en la misma operación. Restricción única `products_operation_id_unique (operation_id, id)`: destino de la FK compuesta de abajo, y de paso el índice para listar el catálogo por operación.

**Por qué `name` es nullable y no `NOT NULL`:** el ticket del panel (`ventas-panel/02`) exige que un producto conectado *no copie* su información — «editarlo allá se refleja acá, sin desincronización silenciosa». Un `name NOT NULL` habría obligado a copiar el título. Nullable deja la puerta abierta a cumplirlo; quien construya puede igual decidir cachear en memoria (`getProductsByIds` ya cachea 10 minutos por operación).

### `product_ads` — anuncio→productos, N:M en ambos sentidos

| columna | tipo | notas |
| -- | -- | -- |
| `operation_id` | uuid **NOT NULL** → `operations` (`restrict`) | |
| `product_id` | uuid **NOT NULL** | |
| `ad_id` | text **NOT NULL** | el identificador del anuncio de Meta, tal como llega en `referral.source_id`; es lo que el admin pega |
| `created_at` | timestamptz | |

PK `(product_id, ad_id)`. Índice `product_ads_operation_ad_idx (operation_id, ad_id)` — la consulta del nivel 1 de la cascada es `where operation_id = ? and ad_id = ?` y devuelve el **conjunto** de productos. **FK compuesta `(operation_id, product_id) → products (operation_id, id)` con `cascade`**: un mapeo no puede apuntar a un producto de otra operación aunque el código se equivoque, y borrar el producto se lleva sus mapeos.

**El anuncio no tiene entidad propia**: es su id. No hay tabla `ads`, no hay concepto de familia ni de agrupación — la agrupación la expresa este mapeo, como pide el ticket. Si algún día hace falta un rótulo por anuncio, es una columna más aquí o una tabla nueva, con dueño.

### También quedó, y lo usa el ticket 04 de este mismo lote

`conversations.product_id` (uuid nullable → `products`, `set null`): el producto que la cascada resolvió para la conversación —por id de anuncio, por match semántico o preguntando— para que una respuesta de botón, que no trae referencia, siga sabiendo de qué producto se habla. La sesión de `reconocimiento-cascada` (ticket 04, «la persistencia espera al esquema `0022`») escribe ahí.

### En `@wa/db`

Exporta `products`, `productAds`, `productSource` y los tipos `Product`, `NewProduct`, `ProductAd`, `NewProductAd`. **No hay accesor escrito**: eso es de este ticket. Sugerencia: el patrón de `packages/db/src/agent-settings.ts` — traer filas y resolver por operación en memoria con una función pura probable.

### Deliberadamente fuera de la `0022`

- **Assets enviables** (imágenes, videos, «marcado como enviable»): los piden `ventas-panel/02-03` y `ventas-conversacion/03`, que no son de esta ola, y su forma depende de dónde vivan los binarios (`message_media` guarda bytes en Postgres con una nota de «si deja de ser aceptable, esto se muda a S3/R2» — un video de 16 MB por producto es exactamente ese caso). Decisión con dueño, no un default mío.
- **Precio de producto nativo** y **archivado/estado** del producto: ningún ticket de la ola los pide. Cuando hagan falta son una columna nullable más.

### Verificado en producción tras aplicar

`products` 0 filas · `product_ads` 0 filas · `product_source` = `[shopify, native]` · las restricciones y los índices de arriba existen con esos nombres. Nada de lo existente cambió (ver el `## Answer` del ticket 01 de multi-operación para el patrón de verificación; los números están en el commit de la `0022`).

## Answer — repartido con el catálogo del panel (18-ago-2026, sesión coordinadora)

Va en el worktree **`catalogo`**, junto a `ventas-panel/02` y `ventas-panel/03`.
No es agrupación por tema: los tres caen en la misma pantalla y en el mismo
accesor. Repartirlos por ticket habría puesto a tres sesiones a escribir
`packages/db/src/products.ts` a la vez.

**Este ticket es el que sí se cierra en esta ola.** Es el mínimo que el
reconocimiento necesita: el accesor sobre `products` y `product_ads` —que la
`0022` ya dejó aplicadas y vacías— y el alta de producto con sus anuncios sin
tocar la base a mano. Los otros dos quedan abiertos por dependencias ajenas
(archivos enviables → migración `0025` de la ola siguiente; lista de anuncios de
Meta → credencial que trae Vorare).

**No genera migración**, como ya decía el ticket. Y esta ola tiene una sola
migración asignada, la `0024`, que es de otro worktree.

Medido en producción el 18-ago-2026: `products` = **0 filas**, `product_ads` =
**0 filas**. El catálogo arranca vacío, así que no hay backfill ni datos que
respetar — pero tampoco hay nada contra qué ver la pantalla llena. **La prueba
válida es el estado cargado**, y el hallazgo del nivel 1 del árbol de diseño
aplica igual acá: el estado fácil aprueba por la razón equivocada.
