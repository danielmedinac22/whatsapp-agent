# 02 — Catálogo de doble fuente

**What to build:** El admin arma su catálogo de dos maneras: conectando un producto que ya existe en la tienda —de donde se lee toda su información, sin volver a escribirla— o creando uno nativo con nombre, descripción, imágenes y adjuntos para vender algo que aún no está en la tienda.

**Blocked by:** ventas-ingesta-reconocimiento 03 · Catálogo y mapeo anuncio→productos

**Status:** listo para cerrar — worktree `assets-0025`, ola del 18-ago (2). Los archivos entraron con la migración `0025`, que está **generada y sin aplicar**

- [x] El admin puede buscar y conectar un producto existente de la tienda. *(construido; sin verificar contra datos reales — `shopify_connection` está vacía)*
- [x] **Un producto conectado lee su información de la tienda en tiempo de uso, no la copia** — editarlo allá se refleja acá, sin desincronización silenciosa.
- [x] El admin puede crear un producto nativo con nombre, descripción, imágenes y adjuntos. *(tabla `product_media`, migración `0025`; la subida del panel corta en 4,5 MB — ver el Answer)*
- [x] El panel no escribe sobre los productos de la tienda: los lee.
- [x] **Un video que excede el límite de tamaño de la API de WhatsApp se rechaza al subir**, no al enviar, para que el problema aparezca cuando el admin puede resolverlo.
- [x] La lista de productos es navegable con el catálogo real del cliente, que hoy son unas decenas.

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

## Answer — lo construido y lo que falta (18-ago-2026, worktree `catalogo`)

### Lo que ya se puede usar

`/catalogo` existe: tabla densa con el origen como columna, buscar por nombre o
por id de anuncio, filtrar con chips removibles, ordenar, columnas conmutables,
total y estado del filtro al pie, y selección múltiple. La ficha muestra la
descripción en texto plano con el aviso **«el panel no escribe sobre la tienda»**
cuando el producto vive en Shopify, y editable cuando es del panel.

**Un producto conectado no copia nada**: se guarda su identificador y su nombre,
descripción y precio se leen de la tienda en cada carga de la pantalla. Es lo
que hace verdadero el criterio de «editarlo allá se refleja acá»: no hay copia
que pueda quedar vieja.

Se agregó el código que faltaba en `apps/worker/src/shopify/admin.ts`:
`searchStoreProducts` —buscar por texto libre, que es lo que permite conectar un
producto sin saberse el id de memoria— y `readStoreProducts`, que devuelve el
**estado de la tienda** y no solo una lista. Esa diferencia importa: con una
lista vacía, «no hay tienda conectada» y «la tienda no tiene ese producto» se
ven igual, y se arreglan distinto.

### El estado que el operador va a ver primero, y es honesto

`shopify_connection` sigue con **0 filas**. Buscar en la tienda responde «la
tienda no está conectada», dice dónde se configura (Conexión → Shopify), aclara
que las credenciales las trae el dueño de la tienda y **ofrece la salida**: se
puede crear el producto en el panel y registrarle sus anuncios, que el
reconocimiento funciona igual. No es un error crudo ni una pantalla vacía.

El camino del producto del panel se verificó de punta a punta contra una base de
ensayo con el catálogo real cargado. El camino conectado **está construido y no
se pudo verificar contra datos reales**: la afirmación más riesgosa de este
reporte es que la búsqueda en Shopify funciona, porque nunca corrió contra una
tienda. Lo que sí se verificó es que su ausencia no rompe la pantalla.

### Por qué este ticket queda abierto

Falta **subir imágenes y adjuntos, y el interruptor de enviable por archivo**.
Necesitan la tabla `product_media`, que es migración, y esta ola tenía una sola
migración asignada —la `0024`, de otro worktree—: dos ramas generando en
paralelo reescriben el mismo journal y chocan siempre. Va con la `0025`.

Con eso llega también el rechazo por tamaño al subir (el criterio del video de
27 MB), que sale gratis de validar el `size` en la carga.

### Lo que quien siga tiene que saber

- La entrada de menú de `/catalogo` y su clasificación de permisos son del
  worktree `selector-operacion`. Hoy los tres usuarios de producción son `admin`
  y alcanzan la pantalla; **cuando exista un usuario con rol `sales`, `/catalogo`
  y `/api/catalogo` tienen que entrar en `AREAS` de `apps/web/src/access/resolve.ts`
  como `"ventas"`**, o el borde los rebota por «ruta sin clasificar».
- Buscar, filtrar y ordenar corren en el navegador, no en la URL —al revés que
  la tabla de pedidos—: son decenas de filas y traerlas todas es correcto. Si el
  catálogo creciera a miles, eso es lo que cambia.

---

## Answer — los archivos, cerrados (18-ago-2026, worktree `assets-0025`)

### La tabla, y la deuda que queda anotada

`product_media` existe: los bytes en Postgres, como `message_media`, que es lo
que el usuario decidió. La medida que respalda la decisión está tomada, no
supuesta — `message_media` en producción son **46 filas y 1,26 MB en total, la
mayor de 122 KB**. El disparador de la deuda quedó escrito en `schema.ts`: si el
catálogo de las dos operaciones pasa de unos pocos GB, `bytes` se cambia por una
llave de objeto y se muda a S3/R2. Es una tabla y una columna; no arrastra al
resto porque **nadie más lee esos bytes**.

**La operación no se hereda del producto**: columna `operation_id` y clave
foránea compuesta `(operation_id, product_id) → products (operation_id, id)`,
igual que `product_ads`. Comprobado contra una base de ensayo: insertar un
archivo declarando la operación colombiana sobre un producto guatemalteco
**lo rechaza Postgres**, no el código. Borrar el producto se lleva sus archivos.

### El rechazo por tamaño, y la corrección que el código obligó

El criterio se cumple en los tres lugares donde puede fallar: el navegador mide
el archivo **antes de subirlo** —así que un video de 27 MB no viaja—, la ruta lo
vuelve a preguntar porque lo que le llega, le llega de afuera, y el accesor lo
pregunta por última vez antes de escribir. La regla vive una sola vez, en
`@wa/shared`.

**Y acá el código corrigió a la especificación.** El nivel 2 nombra «el límite de
16 MB de la API de WhatsApp», pero 16 MB es el límite de **un video**, que es el
ejemplo que usó. Meta corta las **imágenes en 5 MB**. Con un solo número, un JPG
de 8 MB se habría subido, la pantalla lo habría mostrado enviable y Meta lo
habría rechazado al mandarlo — que es exactamente el error de este ticket, movido
al momento en que el admin ya no puede hacer nada. Los límites que se aplican son
los de Meta por tipo: imagen 5 MB, video y audio 16 MB, documento 100 MB.

**El prototipo dibujaba el archivo rechazado como una fila permanente**, con su
interruptor deshabilitado y su motivo. No se guarda: un archivo que nunca se va a
poder enviar cuesta base de datos y no compra nada, y además la subida del panel
no podría cargarlo. El motivo se ve donde importa —en el acto, al elegirlo— y el
estado de *interruptor deshabilitado* **sigue existiendo** para las filas que
caigan de ese lado si Meta baja un límite, que es cuando de verdad hay algo que
explicar.

### El techo que hay que saber: la subida del panel corta en 4,5 MB

**Es la afirmación incómoda de este reporte y no se puede esconder.** `apps/web`
corre en Vercel, y una función serverless de Vercel corta el cuerpo de la
petición en 4,5 MB. Entonces hoy: **un video de 8 MB, que WhatsApp aceptaría, no
se puede subir por el panel.** Imágenes y PDFs, que es lo que más se carga,
entran sin problema.

No se disimula: es un motivo de rechazo **aparte**, con su propio texto —«WhatsApp
lo aceptaría, pero la subida del panel corta en 4,5 MB; es un tope de dónde está
alojado el panel, no del archivo»—, porque se arregla distinto que el otro: uno
recomprimiendo, el otro cambiando por dónde viaja el archivo.

La salida está identificada y **es una decisión del usuario, no de un agente**:
que la subida vaya del navegador directo al worker, que corre en Railway y no
tiene ese tope. Cuesta una variable pública con la URL del worker y una forma de
autenticar esa subida sin exponer `WORKER_API_TOKEN`. No se hizo por cuenta
propia porque estrena superficie pública en el worker.

La constante está en un solo lugar (`PANEL_UPLOAD_MAX_BYTES`) con su porqué
escrito al lado: el día que la subida cambie, se borra y el único límite vuelve a
ser el de WhatsApp.

### La pantalla

En la **ficha**: sección Archivos con el conteo en la cabecera —«2 de 3
enviables»—, una fila por archivo con su tipo, su peso y su interruptor, y el
botón de subir. El conteo cuenta **lo que le llega al cliente**, no lo que está
marcado: un archivo marcado que excede el límite no sale, y contarlo haría que la
cabecera prometa de más.

En la **tabla**: columna *Archivos* conmutable con `2/3 enviables`, orden por
archivos enviables, el filtro **«Sin archivos enviables»** que el nivel 2 pidió
por su nombre —mira enviables y no «con archivos», porque un producto con cuatro
archivos todos desmarcados le manda al cliente lo mismo que uno sin ninguno— y el
total al pie: «3 sin anuncios · 4 sin archivos enviables». Buscar encuentra
también por nombre de archivo.

**Los bytes no llegan al navegador.** Todo lo que la pantalla lee es metadata; se
verificó que el payload de `/catalogo` no contiene la columna binaria. Dibujar la
lista de archivos de 17 productos no puede significar traerse los archivos.

### Cómo se verificó

Contra una base de ensayo en Docker con el catálogo real cargado —los tres
REVITALHAIR de nombre casi idéntico— y con el panel corriendo contra ella:

- Subir una **imagen de 6 MB** por la ruta real responde `413` y
  *«grande.jpg pesa 6,0 MB y excede el límite de WhatsApp para imágenes (5,0 MB):
  no se puede enviar, así que no se sube. Recomprimilo y volvé a intentarlo.»*
- Un PDF de 300 KB entra, y entra **apagado**: `sendable: false`. Marcarlo es un
  acto aparte.
- La ficha de *DHT ANTICALVICIE* renderiza «Archivos · 2 de 3 enviables» con
  `ficha-producto.pdf · 480 KB`, `antes-despues.jpg · 1,2 MB` y
  `margen-interno.xlsx · 44 KB` sin marcar.
- La base rechaza el archivo de cero bytes y el que cuelga de un producto de otra
  operación.
- `pnpm -r typecheck` limpio; `pnpm --filter @wa/worker test` **447 verdes**
  (423 antes).

El sembrador `scripts/seed-catalogo-ensayo.ts` **no se reemplazó**: se le
agregaron los archivos, y sigue negándose a correr contra producción.

### Lo que este ticket deja para otro

**El envío no está acá.** Que un archivo marcado llegue al cliente es
`ventas-conversacion/03`, que no está construido. Lo que este ticket deja listo es
la lectura que ese envío va a consultar: `listSendableProductMedia(op, productId)`,
sin caché, filtrando por operación, producto, marca y tamaño.
