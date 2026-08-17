# 01 — Distinguir un lead nuevo de un cliente existente

**What to build:** Con venta y confirmación compartiendo número, cuando llega un mensaje el sistema tiene que saber **a quién atiende**: alguien que acaba de hacer clic en un anuncio y quiere comprar, o alguien que ya compró y pregunta por su pedido.

Este problema no existía cuando los números eran dos. Ahora es la primera decisión de cada mensaje entrante, y equivocarla significa venderle a quien solo quería saber dónde está su guía.

**Blocked by:** ventas-multi-operacion 02 · La conexión de WhatsApp cuelga de la operación

**Status:** ready-for-agent

- [ ] Un mensaje que trae referencia de anuncio se trata como lead de venta, siempre.
- [ ] Un mensaje de alguien con pedido en curso se trata como consulta de postventa, aunque venga sin referencia.
- [ ] **Un cliente que ya compró y hace clic en un anuncio nuevo es un lead de venta otra vez**, sin perder su historial de postventa.
- [ ] Un mensaje sin referencia y sin pedido en curso entra como lead de venta.
- [ ] La conversación registra qué agente es dueño en cada momento.
- [ ] La operación de Guatemala en producción no cambia de comportamiento mientras exista un solo agente.
- [ ] Los tests cubren las cuatro combinaciones de referencia presente o ausente y pedido en curso o no.

**Reemplaza al ticket original de segunda conexión de ventas**, cuyo trabajo se movió al spec de Operaciones.
