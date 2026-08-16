# 01 — Sebastián responde con su persona

**What to build:** Un mensaje al número de ventas recibe respuesta de Sebastián, con el nombre y el tono que tiene configurados. Katherine sigue respondiendo igual que siempre en su número, sin contaminarse.

**Blocked by:** ventas-ingesta-reconocimiento 01 · Segunda conexión de WhatsApp para ventas

**Status:** ready-for-agent

- [ ] El vendedor tiene su **propio registro de configuración, en una tabla hermana** — no se generaliza la configuración existente, cuyas 65 referencias son en su mayoría campos de Katherine.
- [ ] Esa configuración incluye nombre visible, mensajes base, límite de descuento, instrucciones de tono, modelo y esfuerzo de razonamiento.
- [ ] El constructor de prompt efectivo recibe qué agente está armando y resuelve de dónde leer. Es el único punto que aprende que hay más de un agente.
- [ ] Un mensaje al número de ventas produce respuesta con la persona del vendedor.
- [ ] El prompt de Katherine no incorpora ningún campo de la configuración de ventas, ni al revés.
- [ ] Los tests cubren el prompt efectivo de cada agente y verifican que no se filtra configuración entre ellos.
- [ ] El modelo del vendedor es de gama media con esfuerzo de razonamiento bajo, y es un campo, no una constante.
