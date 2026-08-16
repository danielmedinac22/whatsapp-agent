# 02 — Conversa con el contexto del producto

**What to build:** Sebastián responde sabiendo de qué producto le hablan: su descripción, sus especificaciones y qué archivos tiene disponibles. El lead puede preguntar por características concretas y obtener respuesta sin que nadie le pida que aclare qué producto es.

**Blocked by:** 01 · ventas-ingesta-reconocimiento 04 · Reconocimiento por ID de anuncio

**Status:** ready-for-agent

- [ ] El contexto del producto identificado se arma como bloque y se compone en el prompt efectivo, igual que ya se hace con los contextos existentes.
- [ ] Un producto conectado a la tienda toma su información **en tiempo de uso**, no copiada — editar el producto en la tienda se refleja en la siguiente conversación.
- [ ] Un producto nativo toma su información del panel.
- [ ] Mientras el producto no esté identificado, Sebastián conversa sin contexto de producto y sin inventarlo.
- [ ] Los tests cubren el prompt efectivo con producto identificado y sin él.
