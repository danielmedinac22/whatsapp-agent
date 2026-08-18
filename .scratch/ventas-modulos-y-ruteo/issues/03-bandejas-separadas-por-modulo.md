# 03 — Bandejas separadas por módulo

**What to build:** Quien entra al módulo de ventas ve las conversaciones que le toca vender. Quien entra al de confirmación ve los pedidos por confirmar y en camino. Cada uno ve lo suyo, sin filtrar a ojo.

**Blocked by:** 01 · 02 · ventas-multi-operacion 07 · Selector de operación en el panel

**Status:** resolved — worktree `bandejas`, ola del 18-ago (2)

- [x] Cada módulo tiene su bandeja, alimentada por la función de ruteo.
- [x] Una conversación que cierra la venta **desaparece de la bandeja de ventas y aparece en la de operaciones**, sola.
- [x] **Al abrir un chat se ve el historial completo**, incluida la parte de venta. Los módulos separan pantallas y configuración, no el historial: operaciones necesita saber qué le prometieron al cliente.
- [x] El módulo vive **dentro** de la operación: primero se elige país, después módulo.
- [x] Las conversaciones escaladas a humano se distinguen a simple vista dentro de su bandeja.
- [x] **Apagar el módulo de ventas no afecta la confirmación.** Es lo que hoy factura.

## Answer — las dos bandejas están puestas, y se encienden con el vendedor

**No hay pantalla nueva.** El Inbox que ya existe trae una bandeja u otra según
el parámetro `?b=`: `/inbox` es la de confirmación —el enlace de Katherine, sin
tocar— y `/inbox?b=ventas` es la de Sebastián, que cuelga de «Conversaciones»
dentro del grupo Ventas con sus tres vistas y su contador.

### El interruptor es el vendedor configurado, y eso es lo que protege Guatemala

Mientras `sales_agent_settings` no tenga fila para la operación **no hay dos
bandejas**: no aparece el enlace de Conversaciones, no se deriva nada, no se
paga ni una consulta de más y `/inbox` trae todo como hasta hoy. En producción
esa tabla está en cero, así que **hoy el panel de Katherine no cambia en nada**.
Se encenderá cuando alguien configure a Sebastián en `/vendedor`, que es un acto
del dueño de la operación y no un efecto colateral de este ticket.

Eso no es una promesa: está medido. Se levantó una base de ensayo con 1.725
conversaciones —la escala de producción—, se renderizó el panel con el código de
antes del ticket y con el de después, y con el vendedor apagado:

- **`/orders`, `/templates`, `/agent` y `/connection` salen byte por byte
  idénticos.**
- **`/inbox` difiere en cinco atributos `class`, y en nada más**: `min-w-0` en
  los dos contenedores de la cabecera de la lista y en el `<select>`, y
  `shrink-0` en el rótulo y en el contador. Ni una palabra, ni un nodo, ni una
  fila de diferencia. Son la red contra el desbordamiento que se vio en ventas
  —una opción larga empujaba el «99/115» fuera de la tarjeta— y valen igual en
  la bandeja de confirmación, donde hoy no se nota porque sus opciones son
  cortas. Se dejaron sin condicionar a propósito: unas clases de layout puestas
  solo en una bandeja serían dos cabeceras que se pueden desincronizar.

### Qué hace la bandeja, y por qué se deriva sobre todas y se corta después

`listConversations` recibe la bandeja y, cuando la recibe, **deriva sobre todas
las conversaciones de la operación antes de cortar en 200**. Cortar primero
habría dejado la bandeja de ventas vacía justo en el caso de Guatemala, donde
las 200 conversaciones más recientes son casi todas de operaciones. Con la base
a escala se ve: ventas trae **115** conversaciones aunque ninguna esté entre las
200 últimas.

La regla no se reescribió: es `resolveInbox` de `@wa/db`, la que ya estaba. Lo
único nuevo es cargarle los pedidos **de a muchos**
(`loadOrderFactsByContact`) en vez de uno por uno como hace el worker; son dos
cargas de la misma forma —las dos devuelven `OrderFacts`—, así que el día que el
ruteo necesite un hecho más las dos dejan de compilar juntas.

### Los criterios, uno por uno

- [x] **Cada módulo tiene su bandeja, alimentada por la función de ruteo.**
- [x] **La que cierra la venta desaparece de ventas y aparece en operaciones.**
      Verificado con «Elena Barrios» en la base de ensayo: llegó por anuncio, se
      le creó el pedido después, y aparece **solo** en operaciones.
- [x] **Al abrir un chat se ve el historial completo, incluida la parte de
      venta.** El contexto de venta se sirve en las **dos** bandejas: Elena está
      en operaciones y su hilo sigue contando de qué anuncio y qué producto
      venía. Los módulos separan pantallas, no el historial.
- [x] **El módulo vive dentro de la operación.** Las vistas cuelgan del grupo
      Ventas, que cuelga de la columna del país. Y el rebote por rol ya sabe a
      cuál de las dos bandejas cae cada uno (`landingFor`): un rol `sales`
      pidiendo `/orders` rebota a `/inbox?b=ventas`, no al Inbox de Katherine.
- [x] **Las escaladas se distinguen a simple vista.** La fila lleva «escalada»,
      y solo eso: el reconocimiento limpio **no se marca**, porque marcar todo es
      no marcar nada.
- [x] **Apagar el módulo de ventas no afecta la confirmación.** Ver arriba: el
      HTML es el mismo salvo cinco clases de layout en la cabecera de la lista.

### Lo que queda abierto, dicho por su nombre

1. **La bandeja de ventas se llena de verdad cuando el pipeline de entrada
   escriba `ad_referral_at` y `product_id`** (worktree `lead-nuevo`). Hoy en
   producción esas columnas están vacías, así que la bandeja de ventas traería
   los **109 contactos sin pedido** —que es correcto— pero ninguna marca de
   reconocimiento, porque no hay reconocimiento guardado todavía.
2. **Un rol `sales` todavía alcanza la bandeja de operaciones** por el enlace
   «Confirmación · Inbox», porque `/inbox` está clasificada `ambos` y esa
   clasificación es justo la que mantiene el historial compartido. Que la
   *bandeja* deba ser más estrecha que el *historial* es una decisión que este
   ticket no toma. Hoy no lo nota nadie: los tres usuarios son `admin`.
3. **Costo medido, con vendedor configurado y a escala de 1.725
   conversaciones**: la barra lateral suma 3 consultas a **cada** pantalla del
   panel (los contadores tienen que verse desde afuera de la bandeja) y el Inbox
   2 más. Contra una base local: `/inbox` pasa de ~45 ms a ~95 ms, `/orders` de
   ~38 ms a ~50 ms. Contra Railway, donde cada ida y vuelta cuesta más, la
   proyección es +100–200 ms por pantalla. Si molesta, lo que se cachea es la
   derivación por operación, no el conteo.
