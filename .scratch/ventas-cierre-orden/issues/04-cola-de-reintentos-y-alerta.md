# 04 — Cola de reintentos y alerta ante fallo

**What to build:** Si la tienda rechaza la creación del pedido, la venta no se pierde: entra a una cola de reintentos y el equipo recibe una alerta. El cliente ya se despidió creyendo que compró, así que un fallo silencioso es peor que no vender — nadie lo descubre hasta que el cliente escribe molesto.

Es alcance contractual explícito, no mejor esfuerzo.

**Blocked by:** 03

**Status:** abierto — construido entero, no observable hasta que el ticket 03 pueda cerrar una venta

- [ ] Un fallo al crear el pedido no descarta el cierre: queda encolado con sus datos completos.
- [ ] La cola reintenta, y un reintento exitoso **no duplica** el pedido.
- [ ] El equipo recibe alerta cuando un cierre no logra crearse.
- [ ] Un cierre en cola es visible para el equipo, con el motivo del fallo.
- [ ] Agotados los reintentos, el caso queda marcado para intervención humana en vez de desaparecer.

## Answer

**Status: open** — construido entero, pero **no observable todavía**: hasta que el
vendedor pueda cerrar una venta (ticket 03), no hay cierres que encolar. Se deja
abierto por eso y no porque falte trabajo.

### Lo que hace

**Una venta cerrada que no llega a la tienda no se descarta.** Queda guardada con
sus datos completos —cliente, dirección, qué compró, cuánto— y el equipo recibe
una alerta por WhatsApp, al mismo teléfono al que ya le llegan los escalamientos.
No se inventó un segundo canal de alertas: un segundo canal es un segundo canal
que un día deja de funcionar sin que nadie lo note.

**El reintento no duplica el pedido.** Cada intento vuelve a pasar por el mismo
camino, y ese camino **busca antes de crear**. El caso feo —la tienda creó el
pedido y se cayó al contestar— encuentra el pedido en el reintento y no crea otro.

**Solo se reintenta lo que mejora reintentando.** La tienda saturada, caída o sin
respuesta: sí, con esperas cada vez más largas. Una variante que no existe, un
permiso que falta o un token revocado: **no**, porque dentro de seis intentos van
a seguir igual y lo único que se logra es que el cliente espere seis veces más
antes de que alguien mire. Esos casos saltan derecho a la bandeja de una persona.

Hay un detalle de esta API que estaba esperando para morder: **«bajá el ritmo»
llega con código de éxito**, dentro del cuerpo de la respuesta. Leído a la ligera
se ve como un fallo definitivo y tiraría la venta. Está contemplado.

**Agotados los reintentos, el caso no desaparece**: queda en la lista de los que
esperan a una persona, con sus datos y su motivo, y vuelve a sonar la alerta —
porque agotarse es información nueva.

**El equipo los ve.** En Conexión → Shopify hay una lista de «Cierres que no
llegaron a la tienda», partida en dos: los que el sistema sigue reintentando solo
(con qué intento va y cuándo es el próximo) y los que esperan a una persona. Cada
uno dice **por qué** falló. Vive dentro de la tarjeta de la tienda a propósito:
casi siempre el motivo es algo de la conexión, así que el sitio donde se mira es
el mismo donde se arregla.

Si no hay cierres pendientes, la lista **no se dibuja**. Una tarjeta vacía que
dice «no hay nada» ocupa el mismo espacio que una con problemas y entrena a no
mirarla.

### Una decisión que vale anotar

**No se creó tabla nueva ni migración.** La cola de trabajos que el sistema ya usa
para el seguimiento, el remarketing y el envío de mensajes guarda el cierre entero
con sus datos, sobrevive reinicios y sabe reintentar con esperas crecientes: es
exactamente lo que este ticket pedía. El esquema de esta ola tiene otro dueño, y
esto no lo necesitaba.

Los casos que esperan a una persona se guardan **un mes**, no las dos semanas por
defecto: son justamente lo que la cola existe para no perder.

### Qué falta

- [ ] **Verlo funcionar.** Necesita que exista un cierre, o sea el ticket 03. La
      forma barata de provocarlo, cuando 03 esté cableado: cerrar una venta con la
      tienda desconectada — hoy eso encola y alerta por sí solo, sin romper nada.
