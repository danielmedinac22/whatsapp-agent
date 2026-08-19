# Permisos de la tienda — qué pedir, y por qué exactamente eso

**Para replicar en Colombia sin adivinar.** Lo mismo vale para cualquier tienda
nueva: una conexión por operación, y un pedido de una operación **nunca** se crea
en la tienda de otra.

Medido el 18-ago-2026 en producción: `shopify_connection` tiene **0 filas**. Nada
de lo de abajo está hecho todavía; esto es el instructivo, no el registro.

## Los tres permisos, y qué se cae sin cada uno

Se crea una **custom app** en Shopify Admin → Settings → Apps → Develop apps, y
se marcan **exactamente** estos tres:

| Permiso | Para qué | Qué se cae sin él |
| -- | -- | -- |
| `read_products` | La ficha real del producto en el prompt del vendedor y el buscador del catálogo del panel. | El vendedor conversa sin saber qué vende. |
| `read_orders` | **La comprobación previa a crear.** Se busca si el cierre ya produjo un pedido antes de crear otro. | Un reintento duplica un envío contraentrega. La creación queda bloqueada a propósito. |
| `write_orders` | Crear el pedido de una venta cerrada en el chat. | Una venta cerrada no aterriza: queda en la cola de cierres y suena una alerta. |

En Shopify, conceder `write_x` concede también `read_x`. El sistema lo tiene en
cuenta, así que un token con `write_orders` y sin `read_orders` en la lista **no**
se reporta como incompleto.

## Lo que deliberadamente NO se pide

Cada permiso que no se pide es una escritura que no puede ocurrir por error.

- **`read_customers`** — los datos del cliente los captura la conversación; no se
  leen de la tienda. El pedido se crea con teléfono y dirección de envío, sin
  crear ni asociar un cliente de la tienda.
- **`read_all_orders`** — la ventana de 60 días de la API alcanza de sobra para
  comprobar un cierre que acaba de ocurrir.
- **`write_products`, `write_inventory`, `write_fulfillments`** — el catálogo se
  edita en la tienda y se lee en tiempo de uso; la guía nace de la integración
  Shopify↔Dropi, que es ajena a este sistema.

El panel **muestra los permisos de más** que traiga el token. No bloquean nada, y
verlos es lo que hace verificable el «no más de lo necesario»: sirve para
descubrir que se pegó el token de otra app o que se marcó de más.

## El orden en que se enciende. No se salta.

Es el riesgo **R6** de la no-regresión: al configurar esta conexión se le da al
sistema capacidad de **crear pedidos en una tienda viva**.

1. **Guardar la conexión en el panel.** Al guardar, el sistema verifica
   **leyendo y solo leyendo**: nombre de la tienda, permisos concedidos y un
   producto. No escribe nada. Si el token es corto, se ve en el momento y no tres
   semanas después en medio de una venta.
2. **Dejar el modo seco puesto** —está puesto por defecto y no se enciende desde
   el panel— y cerrar una venta de prueba. El sistema arma el pedido completo, lo
   registra en el log y **no escribe**. Ahí se revisa que el payload tenga lo que
   tiene que tener.
3. **Encender la escritura** (abajo) y crear **un pedido desechable**. Se revisa
   en la tienda: etiquetas, dirección, moneda, precio, estado financiero
   pendiente, y que el inventario se haya movido como se esperaba.
4. **Borrar el pedido desechable** y recién ahí dejar el cierre automático
   operando.

## El interruptor

Variable de entorno del worker:

```
SHOPIFY_ORDER_WRITE_MODE=live
```

- **Ausente, vacía o cualquier otro valor → modo seco.** Solo el literal `live`
  enciende la escritura. `true`, `1` y `on` **no** encienden: un valor que el
  sistema no entiende no puede habilitar escrituras sobre la tienda de un
  cliente.
- Se cambia en Railway y **no desde el panel**: encender la escritura sobre la
  tienda de un cliente pide un despliegue, no un clic.
- Es una variable y no una columna porque el esquema de esta ola tiene otro
  dueño. Cuando haya migración disponible, mover el valor a
  `agent_settings` con su interruptor —igual que `dropi_dry_run`— es cambiar una
  función de una línea: todo lo que decide ya recibe el valor en vez de buscarlo.

## Dos cosas que solo se pueden confirmar contra una tienda real

El payload está construido y probado con fixtures, pero hay dos decisiones que
ningún test puede validar sin credenciales. Se revisan en el paso 3, contra el
pedido desechable:

1. **El movimiento de inventario.** Se manda `DECREMENT_OBEYING_POLICY`, que es
   lo que hace un pedido de la tienda: si el catálogo no lleva inventario o la
   política es otra, hay que ajustarlo — si no, las ventas del vendedor moverían
   el stock distinto que las demás.
2. **La forma del cliente en el pedido.** El pedido va sin cliente de la tienda:
   teléfono a nivel de pedido y nombre en la dirección de envío. El receptor del
   webhook y la plantilla de confirmación saben caer a esos campos, pero conviene
   verlo con los ojos en el pedido de prueba.
