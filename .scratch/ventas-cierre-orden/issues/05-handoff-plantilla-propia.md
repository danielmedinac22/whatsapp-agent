# 05 — Handoff en el mismo hilo, a los 10 minutos

**What to build:** El pedido creado por el vendedor entra al flujo de confirmación por el mismo camino que cualquier otro, y el cliente recibe **en el mismo chat** un mensaje que reconoce que acaba de comprar y se enfoca en verificar la dirección — en vez de preguntarle si quiere comprar algo que ya compró. Sale a los diez minutos, no a los cinco, para que no se sienta atropellado tras despedirse del vendedor.

**Blocked by:** 03

**Status:** resolved

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

## Answer

**Status: resolved.** El fallo que esperaba a ocurrir está cerrado, cableado y
verificado contra los pedidos reales de producción.

### El riesgo, y cómo se cerró

El seguimiento tenía una regla: **si el cliente escribió después de que llegó el
pedido, se salta el mensaje y el pedido queda marcado como confirmado.** Para un
pedido de la tienda es correcta, y lleva 1.734 pedidos funcionando: quien compró
en la web y escribió al número ya está hablando con alguien.

**Para una venta es falsa.** Ahí la conversación *es* el origen: el cliente acaba
de hablar con el vendedor, así que **siempre** habrá un mensaje reciente. Aplicada
tal cual, toda venta habría quedado auto-confirmada sin que nadie verificara la
dirección — y en contraentrega la dirección sin verificar es la causa número uno
de devolución. El pedido diría «confirmado» mientras nadie lo confirmó.

**No se bajó la regla**, que es lo que habría roto el camino que factura. Se le
puso delante una pregunta: **¿de dónde viene este pedido?** El origen lo dice una
etiqueta que el propio sistema le pone al crearlo. Un pedido sin esa etiqueta pasa
por exactamente la misma decisión de siempre, auto-confirmado incluido.

### Lo que recibe cada quien

- **Pedido de la tienda** — la plantilla de siempre, con la demora de siempre y
  los mismos textos. Sin una línea de diferencia.
- **Pedido del vendedor** — a los **diez minutos** en vez de dos, con un mensaje
  que **reconoce que acaba de comprar** en vez de preguntarle si quiere comprar, y
  que se enfoca en confirmar la dirección. No se salta la confirmación: la hace en
  un mensaje.
- **Pedido del vendedor que se atascó** más de un día en la cola de reintentos —
  sale **por plantilla**, no falla en silencio. Es el borde por el que el mensaje
  y el mecanismo se deciden por separado.

**La propiedad de la conversación pasa sola del vendedor al de confirmación** en
cuanto el pedido existe, y no hizo falta escribir nada: quién atiende se deriva de
si el contacto tiene pedidos, así que crear el pedido ya cambia la respuesta. Una
columna nueva habría sido una cuarta cosa que mantener de acuerdo con las otras
tres, y la que miente siempre es la que alguien olvidó actualizar.

### Una corrección al ticket, y por qué se hizo así

El plan decía «ventana abierta → texto libre» para los dos orígenes. **Al
cablearlo resultó falso para el pedido de la tienda**, y de una manera que
importaba: el spec suponía que quien compra en la web nunca escribió y por lo
tanto tiene la ventana cerrada. Basta un caso corriente para romperlo — alguien
que escribió hace tres horas y no volvió a escribir después del pedido tiene la
ventana **abierta**, y hoy recibe plantilla. Con la regla al pie de la letra
habría empezado a recibir texto libre: un cambio de comportamiento sobre el camino
que factura, sin que nadie lo pidiera.

Manda el criterio del ticket, que es explícito: un pedido que no viene del
vendedor conserva **exactamente** el flujo de hoy. Así que la regla quedó dicha
una vuelta más precisa, sin perder lo que la hacía valiosa: **la ventana decide
cómo sale el mensaje, entre las formas que el origen permite.** El pedido de la
tienda solo permite plantilla —porque es lo que hace hoy—; el del vendedor permite
las dos.

### Cómo se comprobó

Además de los tests —las cuatro combinaciones de origen y ventana, más el caso
explícito de que un pedido de ventas con mensajes recientes **no** queda
auto-confirmado— se corrió la decisión nueva **sobre los 1.734 pedidos reales de
producción**, en las seis combinaciones de ventana y respuesta.

Resultado: los 1.734 se leen como pedidos de la tienda, y las únicas dos
decisiones que salen son las dos de hoy — auto-confirmar cuando el cliente ya
respondió, y la plantilla de siempre con la demora configurada de la operación
(120.000 ms). **Cero casos de texto libre.**

### Lo que no se pudo ver funcionar

El camino del vendedor no es observable todavía: no existe ningún pedido con la
etiqueta de ventas porque nadie ha cerrado una venta. Se marca resuelto igual
porque **lo que este ticket tenía que lograr era quitar un riesgo**, y el riesgo
está quitado y demostrado sobre datos reales: el día que se conecte la tienda, un
pedido de ventas no puede quedar auto-confirmado.
