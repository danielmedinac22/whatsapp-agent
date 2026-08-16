# 03 — Envía los apoyos visuales

**What to build:** Durante la conversación, Sebastián manda las fotos y videos del producto para que el lead decida con más confianza. Solo manda lo que el admin autorizó, y un archivo demasiado pesado no rompe la conversación.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Solo se envían archivos marcados como enviables para el producto identificado.
- [ ] Los archivos no marcados nunca se envían, aunque estén cargados.
- [ ] Un video que excede el límite de tamaño de la API de WhatsApp no se envía y la conversación continúa con normalidad.
- [ ] El envío queda registrado en el hilo como cualquier otro mensaje saliente.
- [ ] Un fallo de envío de un archivo no interrumpe la venta ni deja al lead sin respuesta.
