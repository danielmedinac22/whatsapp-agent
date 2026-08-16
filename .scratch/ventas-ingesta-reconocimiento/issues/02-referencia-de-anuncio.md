# 02 — La referencia del anuncio llega al sistema

**What to build:** Cuando alguien hace clic en un anuncio Click-to-WhatsApp y escribe, el sistema conserva de qué anuncio vino: identificador, titular, cuerpo, URL de origen e identificador de clic. Hoy esa información se pierde.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] El parser de mensajes entrantes expone la referencia del anuncio cuando el payload la trae.
- [ ] Un payload sin referencia se sigue parseando igual que hoy, sin romper ni inventar campos.
- [ ] La suite de tests del parser cubre payload con referencia y payload sin ella.
- [ ] Queda verificado contra un mensaje real originado en un anuncio activo si la ruta exacta del campo dentro del payload coincide con lo documentado.
- [ ] Si el proveedor recorta el campo, queda documentado en el ticket qué se observó y cuál es la ruta alterna, sin implementarla todavía.
