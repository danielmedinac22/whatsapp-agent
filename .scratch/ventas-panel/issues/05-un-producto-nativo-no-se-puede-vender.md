# 05 — Un producto nativo no se puede vender

**What to build:** Que un producto creado en el panel —no conectado a la tienda—
pueda cerrarse en una venta. Hoy no puede: no tiene precio, y sin precio no hay
línea de pedido.

**Blocked by:** None — can start immediately.

**Status:** claimed — worktree `cierre-final`, 19-ago-2026

Levantado el 19-ago-2026 por el worktree `cierre-tienda` al construir el cierre a
la tienda. Es un hallazgo de construcción: apareció al intentar armar la línea
del pedido y descubrir que a la mitad del catálogo le falta el dato.

## Lo medido

`products` tiene `source` (`shopify` \| `native`), `name`, `description` y
`shopify_product_id`. **No tiene columna de precio.**

Para un producto **conectado**, eso es correcto y deliberado: el precio vive en
la tienda y se lee en tiempo de uso, porque copiarlo sería una desincronización
silenciosa — criterio explícito de `ventas-panel/02`.

Para un producto **nativo** no hay de dónde leerlo. El `## Answer` de
`ventas-ingesta-reconocimiento/03` lo dejó fuera de la `0022` a propósito y sin
dueño: *«Precio de producto nativo y archivado/estado: ningún ticket de la ola
los pide. Cuando hagan falta son una columna nullable más.»* **Este es el ticket
en que hace falta.**

## Qué pasa hoy, y por qué no es un bug

El cierre **escala a un asesor** cuando el producto no tiene precio. Eso es el
comportamiento correcto: mejor que una persona lo tome a que el sistema invente
un número o cree un pedido sin importe.

Pero tiene una consecuencia operativa que el cliente **tiene que saber antes de
cargar su catálogo**: hoy, **para vender, el producto tiene que estar conectado a
la tienda**. Un producto nativo sirve para que Sebastián lo describa y mande sus
fotos, no para cerrarlo.

## Por qué existe la mitad nativa, para no romperla

`ventas-panel/02` la pidió para **vender algo que aún no está en la tienda**. Si
la respuesta a este ticket fuera «entonces conectá todo a la tienda», se estaría
matando la razón por la que la mitad nativa existe. La pregunta real es **con qué
precio se cierra un producto que no vive en la tienda** — y de ahí cuelga una
segunda: qué pedido se crea en Shopify para un producto que Shopify no conoce.

## Criterios

- [ ] Un producto nativo tiene precio, y el panel deja ponerlo.
- [ ] Con ese precio, una venta de producto nativo **se cierra sola**, sin
      escalar por falta de dato.
- [ ] **Un producto conectado sigue leyendo su precio de la tienda**, en tiempo
      de uso. No se copia, no se cachea a la base, no se le agrega un precio
      propio que compita con el de Shopify.
- [ ] Un producto nativo **sin** precio sigue escalando a un asesor en vez de
      cerrarse con un importe inventado.
- [ ] Queda decidido y escrito **cómo entra al pedido de Shopify** un producto
      que no existe en Shopify — línea suelta con título y precio, o lo que se
      decida—, y el pedido queda igual de reconocible para logística.
- [ ] `pnpm -r typecheck` limpio y la suite del worker en verde.

## No-regresión

`products` está **vacía en producción** (0 filas, medido el 19-ago-2026), así que
agregar la columna no toca ningún dato. Lo que sí hay que cuidar es que el
camino del producto **conectado** no cambie: es el que va a mover el volumen, y
su precio tiene que seguir viniendo de la tienda.

## Nota de alcance

Esto es **el precio**, no el catálogo entero. Archivar productos, variantes,
inventario y descuentos por producto siguen fuera y sin dueño, igual que antes.
