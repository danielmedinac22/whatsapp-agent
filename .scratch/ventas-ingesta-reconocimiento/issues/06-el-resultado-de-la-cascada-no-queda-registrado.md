# 06 — El resultado de la cascada no queda registrado

**What to build:** Que quede escrito **cómo terminó** el reconocimiento de cada
conversación —resuelto, ambiguo, o sin candidatos—, y no solo **qué producto**
resolvió. Hoy solo se guarda el producto, así que «ambiguo» es indistinguible de
«no encontré nada».

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

Levantado el 18-ago-2026 por el worktree `bandejas`, al construir
`ventas-panel/04`. Es un hallazgo de construcción, no una idea: apareció al
intentar cumplir un criterio y descubrir que **no es derivable**.

## Lo medido

`conversations.product_id` (uuid nullable → `products`, puesto por la `0022`)
guarda **el producto que la cascada resolvió**. Es lo único que se persiste del
reconocimiento.

Consecuencia: con `product_id = NULL` hay **tres historias distintas** que la
base cuenta igual:

| Lo que pasó de verdad | Lo que guarda la base |
| -- | -- |
| La cascada devolvió **ambiguo** — varios candidatos, ninguno con confianza | `product_id = NULL` |
| La cascada **no encontró nada** — ningún candidato | `product_id = NULL` |
| La cascada **todavía no corrió** | `product_id = NULL` |

## Qué se rompe por esto, hoy

**`ventas-panel/04` no puede cumplir su segundo criterio** y quedó abierto por
eso: *«Se ve el estado del reconocimiento: resuelto, ambiguo o escalado tras dos
intentos.»* «Resuelto» sí (hay `product_id`) y «escalado» sí (hay hechos de
escalamiento), pero **«ambiguo» no se puede distinguir de «no encontré nada»**.

Y no es un detalle de pantalla. Las dos situaciones piden cosas opuestas del
asesor:

- **Ambiguo** — el sistema sabe de qué familia se habla y no cuál de los cuatro
  REVITALHAIR. El asesor tiene que **desempatar**.
- **Sin candidatos** — el anuncio no está registrado en `product_ads`, o el
  catálogo no tiene ese producto. El asesor tiene que **cargar el anuncio**, que
  es trabajo del panel de catálogo, no del chat.

Mostrar las dos como «sin reconocer» manda al asesor a hacer lo que no es.

## Por qué esto no es duplicado de `05`

`ventas-ingesta-reconocimiento/05` (parcial) define **qué hace Sebastián** ante
un resultado ambiguo: preguntarle al lead con una lista corta acotada a los
candidatos. Este ticket define **que el resultado quede registrado**.

Son distintos y este está **debajo** del otro: sin registrar el resultado, ni la
pregunta con lista corta puede saber cuáles eran los candidatos, ni el panel
puede mostrar el estado. Al construir el 05 conviene mirar este primero.

## Contexto que ya está decidido y no se re-litiga

- **La cascada es fija.** Tres niveles con el ID de anuncio como primario, sin
  perillas configurables (`ventas-ingesta-reconocimiento/02`). Este ticket
  **registra** lo que la cascada decide; no cambia cómo decide.
- **El umbral de similitud es una constante del sistema**, no un campo.
- **En la fila del Inbox, «reconocido» no se muestra**: solo se marcan «ambiguo»
  y «escalado». Marcar todo es no marcar nada
  (`ventas-pulido-ui/02`, `## Answer · Conversaciones`, decisión 3). Así que lo
  que se registre tiene que poder distinguir el caso limpio del que no lo es.
- **El reconocimiento es del primer contacto y se persiste ahí**, porque
  `referral` solo llega en el primer mensaje y nunca en respuestas interactivas.

## Criterios

- [ ] Queda registrado cómo terminó la cascada, distinguiendo al menos
      **resuelto · ambiguo · sin candidatos**.
- [ ] Cuando es **ambiguo**, quedan registrados **cuáles eran los candidatos** —
      sin eso, la pregunta con lista corta de `05` no tiene de dónde sacarla.
- [ ] `ventas-panel/04` puede mostrar el estado sin volver a correr la cascada:
      es un dato leído, no recalculado.
- [ ] El caso real está cubierto por tests: los **cuatro SKUs REVITALHAIR de
      nombre casi idéntico**, que concentran el 77% del volumen y son los que
      motivaron toda la decisión de la cascada.
- [ ] `pnpm -r typecheck` limpio y la suite del worker en verde.
- [ ] **Guatemala no cambia.** Registrar un resultado no puede alterar a quién le
      contesta el sistema ni qué le contesta.

## No-regresión

Escribir un dato nuevo es aditivo por naturaleza, pero **el reconocimiento corre
en el camino de entrada de todo mensaje**, que es el que factura. Un fallo al
persistir no puede tumbar el pipeline: si registrar falla, el mensaje sigue.
Ver `panel-de-ventas/no-regresion.md`.

## Nota de alcance

Este ticket es **registrar el resultado**. Qué hace Sebastián con un resultado
ambiguo es de `05`, y cómo se ve en el chat es de `ventas-panel/04`. Los tres se
pueden construir en este orden y no al revés.
