# 06 — El resultado de la cascada no queda registrado

**What to build:** Que quede escrito **cómo terminó** el reconocimiento de cada
conversación —resuelto, ambiguo, o sin candidatos—, y no solo **qué producto**
resolvió. Hoy solo se guarda el producto, así que «ambiguo» es indistinguible de
«no encontré nada».

**Blocked by:** None — can start immediately.

**Status:** resolved — worktree `reconocimiento-registrado`, 19-ago-2026. Migración `0026`,
sin aplicar todavía: la aplica la sesión coordinadora.

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

- [x] Queda registrado cómo terminó la cascada, distinguiendo al menos
      **resuelto · ambiguo · sin candidatos**.
- [x] Cuando es **ambiguo**, quedan registrados **cuáles eran los candidatos** —
      sin eso, la pregunta con lista corta de `05` no tiene de dónde sacarla.
- [x] `ventas-panel/04` puede mostrar el estado sin volver a correr la cascada:
      es un dato leído, no recalculado.
- [x] El caso real está cubierto por tests: los **cuatro SKUs REVITALHAIR de
      nombre casi idéntico**, que concentran el 77% del volumen y son los que
      motivaron toda la decisión de la cascada.
- [x] `pnpm -r typecheck` limpio y la suite del worker en verde.
- [x] **Guatemala no cambia.** Registrar un resultado no puede alterar a quién le
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

## Answer — la conversación ahora dice cómo terminó, y entre qué dudó

### Lo que cambia para el asesor

Antes, una conversación que llegaba por un anuncio y se quedaba sin producto se
veía siempre igual: **«sin producto»**. Daba lo mismo que el vendedor hubiera
encontrado cuatro candidatos y no supiera cuál, o que no hubiera encontrado
ninguno. Son dos trabajos distintos y la bandeja mandaba a hacer el que no era.

Ahora son dos marcas distintas en la fila:

- **«ambiguo»** (azul, con un interrogante) — el anuncio apunta a varios
  productos y hay que **desempatar ahí mismo, en el chat**.
- **«sin producto»** (ámbar, con un triángulo) — no hubo ni un candidato: el
  anuncio no está cargado en el catálogo, y eso se arregla en **otra pantalla**.

Y dentro del chat, la línea del hilo dice entre qué dudó, con nombre y apellido:

> *Sebastián dudó entre REVITALHAIR - DHT ANTICALVICIE · REVITALHAIR - DHT
> BLOCKER ANTICALVICIE · REVITALHAIR COMBO DHT + SERUM ANTICALVICIE 360 · Hair
> Recovery 3X - COMBO RECUPERACION CAPILAR TOTAL · anuncio 120210000000000002*

Eso es lo que el asesor necesita para desempatar sin abrir nada más, y es
exactamente lo que antes no constaba en ninguna parte.

### Lo que quedó escrito, y por qué así

**Dos columnas en la conversación, migración `0026`:** cómo terminó la cascada
—con **su propio vocabulario**, `resolved` · `ambiguous` · `unknown`— y, cuando
dudó, **la lista de candidatos**. Sin valor sigue significando la tercera
historia, la única que no es un resultado: **la cascada todavía no corrió**, que
es el estado de las 1.736 conversaciones de hoy y de toda conversación que no
llegue por un anuncio.

**No se inventó un vocabulario nuevo.** Guardar «ambiguo» en español al lado de
un código que dice `ambiguous` sería tener dos listas que alguien tiene que
mantener de acuerdo; la que se olvida es la que después miente en pantalla.

**Los candidatos se guardan por identificador, no por nombre.** El nombre de un
producto conectado a la tienda vive en Shopify y se lee cuando hace falta —así
se decidió el catálogo—, de modo que copiarlo aquí sería guardar una copia que
envejece sola. Al leer se resuelve contra el catálogo de la operación: un
candidato borrado se cae de la lista, igual que ya pasa con el producto resuelto.

**La base impide los estados que no significan nada.** Un cuarto resultado
inventado por otra vía no entra, y «ambiguo» sin candidatos tampoco: sería una
pantalla que no puede decir entre qué dudó y una pregunta al lead sin lista que
ofrecerle. Se ensayó contra una base desechable y ahí apareció una trampa de SQL
que leyendo no se ve —**una condición que da «no sé» deja pasar la fila**—, así
que la regla está escrita para que la duda cuente como prohibición.

**Un producto ya resuelto sigue mandando.** Hay una conversación por contacto
para siempre: si un recomprador hace clic en un anuncio nuevo que el sistema no
sabe reconocer, se anota que no supo, **pero no se le borra el producto que esa
persona sí compró**. Perder un dato cierto por culpa de uno incierto sería peor
que no anotar nada.

### Guatemala no cambia, y se comprobó ejecutando

Registrar un dato no altera a quién le contesta el sistema ni qué le contesta.
Además el reconocimiento **solo corre cuando el mensaje trae referencia de
anuncio**, y en Guatemala eso no ha pasado ni una vez: cero conversaciones con
anuncio, medido el 18-ago-2026. Con el vendedor sin configurar —el estado de
producción— el panel se ve exactamente igual que antes: se levantó una base
desechable, se cargó el caso difícil y se pidió la pantalla con y sin vendedor;
sin vendedor no aparece ni una marca ni una línea de hilo nueva.

**Y si registrar falla, el mensaje del cliente sigue su curso.** Es la regla que
más importa, porque esto corre en el camino de entrada de todo mensaje —el que
factura—: la escritura no puede lanzar hacia arriba y no lanza; deja el error en
el log, la conversación queda diciendo «no corrió» —que es el estado que hace
que el vendedor pregunte— y el mensaje continúa. Tiene test propio, con la
escritura fallando de las dos formas posibles.

### Cómo se probó

- **La cascada real contra una base de ensayo**, con los cuatro nombres
  REVITALHAIR cargados y un anuncio apuntando a los cuatro: queda ambigua con
  los cuatro candidatos en su orden; un anuncio que nadie registró queda en «sin
  candidatos»; y un anuncio de un solo producto resuelve **y limpia los
  candidatos anteriores**.
- **La migración se ensayó de verdad**: base limpia, las 26 migraciones en
  orden, filas con la forma de producción, y después la `0026` encima. El
  relleno de las filas existentes hace lo que dice y los dos candados rechazan
  lo que tienen que rechazar.
- **La pantalla se miró con datos**, no vacía: las dos marcas salen en la
  bandeja y el hilo cuenta los cuatro nombres.
- 521 pruebas en 33 archivos, verdes; los cuatro paquetes compilan.

### Lo que este ticket **no** hizo

- **No tocó la cascada.** No hay perillas nuevas, ni umbrales, ni niveles: se
  registra lo que decide, no se cambia cómo decide.
- **No inventó una fecha del reconocimiento.** Se sigue fechando con el clic del
  anuncio, que es el instante que sí consta.
- **No guarda por qué no encontró nada** (anuncio sin registrar, catálogo vacío,
  copy recortado). Las tres piden lo mismo del asesor —cargar el anuncio— y la
  distinción vive en el log, que es donde sirve.
