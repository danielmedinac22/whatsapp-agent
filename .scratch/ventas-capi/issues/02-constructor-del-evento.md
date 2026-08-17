# 02 — Constructor del evento de conversión

**What to build:** Dado un pedido cerrado, su atribución persistida y su operación, sale el evento de compra listo para enviar a Meta — con el valor, la moneda y el píxel correctos.

Función pura, mismo patrón que el constructor de orden del spec de cierre: arma un payload externo con llave de deduplicación estable.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] El evento lleva **valor y moneda de la operación** — quetzales o pesos, sin valor por defecto. Sin el valor, Meta optimiza hacia cantidad de ventas en vez de hacia ingreso.
- [ ] El píxel se resuelve **desde la operación**, nunca desde una constante.
- [ ] La llave de deduplicación se deriva del pedido, no del momento: dos construcciones del mismo pedido dan la misma llave.
- [ ] **Un pedido sin identificador de clic no genera evento**, en vez de generar uno anónimo.
- [ ] La forma exacta del evento queda confirmada contra la documentación vigente de Meta — el flujo de conversiones para anuncios de clic a WhatsApp tiene su propio origen de acción y cambia entre versiones.
- [ ] Los tests cubren cada caso anterior.
