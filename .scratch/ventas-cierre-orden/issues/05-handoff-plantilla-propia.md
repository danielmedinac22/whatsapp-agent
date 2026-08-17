# 05 — Handoff en el mismo hilo, a los 10 minutos

**What to build:** El pedido creado por el vendedor entra al flujo de confirmación por el mismo camino que cualquier otro, y el cliente recibe **en el mismo chat** un mensaje que reconoce que acaba de comprar y se enfoca en verificar la dirección — en vez de preguntarle si quiere comprar algo que ya compró. Sale a los diez minutos, no a los cinco, para que no se sienta atropellado tras despedirse del vendedor.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] El pedido creado dispara el pipeline de confirmación existente, **sin camino nuevo**.
- [ ] Una función pura recibe el pedido **y el estado de la ventana**, y decide contenido, mecanismo y demora.
- [ ] **El origen decide contenido y demora**: ventas usa el mensaje que reconoce la compra, a los diez minutos.
- [ ] **La ventana decide el mecanismo**: abierta va texto libre, cerrada va plantilla.
- [ ] **Un pedido que no viene de Sebastián conserva exactamente el flujo de hoy**: misma plantilla, misma demora, mismos mensajes de actualización. Es el criterio que más importa de este ticket — ese flujo ya factura.
- [ ] **Un pedido de ventas cuya ventana se cerró** —por ejemplo tras atascarse en la cola de reintentos más de veinticuatro horas— **sale por plantilla, no falla en silencio**.
- [ ] El seguimiento posterior de guía, recolección, tránsito, mensajero y entrega **sigue usando plantillas para ambos orígenes**, porque cae fuera de ventana. Esas ya existen y no cambian.
- [ ] La propiedad de la conversación pasa del vendedor al agente de confirmación cuando el pedido queda creado.
- [ ] Los tests cubren las cuatro combinaciones de origen y estado de ventana.

## ⚠ Fallo esperando a ocurrir — leer antes de tocar nada

`jobs/followup.ts` tiene hoy un heurístico: **si existe cualquier mensaje entrante posterior a la llegada del pedido**, salta la plantilla, **marca el pedido como `confirmed` con fecha**, activa el modo agente y retorna.

Eso es correcto para un pedido web. **Es falso para un pedido de ventas**, donde la conversación *es* el origen: el cliente acaba de hablar con Sebastián, así que siempre habrá un mensaje entrante reciente.

Sin abordarlo, **todo pedido de ventas quedaría auto-confirmado sin que nadie verifique la dirección** — y en contraentrega la dirección sin verificar es la causa número uno de devolución. El pedido diría «confirmado» mientras nadie lo confirmó.

- [ ] **El heurístico de respuesta reciente no se aplica a pedidos originados en ventas.** Se distingue el origen antes de evaluarlo.
- [ ] Un pedido web con respuesta reciente **conserva el comportamiento actual, incluido el auto-confirmado**.
- [ ] Hay test que demuestra que un pedido de ventas con mensajes entrantes recientes **no** queda auto-confirmado.
- [ ] No se salta la confirmación: la verificación de dirección se conserva, porque es donde se sostiene el contraentrega.
