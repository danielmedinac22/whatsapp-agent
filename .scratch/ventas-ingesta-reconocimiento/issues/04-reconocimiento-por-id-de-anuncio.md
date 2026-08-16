# 04 — Reconocimiento por ID de anuncio

**What to build:** Un lead que llega desde un anuncio registrado queda asociado a su producto sin que nadie le pregunte nada, y esa atribución sobrevive el resto de la conversación — incluso cuando el lead responde con botones, que es cuando la referencia del anuncio ya no viene.

Es el nivel primario de la cascada. Los fallbacks van en el ticket siguiente.

**Blocked by:** 01 · 02 · 03

**Status:** ready-for-agent

- [ ] La cascada de reconocimiento es una función pura que recibe la referencia del anuncio, el catálogo y un matcher semántico inyectado.
- [ ] Devuelve tres formas distinguibles: resuelto a un producto, ambiguo con la lista de candidatos, o desconocido.
- [ ] Un anuncio registrado que apunta a un solo producto da resuelto.
- [ ] Un anuncio registrado que apunta a varios productos da ambiguo con esa lista, no con el catálogo entero.
- [ ] La atribución del lead a su anuncio y a su producto se persiste en el primer contacto.
- [ ] Un mensaje posterior de la misma conversación —incluida una respuesta de botón, que no trae referencia— sigue teniendo su producto y su anuncio.
- [ ] Los tests cubren la cascada con el matcher semántico stubeado, sin llamar a ningún modelo.
