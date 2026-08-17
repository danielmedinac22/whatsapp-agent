# 01 — Persistir el identificador de clic

**What to build:** El identificador de clic del anuncio queda guardado en el primer contacto, junto a la atribución de producto. Es el dato que después permite decirle a Meta qué pauta produjo la venta, y **solo llega en el primer mensaje** — si no se guarda ahí, se pierde para siempre.

**Blocked by:** ventas-ingesta-reconocimiento 04 · Reconocimiento por ID de anuncio

**Status:** ready-for-agent

- [ ] El identificador de clic se extrae junto con la referencia del anuncio y se persiste en el primer contacto.
- [ ] Se guarda asociado a la conversación y a su operación, no globalmente.
- [ ] Un mensaje posterior de la misma conversación —incluida respuesta de botón— sigue teniendo el identificador disponible.
- [ ] Una conversación sin referencia de anuncio simplemente no tiene identificador, sin inventar uno.
- [ ] Los tests cubren presencia y ausencia del campo.
