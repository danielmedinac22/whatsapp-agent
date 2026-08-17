# 04 — Verificar el evento en el administrador de Meta

**What to build:** Prueba de que el circuito completo funciona: un evento de prueba sale del sistema y **se ve llegar** en el administrador de eventos de Meta, con su valor, su moneda y su atribución al anuncio correcto.

Sin este paso, lo único que sabemos es que enviamos algo.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Se envía un evento con el código de prueba de Meta y se confirma su llegada en el administrador de eventos.
- [ ] El evento aparece **atribuido al anuncio correcto**, no como tráfico anónimo. Es lo único que demuestra que el identificador de clic sirvió.
- [ ] El valor y la moneda se ven correctos en Meta.
- [ ] Queda registrado qué calidad de coincidencia reporta Meta, como línea base.
- [ ] Solo después de esto se habilita el envío real.
- [ ] Queda documentado el procedimiento, para repetirlo tal cual cuando se abra el píxel de Colombia.
