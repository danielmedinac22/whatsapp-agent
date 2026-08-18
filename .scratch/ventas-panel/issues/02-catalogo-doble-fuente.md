# 02 — Catálogo de doble fuente

**What to build:** El admin arma su catálogo de dos maneras: conectando un producto que ya existe en la tienda —de donde se lee toda su información, sin volver a escribirla— o creando uno nativo con nombre, descripción, imágenes y adjuntos para vender algo que aún no está en la tienda.

**Blocked by:** ventas-ingesta-reconocimiento 03 · Catálogo y mapeo anuncio→productos

**Status:** claimed — worktree `catalogo`, ola del 18-ago-2026

- [ ] El admin puede buscar y conectar un producto existente de la tienda.
- [ ] **Un producto conectado lee su información de la tienda en tiempo de uso, no la copia** — editarlo allá se refleja acá, sin desincronización silenciosa.
- [ ] El admin puede crear un producto nativo con nombre, descripción, imágenes y adjuntos.
- [ ] El panel no escribe sobre los productos de la tienda: los lee.
- [ ] **Un video que excede el límite de tamaño de la API de WhatsApp se rechaza al subir**, no al enviar, para que el problema aparezca cuando el admin puede resolverlo.
- [ ] La lista de productos es navegable con el catálogo real del cliente, que hoy son unas decenas.

## Answer — dónde viven los binarios, y qué entra en esta ola (18-ago-2026)

### Los archivos enviables van a Postgres, como `message_media`

Decidido por el usuario. La `0022` había dejado esto explícitamente sin dueño
(«su forma depende de dónde vivan los binarios… decisión con dueño, no un
default mío»), y hoy se cierra: **tabla `product_media` con los bytes en la
base**, copiando el patrón que `message_media` ya corre en producción.

La razón es el volumen real, no la comodidad: WhatsApp corta en **16 MB**, el
catálogo son **17 productos hoy** y decenas mañana, y unos pocos archivos por
producto. Eso es **cientos de MB**, no terabytes. Estrenar object storage metía
un proveedor, una cuenta y una credencial nuevos en el camino crítico de un
módulo que todavía no factura — y hoy no hay ninguna credencial de storage en el
entorno.

**Queda como deuda anotada, con disparador**: si el catálogo de las dos
operaciones pasa de unos pocos GB, esto se muda a S3/R2. Es una migración de
datos acotada —una tabla, una columna de bytes— y no arrastra al resto.

El rechazo por tamaño sale gratis de esta forma: se valida el `size` **al
subir**, que es el criterio del ticket («aparece cuando el admin puede
resolverlo»), no al enviar.

### Lo que entra en esta ola y lo que no

**Esta ola construye el catálogo sin archivos.** La tabla `product_media` es una
migración, y **esta ola ya tiene una sola migración asignada** (la `0024`, del
worktree `selector-operacion`): drizzle reescribe el journal, y dos ramas que
generen en paralelo chocan siempre.

Entonces:

- **Entra**: la lista (tabla densa con el origen como columna, buscar, filtrar
  con chips removibles, ordenar, columnas conmutables, total al pie, selección
  múltiple), la ficha, el producto nativo con nombre y descripción, y conectar
  un producto de la tienda.
- **No entra**: subir imágenes y adjuntos, y el interruptor de enviable por
  archivo. Va en la ola siguiente con la migración `0025`.
- Por lo tanto **este ticket no se cierra en esta ola**: queda con los criterios
  de archivos sin marcar. Un ticket cerrado que el operador no puede usar del
  todo es peor que uno abierto.

### La dependencia del cliente que sí muerde acá

**`shopify_connection` tiene 0 filas en producción** (medido el 18-ago-2026).
Sin credenciales de administración de la tienda, «buscar y conectar un producto
existente» **se construye pero no se puede verificar contra datos reales**. Es la
misma dependencia que bloquea todo `ventas-cierre-orden`, y no la resuelve
ningún agente: la trae Vorare.

Consecuencia para quien construya: el camino del producto **nativo** se verifica
de punta a punta hoy; el **conectado** se deja funcionando contra la conexión
cuando exista, y el estado «tienda no conectada» tiene que ser una pantalla
honesta, no un error crudo.

Y falta código: `apps/worker/src/shopify/admin.ts` hoy tiene `getProductsByIds`
y `pingShopify`, **no una búsqueda ni un listado de productos**. Eso es código
nuevo de este ticket.

### La forma ya está decidida, no se re-prototipa

`ventas-pulido-ui/02` la cerró con el usuario: **tabla densa con el origen como
columna**, y su razón fue el catálogo de mañana, no el de hoy — «17 productos
caben en cualquier forma; la tabla es la que sigue funcionando cuando sean 60».
Referencia: `ventas-pulido-ui/prototipos/nivel-2-catalogo.PROTOTIPO.html`,
variante 1.

Dos cosas de ese nivel que son criterio y no adorno:

1. **El anuncio compartido dice a qué otros productos apunta**
   (`23851094999 · también apunta a REVITALHAIR Serum Capilar`). Sin eso el N:M
   existe en la base y no en la pantalla.
2. **Un producto sin anuncios no es «incompleto»: es una fuga de
   reconocimiento**, y la pantalla lo dice con su consecuencia. Es la única
   parte del panel que explica por qué existe registrar anuncios.
