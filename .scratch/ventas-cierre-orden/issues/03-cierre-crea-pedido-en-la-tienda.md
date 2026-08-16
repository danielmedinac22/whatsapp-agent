# 03 — Sebastián cierra y crea el pedido en la tienda

**What to build:** Una conversación que llega al cierre produce un pedido real en la tienda, con pago contraentrega y etiquetado como venta del agente. El lead da sus datos en el chat, se le avisa en el momento si algo quedó mal, y al final recibe confirmación de que su pedido quedó registrado.

**Blocked by:** 02 · ventas-conversacion 02 · Conversa con el contexto del producto

**Status:** ready-for-agent

- [ ] Sebastián pide los datos de cierre dentro de la conversación, sin formularios ni enlaces externos.
- [ ] Un dato inválido se le comunica al lead en el momento, con qué corregir.
- [ ] Con datos válidos se crea el pedido en la tienda y el lead recibe confirmación.
- [ ] **Dos disparos del mismo cierre producen un solo pedido.**
- [ ] Un descuento fuera de rango crea el pedido al precio válido y **escala el caso a un asesor**.
- [ ] El pedido queda visible en la tienda con sus etiquetas de origen.
- [ ] El lead recibe el mensaje de embudo avisando que confirmaciones lo va a contactar.
