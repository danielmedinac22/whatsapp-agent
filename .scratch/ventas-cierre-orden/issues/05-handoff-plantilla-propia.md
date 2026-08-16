# 05 — Handoff con plantilla propia a los 10 minutos

**What to build:** El pedido creado por el vendedor entra al flujo de confirmación por el mismo camino que cualquier otro, pero el cliente recibe un mensaje que **reconoce que acaba de comprar** y se enfoca en verificar la dirección — en vez de preguntarle si quiere comprar algo que ya compró. Sale a los diez minutos, no a los cinco, para que no se sienta atropellado tras despedirse del vendedor.

**Blocked by:** 01 · Plantilla de ventas aprobada · 03

**Status:** ready-for-agent

- [ ] El pedido creado dispara el pipeline de confirmación existente, **sin camino nuevo**.
- [ ] Una función pura decide qué plantilla y qué demora corresponden según el origen del pedido.
- [ ] Un pedido con etiqueta de ventas usa la plantilla nueva y diez minutos.
- [ ] **Un pedido que no viene de ventas conserva exactamente el comportamiento actual**: misma plantilla, misma demora.
- [ ] La demora deja de ser un valor único compartido, o se resuelve por origen.
- [ ] Los tests cubren ambos orígenes.
- [ ] No se salta la confirmación: la verificación de dirección se conserva, porque es donde se sostiene el contraentrega.
