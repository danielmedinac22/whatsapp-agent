# 01 — Sebastián responde con su persona

**What to build:** Un lead que llega por anuncio recibe respuesta de Sebastián, con el nombre y el tono configurados **para esa operación**. Katherine sigue atendiendo la postventa **en el mismo número**, sin contaminarse: la conversación sabe cuál de los dos es su dueño en cada momento.

**Blocked by:** ventas-ingesta-reconocimiento 01 · Distinguir un lead nuevo de un cliente existente · ventas-multi-operacion 05 · La configuración de agente cuelga de la operación

**Status:** esquema en curso — worktree `esquema-0022` deja la tabla hermana; la funcionalidad sigue abierta

- [ ] El vendedor tiene su **propio registro de configuración, en una tabla hermana** — no se generaliza la configuración existente, cuyas 65 referencias son en su mayoría campos de Katherine.
- [ ] Esa configuración incluye nombre visible, mensajes base, límite de descuento, instrucciones de tono, modelo y esfuerzo de razonamiento.
- [ ] El constructor de prompt efectivo recibe qué agente está armando y resuelve de dónde leer. Es el único punto que aprende que hay más de un agente.
- [ ] Un lead que llega por anuncio **al número de la operación** produce respuesta con la persona del vendedor, mientras la conversación tenga al vendedor como dueño.
- [ ] El prompt de Katherine no incorpora ningún campo de la configuración de ventas, ni al revés.
- [ ] Los tests cubren el prompt efectivo de cada agente y verifican que no se filtra configuración entre ellos.
- [ ] El modelo del vendedor es de gama media con esfuerzo de razonamiento bajo, y es un campo, no una constante.
