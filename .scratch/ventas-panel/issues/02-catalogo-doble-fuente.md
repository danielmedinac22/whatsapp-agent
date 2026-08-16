# 02 — Catálogo de doble fuente

**What to build:** El admin arma su catálogo de dos maneras: conectando un producto que ya existe en la tienda —de donde se lee toda su información, sin volver a escribirla— o creando uno nativo con nombre, descripción, imágenes y adjuntos para vender algo que aún no está en la tienda.

**Blocked by:** ventas-ingesta-reconocimiento 03 · Catálogo y mapeo anuncio→productos

**Status:** ready-for-agent

- [ ] El admin puede buscar y conectar un producto existente de la tienda.
- [ ] **Un producto conectado lee su información de la tienda en tiempo de uso, no la copia** — editarlo allá se refleja acá, sin desincronización silenciosa.
- [ ] El admin puede crear un producto nativo con nombre, descripción, imágenes y adjuntos.
- [ ] El panel no escribe sobre los productos de la tienda: los lee.
- [ ] **Un video que excede el límite de tamaño de la API de WhatsApp se rechaza al subir**, no al enviar, para que el problema aparezca cuando el admin puede resolverlo.
- [ ] La lista de productos es navegable con el catálogo real del cliente, que hoy son unas decenas.
