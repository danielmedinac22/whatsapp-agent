# 01 — Nivel 1: el conjunto y la operación activa

**What to build:** La decisión de cómo se siente el Panel de Ventas dentro del producto existente y, sobre todo, **cómo se manifiesta en pantalla sobre qué país se está trabajando**.

Se corre con el skill `grilling-frontend-prototyping`: cinco prototipos radicalmente distintos en un solo archivo HTML vivo, selector flotante para alternar, y el veredicto del usuario cierra el nivel.

**Blocked by:** None — can start immediately.

**Status:** claimed — worktree `grill-nivel-1`, sesión con el usuario, 17-ago-2026

- [ ] Cinco variantes vivas del encuadre general, comparables lado a lado.
- [ ] Cada variante resuelve de forma distinta la manifestación de la operación activa — no cinco versiones del mismo selector en una esquina.
- [ ] Cada variante muestra también **el módulo activo** —Katherine o Sebastián— y deja claro que está **anidado dentro** del país, no al lado.
- [ ] El mock alterna entre operación de Guatemala y de Colombia, para verificar que el cambio de contexto **se percibe sin explicarlo**.
- [ ] El usuario emite veredicto y queda registrado con su razón.
- [ ] Si una variante necesita explicación para entenderse, se descarta.

**Se corre con el usuario presente.** Un agente que responde sus propias preguntas de diseño no está haciendo el ejercicio.

## Por qué esto pasó a ser bloqueante (17-ago-2026)

El contract de la migración multi-operación dejó el panel usando `panelOperation()`, un puente que **lanza con dos operaciones activas** en vez de resolver a `id = 1` —que *es* Guatemala— en silencio. Es deliberado: fallar ruidosamente antes que editar el país equivocado sin que nadie se entere.

Consecuencia: **ocho pantallas del panel dejan de funcionar el día que Colombia se ponga `active`**, así que el selector de operación **bloquea la apertura de Colombia** (ticket 08 de Operaciones). Esta ronda de prototipos es lo que destraba ese camino.

Crear Colombia en estado `inactive` sigue siendo seguro; activarla sin selector, no.

## Answer

**El marco teñido por operación, con el riel de operaciones del modelo Slack.** Fue la variante 1 de la primera ronda, más el riel que había quedado en la variante 3.

### El veredicto y su razón

Daniel eligió el marco teñido sobre las otras cuatro (17-ago-2026). Su razón, textual:

> «La operación y navegabilidad (UX/UI) es más clara y viene de referentes de la industria que usan el cambio de espacios.»

Es decir: **no ganó por verse mejor, ganó por venir de un patrón probado.** Quien construya las pantallas debería tratar la desviación de ese patrón como el costo real, no como una preferencia estética.

### Los referentes, y qué zanjan

Las cuatro variantes descartadas resolvían la manifestación con una banda superior, rieles sin tinte, tipografía sin selector, y una barra de consecuencias abajo. El patrón elegido tiene tres implementaciones públicas que enfrentaron **el mismo error** —actuar sobre el contexto equivocado sin notarlo—:

- **Slack** — tema por workspace; el switcher los distingue por color. Confina el color a la barra lateral: *«los temas custom pintan solo la barra lateral; el área de mensajes sigue el modo claro/oscuro»*.
- **AWS Console** (*Account Color*, ago-2025) — color por cuenta en **el borde superior de la consola y la pestaña de cuenta**. Justificación publicada: un clic en la cuenta equivocada al saltar entre desarrollo, staging y producción.
- **Stripe** — naranja en prueba, azul en vivo, porque el modo *«es fácil de perder de vista al moverte entre modos»*.

**Los tres confinan el color al cromo y ninguno tiñe el contenido.** De ahí salen las decisiones de abajo.

### Decisiones tomadas

1. **El tinte muere en el borde del marco.** El contenido conserva siempre la paleta neutra. Si `--color-accent-strong` siguiera al país, cada botón primario cambiaría de color y el verde dejaría de significar «confirmado» — justo en Guatemala, donde «confirmado» es el número que factura.
2. **El riel de operaciones va incluido.** Sin él la placa dice dónde estás pero no que existe otro lado; el riel deja Colombia a la vista aunque no se esté usando, que es lo que hace falta el día de la apertura. Es el modelo Slack completo: riel + tinte, no uno de los dos.
3. **Ni Guatemala ni Colombia toman menta, ámbar ni rojo.** Se descartó la escala verde/amarillo/rojo que AWS recomienda: esa codifica **severidad** (dev < test < prod) y los países no están ordenados por peligro, son pares. La asimetría de hoy —Guatemala factura, Colombia está inerte— desaparece el día que Colombia opere, que es exactamente para lo que existe este trabajo. Un color que hay que resignificar después está mal elegido. La menta queda liberada para seguir significando solo «correcto».
4. **El módulo va anidado dentro de la operación**, nunca al lado: primero país, módulo dentro.

### Decisiones de la ronda 2

5. **El tinte se pinta en la barra, no en el borde superior** — el modelo Slack sobre el de AWS. La franja superior de AWS existe porque su consola no tiene barra lateral persistente; el panel sí la tiene, y el color en la barra convive con el acto de navegar, que es cuando uno se equivoca de país. La franja del borde se deja de ver a los diez minutos.
6. **El color no va solo.** Junto al tinte, el **número de teléfono de la operación** en la cabecera de la columna. Es el dato que hace el error irreversible —es lo que le sale al cliente— y protege de que el tinte se vuelva papel tapiz con el uso diario. Se descartó llevar también la moneda y el recuadro: costaba ~70px permanentes.
7. **Violeta para Guatemala, cian para Colombia.** El criterio no fue cuál se ve mejor sino cuál es más difícil de confundir de reojo, y eso lo compra la distancia cromática. El par violeta/rosa se ve más armónico y es el peor para este trabajo. Ninguno de los dos tonos toca menta, ámbar ni rojo.

### Abierto, y va a la ronda siguiente

- **Las barras tienen que poder colapsarse** — requisito de Daniel (17-ago-2026): riel de 78px + columna de 216px son 294px permanentes de cromo, y le quitan espacio de trabajo a la herramienta.

  **Esto ataca directo al mecanismo elegido: el tinte vive en las barras, así que colapsarlas apaga el indicador** — y justo en el modo en que se pasa más tiempo. La ronda 3 decide qué sobrevive al colapso; sin esa respuesta la decisión de arriba queda incompleta.

### Deuda anotada, fuera de alcance

`.app-shell` colapsa a una columna abajo de `lg` y la barra lateral se vuelve barra superior con scroll horizontal: ahí se va la placa del país, que es todo el indicador. El spec excluye diseño móvil salvo que aparezca como necesidad real del asesor, así que queda anotado, no resuelto.

### Hallazgo del ejercicio

**El criterio de aceptación de este ticket se puede aprobar por la razón equivocada.** «El cambio Guatemala ↔ Colombia se percibe sin explicarlo» lo pasan las cinco variantes hoy — pero no por el marco: porque Colombia está vacía y cambia todo el contenido. El día que Colombia opere, dos catálogos con los mismos cuatro nombres REVITALHAIR, y el contenido deja de ayudar. **La prueba válida es Colombia con catálogo lleno**, y por eso el mock permite forzar ese estado. Quien verifique la implementación tiene que usar ese estado, no el fácil.

### Referencia visual

Prototipos en `prototipos/nivel-1-encuadre.PROTOTIPO.html` (primera ronda: commit `2080fe6`). Son desechables — se archivan como referencia, no se integran.
