# 03 — Catálogo y mapeo anuncio→productos

**What to build:** El admin puede crear un producto y asociarle uno o varios identificadores de anuncio. Un mismo anuncio puede apuntar a varios productos, para que los anuncios de familia o de combo funcionen sin inventar productos falsos.

Es el mínimo de catálogo que el reconocimiento necesita para existir. La experiencia completa de catálogo vive en el spec del Panel de Ventas.

**Blocked by:** None — can start immediately.

**Status:** resolved — worktree `catalogo`, ola del 18-ago-2026 · rama `danielmedinac22/catalogo`, sin merge ni deploy

- [x] Existe la entidad producto del panel, con su origen declarado: conectado a la tienda o nativo.
- [x] La relación anuncio→productos es de muchos a muchos en ambos sentidos.
- [x] El admin puede crear un producto y asociarle identificadores de anuncio sin editar la base a mano.
- [x] Asociar el mismo anuncio a varios productos funciona y queda consultable como conjunto.
- [x] No se introduce ningún concepto de familia o agrupación de productos: la agrupación la expresa el mapeo.
- [x] Los productos quedan uno a uno con los de la tienda; no se reestructura el catálogo del cliente.

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

## Answer — construido (18-ago-2026, worktree `catalogo`)

**El catálogo existe y se usa desde el panel.** El admin entra a `/catalogo`,
crea un producto o conecta uno de la tienda, y le pega los identificadores de
sus anuncios. Nadie toca la base a mano.

### Lo que quedó

- **Un accesor único** (`packages/db/src/products.ts`), en `@wa/db` y no en el
  panel, por lo mismo que sus dos hermanos: el panel escribe el catálogo y el
  worker lo lee, y un accesor por aplicación es la forma de que las dos mitades
  del mismo módulo se desincronicen.
- **La regla de aislamiento, pura y probada**, con la misma forma que
  `resolveAgentSettings` y `resolveSalesAgentSettings`: pedir el catálogo de una
  operación que no tiene productos devuelve la lista vacía, **nunca la de otra**.
  Y su versión por id: pedir un producto ajeno devuelve `null` aunque alguien
  escriba el uuid a mano.
- **La pantalla**: tabla densa con el origen como columna, buscar por nombre o
  por id de anuncio, filtrar con chips removibles, ordenar, columnas
  conmutables, total y estado del filtro al pie, y selección múltiple.
- **El registro de anuncios**, con el N:M visible en los dos sentidos.

### Lo que se probó, y contra qué

Los tests de las funciones puras están en
`apps/worker/src/sales/catalog-accessor.test.ts` (31 casos). Pero **el estado
vacío aprueba por la razón equivocada**, así que lo que decide fue el ensayo
contra una base cargada con el catálogo real —los tres REVITALHAIR casi
idénticos y un producto colombiano con el mismo nombre—: 36 comprobaciones sobre
el accesor y la pantalla completa levantada contra esa base.

Ahí se vio lo que ningún test verde iba a mostrar:

- El mismo id de anuncio registrado en Guatemala y en Colombia resuelve, en cada
  panel, **solo al producto propio**.
- El anuncio de familia devuelve **el conjunto** de sus productos, que es lo que
  deja a la cascada quedar ambigua en vez de elegir sobre el 77% del volumen.
- Asociar desde el panel guatemalteco un producto colombiano lo **descarta y lo
  informa**, en vez de reventar la transacción entera; y editarlo o borrarlo
  responde «el producto no existe en esta operación».
- Registrar dos veces el mismo par no es error y no duplica la fila — el admin
  acaba de pegar el mismo id.
- El pegado con espacios y saltos de línea **encuentra igual** su mapeo. Un id
  que no encuentra el suyo se ve idéntico a un anuncio sin registrar.

### Un fallo que el ensayo destapó, y que el typecheck no podía ver

La señal de «llegaron N clics de anuncios registrados» estaba escrita con una
subconsulta correlacionada dentro del `select`. Drizzle escribe ahí las columnas
**sin calificar la tabla**, así que `pa.ad_id = ad_id` se resolvía contra la
propia `product_ads` —o sea `pa.ad_id = pa.ad_id`— y **contaba todos los clics
como reconocidos**. Es exactamente el modo de falla que esa señal existe para
impedir: se veía sana estando rota. Está reescrita con `join` y
`count(distinct)`, y el ensayo lo verifica con un clic registrado y uno que no.

### Lo que este ticket **no** cierra, y vive en `ventas-panel/02` y `03`

Los archivos enviables (migración `0025`, ola siguiente) y la lista de anuncios
leída de Meta (falta la credencial). El registro por campo a mano —que es lo que
este ticket pedía— funciona sin ninguna de las dos.
