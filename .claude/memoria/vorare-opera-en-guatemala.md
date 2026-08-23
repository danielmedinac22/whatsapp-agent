---
name: vorare-opera-en-guatemala
description: "Vorare opera en Guatemala (GTQ, +502), no en Colombia — y abre una segunda operación colombiana"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0e63369c-d42d-466b-b2b6-a251a847109c
  modified: 2026-08-17T00:53:01.146Z
---

**Vorare, el cliente que opera este whatsapp-agent, vende en Guatemala.** Verificado contra producción el 16-ago-2026: las 1.678 órdenes son 100% en quetzales, prefijo telefónico 502, país de envío Guatemala. El PRD original del cliente decía «lista de Colombia» y eso era incorrecto.

Está abriendo una **segunda operación en Colombia** — operación completa: tienda Shopify propia, catálogo propio, confirmación y ventas. Un número por país, y **cada número atiende venta y postventa a la vez** (no números separados).

Datos de producción útiles como línea base:

- ~470 pedidos/mes, 17 productos, **88,4% de tasa de confirmación**.
- Concentración extrema: un solo SKU (*REVITALHAIR – DHT ANTICALVICIE*) es el 77% del volumen; los tres primeros el 96%.
- **Cuatro SKUs REVITALHAIR de nombre casi idéntico**, cuatro `product_id` distintos en Shopify sin variantes. Eso es lo que decidió usar el ID de anuncio como mecanismo primario de reconocimiento: el match semántico no los distingue, y ahí está la mayoría del volumen.
- La cuenta publicitaria opera en **COP con zona horaria Bogotá** mientras los pedidos se cobran en **GTQ**. Se pauta en una moneda y se factura en otra.

Ver [[panel-de-ventas-estado]], [[activos-meta-vorare]].
