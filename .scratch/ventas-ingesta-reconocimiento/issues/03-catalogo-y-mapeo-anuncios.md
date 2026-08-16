# 03 — Catálogo y mapeo anuncio→productos

**What to build:** El admin puede crear un producto y asociarle uno o varios identificadores de anuncio. Un mismo anuncio puede apuntar a varios productos, para que los anuncios de familia o de combo funcionen sin inventar productos falsos.

Es el mínimo de catálogo que el reconocimiento necesita para existir. La experiencia completa de catálogo vive en el spec del Panel de Ventas.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Existe la entidad producto del panel, con su origen declarado: conectado a la tienda o nativo.
- [ ] La relación anuncio→productos es de muchos a muchos en ambos sentidos.
- [ ] El admin puede crear un producto y asociarle identificadores de anuncio sin editar la base a mano.
- [ ] Asociar el mismo anuncio a varios productos funciona y queda consultable como conjunto.
- [ ] No se introduce ningún concepto de familia o agrupación de productos: la agrupación la expresa el mapeo.
- [ ] Los productos quedan uno a uno con los de la tienda; no se reestructura el catálogo del cliente.
