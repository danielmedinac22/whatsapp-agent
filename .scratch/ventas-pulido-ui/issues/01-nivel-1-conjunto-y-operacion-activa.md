# 01 — Nivel 1: el conjunto y la operación activa

**What to build:** La decisión de cómo se siente el Panel de Ventas dentro del producto existente y, sobre todo, **cómo se manifiesta en pantalla sobre qué país se está trabajando**.

Se corre con el skill `grilling-frontend-prototyping`: cinco prototipos radicalmente distintos en un solo archivo HTML vivo, selector flotante para alternar, y el veredicto del usuario cierra el nivel.

**Blocked by:** None — can start immediately.

**Status:** resolved — worktree `grill-nivel-1`, sesión con el usuario, 17-ago-2026. Tres rondas de prototipos.

- [x] Cinco variantes vivas del encuadre general, comparables lado a lado.
- [x] Cada variante resuelve de forma distinta la manifestación de la operación activa — no cinco versiones del mismo selector en una esquina.
- [x] Cada variante muestra también **el módulo activo** —Katherine o Sebastián— y deja claro que está **anidado dentro** del país, no al lado.
- [x] El mock alterna entre operación de Guatemala y de Colombia, para verificar que el cambio de contexto **se percibe sin explicarlo**.
- [x] El usuario emite veredicto y queda registrado con su razón.
- [x] Si una variante necesita explicación para entenderse, se descarta.

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

### Decisiones de la ronda 3 — las barras colapsables

Daniel pidió que las barras se puedan colapsar: 294px permanentes de cromo le quitan espacio a la herramienta. **El pedido ataca directo al mecanismo elegido —el tinte vive en las barras—**, así que la ronda decidió qué sobrevive al colapso.

8. **Colapso a riel comprimido de 46px.** Recupera el 84% del espacio y es la única opción que, colapsada, conserva las dos cosas que importan: en qué país estás **y** que existe el otro. Conserva también la navegación por iconos de la pantalla actual. Lo que pierde son los nombres de las pantallas.

   Descartadas: el filo de color de 5px (en tres días es parte del monitor), migrar el indicador al borde superior (manda la señal lejos justo cuando ya no hay barra que la sostenga), y las dos opciones que devuelven menos de la mitad del espacio.

9. **El colapso se recuerda de forma global, y cambiar de operación reexpande las barras.** Es el único momento en que el contexto cambió de verdad y vale interrumpir. **Volver a plegarlas es acto del usuario, nunca automático**: un plegado que se mueve solo es peor que no tenerlo.

10. **El marco ubica; la pantalla confirma.** Colapsado es suficiente para navegar, no para editar. Las pantallas que **escriben** —catálogo y configuración del vendedor— llevan el país en su propio encabezado (`COLOMBIA · CATÁLOGO` sobre el título), así que el colapso queda libre y sin techo: no hace falta prohibirlo en ninguna pantalla, y no cuesta espacio.

### Deuda anotada, fuera de alcance

### Deuda anotada, fuera de alcance

`.app-shell` colapsa a una columna abajo de `lg` y la barra lateral se vuelve barra superior con scroll horizontal: ahí se va la placa del país, que es todo el indicador. El spec excluye diseño móvil salvo que aparezca como necesidad real del asesor, así que queda anotado, no resuelto.

### Hallazgo del ejercicio

**El criterio de aceptación de este ticket se puede aprobar por la razón equivocada.** «El cambio Guatemala ↔ Colombia se percibe sin explicarlo» lo pasan las cinco variantes hoy — pero no por el marco: porque Colombia está vacía y cambia todo el contenido. El día que Colombia opere, dos catálogos con los mismos cuatro nombres REVITALHAIR, y el contenido deja de ayudar. **La prueba válida es Colombia con catálogo lleno**, y por eso el mock permite forzar ese estado. Quien verifique la implementación tiene que usar ese estado, no el fácil.

### El resultado, en una frase

**Riel de operaciones a la izquierda que tiñe la barra con el color del país activo, con el módulo anidado dentro y el número de teléfono junto al color; colapsable a 46px sin perder ni el país ni la navegación.**

### Referencia visual

`prototipos/nivel-1-encuadre.PROTOTIPO.html` — un solo archivo, se actualizó en cada ronda. Cada ronda quedó en su commit:

| Ronda | Qué se comparó | Commit |
|---|---|---|
| 1 | Cinco encuadres radicalmente distintos | `2080fe6` |
| 2 | Hasta dónde llega el tinte, y con qué paleta | `d34ecbc` |
| 3 | Qué sobrevive al colapso de las barras | `a646486` |

El archivo final arranca en la variante elegida y demuestra la reexpansión al cambiar de operación. Son desechables — se archivan como referencia, **no se integran**.

### Qué destraba

El ticket 08 de Operaciones (activar Colombia). El selector ya tiene forma decidida, así que se puede construir y con eso dejan de ser bloqueantes las ocho pantallas que hoy `panelOperation()` haría fallar con dos operaciones activas.

**El nivel 2 queda abierto**: el selector de operación en detalle, el catálogo, la configuración del vendedor y las conversaciones.
