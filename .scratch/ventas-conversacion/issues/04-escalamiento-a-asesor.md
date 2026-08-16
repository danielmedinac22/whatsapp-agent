# 04 — Escalamiento a asesor

**What to build:** Cuando la conversación se sale de lo que Sebastián puede resolver, queda marcada para que un humano la tome. Un lead que pide hablar con una persona no tiene que insistir.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] El módulo de escalamiento existente suma los triggers del vendedor, sin duplicar lógica.
- [ ] Escala ante palabra clave de petición de humano.
- [ ] Escala ante objeción repetida sin avance.
- [ ] Escala tras dos intentos sin identificar el producto.
- [ ] Escala ante petición fuera de las reglas configuradas.
- [ ] Una conversación que avanza normalmente no escala.
- [ ] Los tests cubren cada trigger y el caso de no escalamiento.

**Nota:** el escalamiento por descuento fuera de rango **no se implementa aquí** — se dispara desde el constructor de orden, en el spec de cierre, que es donde el límite se aplica de verdad.
