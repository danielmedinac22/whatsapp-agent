# 04 — Cola de reintentos y alerta ante fallo

**What to build:** Si la tienda rechaza la creación del pedido, la venta no se pierde: entra a una cola de reintentos y el equipo recibe una alerta. El cliente ya se despidió creyendo que compró, así que un fallo silencioso es peor que no vender — nadie lo descubre hasta que el cliente escribe molesto.

Es alcance contractual explícito, no mejor esfuerzo.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Un fallo al crear el pedido no descarta el cierre: queda encolado con sus datos completos.
- [ ] La cola reintenta, y un reintento exitoso **no duplica** el pedido.
- [ ] El equipo recibe alerta cuando un cierre no logra crearse.
- [ ] Un cierre en cola es visible para el equipo, con el motivo del fallo.
- [ ] Agotados los reintentos, el caso queda marcado para intervención humana en vez de desaparecer.
