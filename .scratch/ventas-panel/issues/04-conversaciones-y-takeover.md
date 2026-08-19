# 04 — Contexto de venta en el chat, y tomar el vendedor

**What to build:** Cuando un asesor abre una conversación en el módulo de ventas, entiende de dónde viene sin preguntar: qué anuncio la trajo, qué producto se reconoció y si el reconocimiento quedó limpio o dudoso. Y puede **tomar el chat al vendedor** —lo que lo pausa para esa conversación— y devolvérselo cuando termina.

**Blocked by:** ventas-modulos-y-ruteo 03 · Bandejas separadas por módulo

**Status:** abierto — cinco de seis criterios mergeados y desplegados. Falta distinguir «ambiguo», que **no es derivable** hoy: lo destraba [ingesta-reconocimiento 06](../../ventas-ingesta-reconocimiento/issues/06-el-resultado-de-la-cascada-no-queda-registrado.md)

- [x] Al abrir un chat se ve **de qué anuncio y de qué producto** viene la conversación.
- [ ] Se ve el **estado del reconocimiento**: resuelto, ambiguo o escalado tras dos intentos. *(«resuelto» y «escalado» sí; «ambiguo» no se puede distinguir de «no encontré nada» sin persistir el resultado de la cascada.)*
- [x] **Tomar el chat pausa al vendedor solo para esa conversación**, nunca globalmente.
- [x] Devolver el chat lo reactiva y el vendedor retoma con el historial completo.
- [x] Tomar el chat comunica inequívocamente que el vendedor quedó pausado, para que nadie escriba encima de él.
- [x] El flujo de conversaciones de confirmación no cambia en nada.

**Qué NO construye este ticket.** La bandeja en sí —qué conversaciones aparecen, la separación por módulo, el historial completo y la distinción visual de las escaladas— la construye *ventas-modulos-y-ruteo 03*. Acá solo va el contexto de venta dentro del chat y el control sobre el agente.

**Y no confundir con la asignación.** Tomar el chat **al vendedor** pausa al agente. Asignarse la conversación —«la estoy trabajando yo»— es otra cosa, va en *ventas-modulos-y-ruteo 04*, y son independientes: se puede estar asignado sin haber pausado al vendedor.

**Nota de esfuerzo:** conviene decidir temprano si el inbox existente se puede filtrar por conexión y por módulo. Si alcanza, esto es cuestión de horas; si no, es pantalla nueva y mueve la estimación de la fase.

## Answer — el contexto se narra en el hilo, y «tomar el chat» ya existía

### Lo que no se construyó, y por qué eso es lo correcto

**«Tomar el chat» desapareció como concepto.** El control es `Agente: ON/OFF`,
el botón que el panel tiene en producción desde antes de este mapa, y que hace
exactamente lo que el ticket pide: apaga `contacts.agent_mode` **de ese
contacto**, nunca globalmente, y encenderlo lo devuelve con el historial entero
porque el historial nunca se movió. Que quedó pausado lo dice la etiqueta que ya
estaba: *«Respuesta manual»* frente a *«Automatización activa»*.

Los tres criterios de tomar y devolver estaban resueltos antes de empezar. Lo que
este ticket hizo con ellos fue **no romperlos y no renombrarlos**: la primera
ronda de prototipos inventó «tomar el chat» y «vendedor pausado» encima de eso y
se rechazó entera. No hay término nuevo en la rama para estos actos.

### Lo que sí se construyó: los eventos del hilo

El contexto de venta **no es un panel**, es una línea fechada entre los mensajes:

> *Sebastián reconoció REVITALHAIR – DHT ANTICALVICIE · anuncio 23851094782*
> *Sebastián no logró identificar el producto · anuncio 23851094999*
> *Sebastián escaló tras dos intentos sin identificar el producto*

El producto y el anuncio no son atributos que se consulten: son algo que pasó en
un momento del chat. El evento de reconocimiento se fecha con `ad_referral_at`
—el clic— porque **el reconocimiento no tiene fecha propia en el esquema**, y
fecharlo con el clic lo deja en el sitio correcto sin inventar un instante.

**Y va en las dos bandejas**, no solo en la de ventas: el criterio del ticket 03
manda —operaciones necesita saber qué le prometieron al cliente— y está
verificado con una conversación que empezó como lead y hoy está en operaciones.

### El hallazgo: la escalada solo sobrevive en la clave de deduplicación

No hay tabla de escaladas. `escalateToHuman` apaga el modo agente, encola el
aviso al cliente y el ping al admin, y **no escribe ninguna fila que diga por
qué**. Lo único que queda con fecha y motivo es
`outbound_messages.dedup_key = escalation-customer-<contacto>-<motivo>-<hora>`.

De ahí se lee, con un corte **posicional y no contra una lista de motivos**: el
vocabulario es del worker y una copia en el panel envejecería en silencio el día
que gane un motivo. Un motivo desconocido sale tal cual y la pantalla lo nombra.

Dos consecuencias que conviene saber:

- Las escaladas **sin aviso al cliente** (`manual` y `agent_request`) no dejan
  rastro fechado en ninguna parte y por eso no se cuentan. Preferimos no
  mostrarlas a inventarles una fecha.
- Solo los motivos `sales_*` llevan el nombre del vendedor. El de audio es del
  agente que confirma y existe desde mucho antes que este módulo: contarlo como
  «Sebastián escaló» sería ponerle su nombre a una decisión que no tomó.

### El criterio que queda abierto: «ambiguo» no es derivable hoy

El ticket pide distinguir **resuelto / ambiguo / escalado tras dos intentos**. De
los tres, el esquema solo permite dos.

`apps/worker/src/sales/recognition.ts` devuelve tres formas —`resolved`,
`ambiguous` con la lista de candidatos, y `unknown`— y **ninguna se persiste**:
lo único que se escribe es `conversations.product_id`. Así que «el matcher dudó
entre cuatro REVITALHAIR» y «el matcher no encontró nada» dejan exactamente la
misma huella: un `product_id` en `null`. Llamarle «ambiguo» a eso sería afirmar
más de lo que consta.

Por eso la fila y el hilo dicen **«sin producto» / «no logró identificar el
producto»**, que es lo que de verdad se sabe, y que además es como el propio
worker ya lo nombra (`sales_product_unidentified`: *«dos intentos sin lograr
identificar de qué producto habla»*).

**Qué falta para cerrarlo:** persistir el resultado de la cascada —la forma y,
si es ambigua, los candidatos—. Es una columna nueva en `conversations`, y este
encargo tenía prohibido generar migración. Es un ticket propio, y quien lo tome
tiene que decidir además si los candidatos se guardan (que es lo que permitiría
mostrar *«dudó entre estos tres»*, que es la información útil de verdad).

### Un desacuerdo con el prototipo, dicho para que se decida y no se olvide

`prototipos/nivel-2-conversaciones.PROTOTIPO.html` tiene marcada como **ELEGIDA**
la variante 1 (`S`), que lleva **un tercer panel con pestañas** (Cliente ·
Pedidos · Contexto) y una barra de recorrido. El `## Answer · Conversaciones` del
nivel 2 dice lo contrario con todas las letras: *«se descartó el tercer panel de
contexto»*.

Se implementó **sin el tercer panel**, siguiendo el Answer, porque es lo que el
encargo lista como criterio. Si el panel de ficha sigue en pie, es trabajo
distinto y de otra ronda — no un olvido de esta.
