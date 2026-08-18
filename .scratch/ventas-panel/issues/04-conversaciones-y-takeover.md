# 04 — Contexto de venta en el chat, y tomar el vendedor

**What to build:** Cuando un asesor abre una conversación en el módulo de ventas, entiende de dónde viene sin preguntar: qué anuncio la trajo, qué producto se reconoció y si el reconocimiento quedó limpio o dudoso. Y puede **tomar el chat al vendedor** —lo que lo pausa para esa conversación— y devolvérselo cuando termina.

**Blocked by:** ventas-modulos-y-ruteo 03 · Bandejas separadas por módulo

**Status:** claimed — worktree `bandejas`, ola del 18-ago (2)

- [ ] Al abrir un chat se ve **de qué anuncio y de qué producto** viene la conversación.
- [ ] Se ve el **estado del reconocimiento**: resuelto, ambiguo o escalado tras dos intentos.
- [ ] **Tomar el chat pausa al vendedor solo para esa conversación**, nunca globalmente.
- [ ] Devolver el chat lo reactiva y el vendedor retoma con el historial completo.
- [ ] Tomar el chat comunica inequívocamente que el vendedor quedó pausado, para que nadie escriba encima de él.
- [ ] El flujo de conversaciones de confirmación no cambia en nada.

**Qué NO construye este ticket.** La bandeja en sí —qué conversaciones aparecen, la separación por módulo, el historial completo y la distinción visual de las escaladas— la construye *ventas-modulos-y-ruteo 03*. Acá solo va el contexto de venta dentro del chat y el control sobre el agente.

**Y no confundir con la asignación.** Tomar el chat **al vendedor** pausa al agente. Asignarse la conversación —«la estoy trabajando yo»— es otra cosa, va en *ventas-modulos-y-ruteo 04*, y son independientes: se puede estar asignado sin haber pausado al vendedor.

**Nota de esfuerzo:** conviene decidir temprano si el inbox existente se puede filtrar por conexión y por módulo. Si alcanza, esto es cuestión de horas; si no, es pantalla nueva y mueve la estimación de la fase.
