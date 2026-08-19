# 05 — Un producto nativo no se puede vender

**What to build:** Que un producto creado en el panel —no conectado a la tienda—
pueda cerrarse en una venta. Hoy no puede: no tiene precio, y sin precio no hay
línea de pedido.

**Blocked by:** None — can start immediately.

**Status:** resolved — worktree `cierre-final`, 19-ago-2026

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

- [x] Un producto nativo tiene precio, y el panel deja ponerlo.
- [x] Con ese precio, una venta de producto nativo **se cierra sola**, sin
      escalar por falta de dato.
- [x] **Un producto conectado sigue leyendo su precio de la tienda**, en tiempo
      de uso. No se copia, no se cachea a la base, no se le agrega un precio
      propio que compita con el de Shopify.
- [x] Un producto nativo **sin** precio sigue escalando a un asesor en vez de
      cerrarse con un importe inventado.
- [x] Queda decidido y escrito **cómo entra al pedido de Shopify** un producto
      que no existe en Shopify — línea suelta con título y precio, o lo que se
      decida—, y el pedido queda igual de reconocible para logística.
- [x] `pnpm -r typecheck` limpio y la suite del worker en verde.

## No-regresión

`products` está **vacía en producción** (0 filas, medido el 19-ago-2026), así que
agregar la columna no toca ningún dato. Lo que sí hay que cuidar es que el
camino del producto **conectado** no cambie: es el que va a mover el volumen, y
su precio tiene que seguir viniendo de la tienda.

## Nota de alcance

Esto es **el precio**, no el catálogo entero. Archivar productos, variantes,
inventario y descuentos por producto siguen fuera y sin dueño, igual que antes.

## Answer

**Un producto creado en el panel ya se puede vender.** Se le pone precio en su
ficha, y con precio el vendedor cierra la venta solo, sin pasarla a un asesor.
Sin precio sigue pasando a un asesor, que es lo que estaba bien y no se tocó.

### Lo que cambió, en lenguaje de operación

1. **El producto del panel tiene un campo de precio**, en la misma ficha donde
   ya se le pone nombre y descripción, y también al crearlo. Va en la moneda de
   la operación —hoy quetzales— y no hay conversión en ninguna parte: el precio
   de un producto guatemalteco es en quetzales y punto.
2. **No es obligatorio, y es a propósito.** Un producto sin precio sirve igual
   para lo demás: el vendedor lo describe y le manda las fotos al cliente.
   Obligarlo habría bloqueado cargar el catálogo el día que alguien todavía no
   tiene la lista de precios a mano.
3. **Pero se ve que no se puede vender.** En la tabla, la columna de precio dice
   «Sin precio» en ámbar en vez de un guion; hay un filtro **Sin precio** para
   juntarlos de una; y la ficha explica la consecuencia con todas las letras:
   *sin precio la venta pasa a un asesor en vez de cerrarse con un importe
   inventado*. Ese aviso es la parte que importa — un producto sin precio se ve
   completo, y es el que va a frenar una venta.
4. **Dejar el campo vacío le quita el precio.** Es una corrección legítima —un
   producto que dejó de venderse— y devuelve el producto al estado seguro, el de
   escalar a un asesor.
5. **Se acepta el precio como lo escribe una persona**: `150.000`, `1.234,50`,
   `Q 400`, `399,90`. Y el panel muestra debajo cómo lo entendió antes de
   guardar. Eso ataja el error caro: `150.000` leído como ciento cincuenta se
   descubriría con el repartidor en la puerta cobrando mil veces menos.
6. **Cero y negativo no se guardan.** Un producto contraentrega en cero es un
   despacho por el que el repartidor no cobra nada.

### Lo que NO cambió, que era el criterio más fácil de arruinar

**Un producto conectado a la tienda sigue leyendo su precio de la tienda, cada
vez que se usa.** No se copia, no se cachea y no se le puede poner uno propio:

- La ficha no le ofrece el campo.
- El accesor se niega a escribirlo.
- Y sobre todo, **la base lo impide**: la columna de precio tiene una regla que
  solo deja precio en los productos del panel. Se probó contra una base
  desechable intentando escribirlo por SQL directo, saltándose todo el código, y
  Postgres lo rechaza. No es una promesa del código: es del esquema.

Por qué importa tanto: dos precios para el mismo producto significan que lo que
se le cobra al cliente es el que eligió este panel y no el de la tienda — el
repartidor cobrando una cifra que Shopify ya cambió.

### La decisión que había que tomar: cómo entra a la tienda algo que la tienda no tiene

**Entra como una línea suelta: con su nombre y su precio, sin producto de la
tienda detrás.** La API de pedidos ya tiene esa forma y es la que se usa.

Se descartaron las otras dos:

- **Crear el producto en Shopify al vuelo** — pediría permiso de escritura sobre
  el catálogo de la tienda, que es justo el permiso de más que este proyecto
  decidió no pedir, y convertiría una venta en un alta de catálogo que nadie
  revisó.
- **Colgarlo de un producto genérico** («producto varios») — el pedido dejaría
  de decir qué se vendió, que es lo único que logística necesita leer.

**Qué ve logística, y cómo se entera.** Ese renglón del pedido no tiene código
de producto, no descuenta inventario —no hay inventario que descontar— y no
aparece en los informes por producto de la tienda. Para que eso no se descubra
en la bodega, el pedido sale marcado por dos vías:

- **Una etiqueta buscable**, `producto-fuera-de-la-tienda`, con la que se pueden
  listar todos los pedidos que llevan algo así. Las etiquetas son el único campo
  del pedido que la tienda sabe buscar — es la misma razón por la que la llave
  que evita el pedido duplicado también viaja como etiqueta.
- **Una línea en la nota del pedido** que dice **cuál** de los renglones no está
  en la tienda, por su nombre, y que va sin código de producto y sin descuento
  de inventario.

Y la línea va marcada como que se despacha. Sin eso, una línea suelta podría
verse en la tienda como si no hubiera nada que enviar, que es lo contrario de lo
que pasa: hay una caja y un cobro contraentrega.

Así se ve el pedido de una venta de producto del panel, corrido de verdad contra
una base desechable:

```
etiquetas: origen-ventas · vendedor:Sebastián · producto-fuera-de-la-tienda · ventas-f2b0df38…
línea:     2 × REVITALHAIR - DHT ANTICALVICIE — GTQ 399,00, sin producto de la tienda, se despacha
nota:      Pedido tomado por el vendedor en WhatsApp. Pago: Contraentrega.
           Este producto no está en la tienda y va como línea suelta, con el precio
           del panel: REVITALHAIR - DHT ANTICALVICIE. Sin SKU y sin descuento de inventario.
```

### Lo que hay que saber para no romperlo después

**Un pedido enteramente de la tienda sale exactamente igual que antes de este
ticket**, etiqueta por etiqueta y letra por letra de la nota. Está fijado en un
test, incluida **la llave que evita crear dos veces el mismo pedido**: se
recalculó con la fórmula anterior leída del historial de git, no copiada del
código nuevo, y da el mismo valor. Si esa llave cambiara, un pedido ya creado
dejaría de reconocerse y saldría un segundo envío contraentrega al mismo
cliente.

### Migración

`0028`, generada y **sin aplicar**. Agrega la columna de precio y su regla.
`products` tiene 0 filas en producción (medido el 18-ago-2026, sólo lectura), así
que no hay nada que rellenar. Se aplicó y se ejercitó contra una base desechable
con Docker: la cadena entera de migraciones corre limpia y la regla rechaza lo
que tiene que rechazar.

### Lo que sigue fuera, igual que antes

Archivar productos, variantes de un producto del panel, inventario y descuentos
por producto. Este ticket era el precio.
