# 05 — Fallbacks: semántico, pregunta y escalamiento

**What to build:** Cuando el anuncio no está registrado, el sistema intenta deducir el producto del texto del anuncio. Cuando eso no alcanza —o cuando el anuncio apunta a varios productos— pregunta al lead con una lista corta. Tras dos intentos sin resolver, escala a un asesor en vez de seguir vendiendo a ciegas.

**Blocked by:** 04

**Status:** resolved — ola 4 del 19-ago-2026, mergeado y desplegado. Los siete criterios cumplidos; el matcher semántico fue el último

- [x] Un anuncio no registrado se resuelve comparando titular y cuerpo contra el catálogo.
- [x] **Ante candidatos de nombre muy parecido entre sí, el resultado es ambiguo, nunca una elección.** Este es el caso que motivó toda la decisión: la familia de cuatro SKUs casi homónimos concentra la mayoría del volumen.
- [x] El umbral de similitud es una constante del sistema, no un campo configurable.
- [x] Un resultado ambiguo produce una pregunta al lead con lista corta acotada a los candidatos.
- [x] Un mensaje sin referencia de anuncio entra directo a la pregunta.
- [x] Tras dos rondas de pregunta sin producto identificado, la conversación se marca para asesor.
- [x] Los tests cubren: anuncio no registrado que el matcher resuelve, anuncio no registrado que queda ambiguo, mensaje sin referencia, catálogo vacío, y el caso real de los cuatro nombres casi idénticos.

## Answer — solo la mitad del escalamiento (17-ago-2026, worktree `sebastian-persona`)

De este ticket, el worktree `sebastian-persona` tomó **una sola casilla**: la del escalamiento, que es la otra mitad de `ventas-conversacion/04`. Lo demás —el matcher semántico, la lista corta de la pregunta, el catálogo vacío— es de la cascada de `sales/recognition.ts` y de quien orquesta la pregunta, y **no se tocó**: ese archivo es de otro worktree y ya tiene sus 17 tests.

**Cómo quedó.** El disparador `product_unidentified` de `sales/escalation-triggers.ts`, con `MAX_PRODUCT_ATTEMPTS = 2` como **constante del sistema** —igual criterio que el umbral de confianza del reconocimiento: cada perilla es superficie de falla y soporte no cotizado—. Escala cuando el producto sigue sin identificar y ya se procesaron dos turnos del lead; con uno todavía se pregunta.

**Los intentos se cuentan sin columna nueva.** `sales/escalation-facts.ts` cuenta los turnos entrantes del lead **desde `conversations.ad_referral_at`**, no desde el principio de la conversación: hay una conversación por contacto para siempre, así que un recomprador arrastra meses de postventa y contarlos escalaría la venta de hoy antes de que Sebastián diga una palabra. Sin clic de anuncio —un lead orgánico— se mira la conversación entera, que por definición empieza ahí. Si el producto estuviera identificado, el disparador ni se evalúa.

Tests: cuatro casos en `sales/escalation-triggers.test.ts` — escala al segundo intento, no escala al primero, no escala con el producto ya identificado (aunque haya cinco intentos previos), y la petición explícita de humano gana sobre este cuando concurren.

## Answer — la pregunta ya sale, acotada a los candidatos (19-ago-2026, worktree `reconocimiento-registrado`)

**Lo que faltaba para poder construirla no era la pregunta: era saber a quién
preguntarle.** Hasta la migración `0026`, cuando la cascada dudaba entre varios
productos ese resultado no se guardaba en ninguna parte, así que lo único que se
podía ofrecerle al lead era el catálogo entero — que en Vorare son los cuatro
REVITALHAIR más todo lo demás. Por eso el ticket 06 iba primero.

### Cómo pregunta ahora

Cuando la conversación **no tiene producto identificado**, al vendedor se le pega
un bloque de contexto —el mismo mecanismo con el que ya recibe la ficha del
producto cuando sí lo sabe— que le dice que pregunte antes de hablar de precio,
características o disponibilidad. Con dos formas:

- **Con lista corta**, cuando los candidatos registrados se pueden nombrar todos
  y son entre dos y cinco: se los nombra tal cual, y se le prohíbe ofrecer
  cualquier cosa que no esté en esa lista y elegir él «el más probable».
- **Abierta**, en cualquier otro caso: un lead que llegó sin anuncio, un anuncio
  que no está en el catálogo, o un anuncio mal registrado que apunta a más
  productos de los que caben en un mensaje de WhatsApp.

**Una lista incompleta cae a la pregunta abierta**, y eso es deliberado:
ofrecerle al lead tres de los cuatro candidatos es empujarlo a elegir entre esos
tres, o sea elegir por él con pasos de más — la única cosa que toda esta cascada
existe para no hacer. Si no se pueden nombrar todos, no se nombra ninguno.

**No es un mensaje aparte, es el turno de siempre.** Sebastián ya escribe cada
turno; darle una segunda vía de salida sería un mensaje suyo cruzándose con otro
suyo en el mismo hilo. Pregunta con sus palabras y su tono.

**Cinco es una constante del sistema, no un campo del panel**, igual que el
umbral de confianza y los dos intentos del escalamiento.

### Las tres casillas que se marcaron sin construir nada

La cascada ya cumplía tres criterios de este ticket desde el 17-ago y nadie las
había marcado: que ante nombres casi idénticos el resultado sea **ambiguo y
nunca una elección**, que el umbral sea **constante del sistema**, y que los
tests cubran los cinco casos —incluido el de los cuatro REVITALHAIR—. Se
verificaron contra el código y contra la suite; no se tocó `recognition.ts`.

### Lo que falta, y es lo que deja este ticket abierto

**1 · El matcher semántico sigue sin cablear.** El nivel 2 de la cascada —deducir
el producto del titular y el cuerpo del anuncio— tiene su hueco declarado
(`SEMANTIC_LEVEL_WIRED = false`) y devuelve cero candidatos. Hoy la ambigüedad
solo puede nacer del nivel 1: un anuncio que el admin registró apuntando a
varios productos. Es la primera casilla y no se tocó.

**2 · La respuesta del lead no se registra, y esto conviene leerlo entero.** El
vendedor pregunta, el lead contesta «el combo», y **el sistema no escribe ese
producto en la conversación**: nada convierte una respuesta en un producto
identificado. La consecuencia es concreta y hay que decirla: en el segundo turno
del lead se cumple la condición de escalamiento —dos turnos sin producto
identificado— y **la conversación pasa a un asesor**.

Eso no es un accidente del diseño, es el diseño: *«una pregunta, una respuesta
que no resuelve, y a un humano»*. Pero con el registro de la respuesta sin
construir, **siempre** termina en un humano, y el asesor recibe la conversación
con la respuesta del cliente ya escrita en el hilo. Sirve —nadie queda sin
atender y el asesor ve todo—, y aun así no es lo que este ticket promete.

Cerrarlo pide decidir algo que no es de escritorio: qué cuenta como que el lead
eligió. Entre cuatro nombres que comparten las palabras «DHT» y «ANTICALVICIE»,
una respuesta como «el anticalvicie» no elige nada, y resolver a uno ahí sería
mandarle al cliente el SKU equivocado — exactamente lo que la cascada se niega a
hacer con el copy del anuncio. Es un ticket propio y no un remate de este.

**Lo que sí queda listo para quien lo tome:** los candidatos están registrados y
en orden, y hay una función pura que los lee y arma la lista.

## Answer — el nivel 2 ya corre, y sobre la familia se niega a elegir (19-ago-2026, worktree `matcher-semantico`)

**Qué cambia para la operación.** Hasta hoy, un anuncio que el admin no había
cargado en el catálogo no producía nada: el sistema anotaba «no encontré» y
Sebastián preguntaba a ciegas. Ahora ese anuncio se lee —su titular y su
cuerpo— y se compara contra los nombres del catálogo, con tres finales posibles:

- **Se resuelve**, si el anuncio habla de un producto que se distingue del
  resto. Medido contra el catálogo de ensayo: un anuncio de «Kit Barba Vorare»
  que nadie registró queda resuelto a ese producto, y Sebastián arranca con la
  ficha en la mano.
- **Queda ambiguo con su lista**, si el anuncio toca varios productos que no se
  distinguen entre sí. Sebastián pregunta nombrándolos, y no puede ofrecer
  ninguno de fuera de esa lista.
- **Queda desconocido**, si el anuncio no nombra nada del catálogo. Sebastián
  pregunta abierto, igual que ayer.

### Sobre los cuatro REVITALHAIR dice *ambiguo*, y no por casualidad

Es el caso que motivó toda la cascada y el 77% del volumen. **No alcanza con
que el matcher no elija por ahora: tiene que no poder elegir.** Dos mecanismos
lo vuelven imposible de escribir:

1. **Todos los candidatos salen con la misma confianza.** No hay un número por
   candidato que alguien pueda ordenar y cortar por el primero. Que un nombre
   quede un poco mejor cubierto que otro es ruido —el anuncio es prosa de venta
   y el nombre del catálogo es una cadena de SKU—, y ese ruido no puede volverse
   una decisión.
2. **La duda se contagia por el catálogo, no por el anuncio.** Si dos nombres
   son indistinguibles entre sí, ningún texto puede separarlos: cuando uno entra
   como candidato entran todos los suyos. Por eso un anuncio que dice
   literalmente «REVITALHAIR DHT ANTICALVICIE» arrastra igual al BLOCKER y al
   COMBO 360 — el nombre del primero está entero dentro del de los otros, así
   que toda evidencia que sostiene a uno sostiene al otro.

Verificado contra una base de ensayo con el catálogo real cargado: un anuncio
capilar genérico no registrado deja la conversación en *ambiguo* con **los
cuatro** nombres reales, y la pregunta al lead sale con esos cuatro y nada más.

### Por qué léxico y no el modelo, con las tres razones medidas

Se consideró pedirle el match al modelo que ya está configurado y se descartó:

1. **No hay con qué verificar que acierte.** Hoy en producción hay 0 productos,
   0 anuncios registrados y 0 conversaciones con anuncio: no existe un solo caso
   real contra el cual medir. Lo único medible son los nombres del catálogo, y
   sobre ellos este matcher se prueba entero en cada corrida de la suite.
2. **A un modelo se le pregunta «cuál» y contesta «cuál».** Sobre esta familia
   eso es mandarle al cliente el SKU equivocado. Acá la elección no depende de
   cómo salga redactado un prompt: es imposible de expresar.
3. **Corre en el camino que factura.** El reconocimiento se espera antes de que
   Sebastián conteste. Medido punta a punta contra la base de ensayo —consultas
   incluidas— tarda **entre 0,7 y 9 ms**. Una llamada al proveedor le sumaría
   segundos al primer turno del lead.

El costo se midió antes de decidir y **no es el argumento**: una llamada extra
rondaría los USD 0,001 por lead con anuncio no registrado, contra los USD
0,017–0,023 que ya cuesta la conversación. No compra nada que 1–3 no descarten.

Se descartó también usar la **descripción** del producto como evidencia: la
escribe el admin para el vendedor, su largo varía muchísimo de un producto a
otro, y medir cobertura sobre texto largo castigaría justo a los productos mejor
documentados.

### Las tres constantes, y dónde viven

Ninguna es campo del panel, y el panel no expone perilla alguna sobre la
cascada: se verificó que no hay ni columna ni pantalla que las toque.

| Constante | Valor | De dónde sale |
| -- | -- | -- |
| Umbral de confianza de la cascada | 0,8 | ya existía |
| Cuánto del nombre tiene que nombrar el anuncio | 0,35 | medido: la familia cubre 0,617 · 0,463 · 0,308 · 0,407 con un anuncio capilar, y un anuncio de «combo … total» cubre 0,286 sin hablar del producto. El corte vive en ese hueco. |
| Cuándo dos nombres son indistinguibles | 0,55 | medido: los tres que son el mismo producto con otro nombre dan 0,778 · 0,636 · 0,636; el cuarto contra ellos da 0,286, y el resto del catálogo menos de 0,25. |

**Hay que decir una consecuencia:** como el matcher entrega una sola confianza
para todos sus candidatos, el punto de ajuste de este nivel deja de ser el
umbral de la cascada y pasa a ser el 0,35 de cobertura. Los dos son constantes
del código, así que la regla del ticket se sigue cumpliendo; lo que cambia es
dónde se toca el día que haya datos que digan que hay que tocarlo.

### Lo que no puede costarle el mensaje al cliente

El matcher es **puro y sin red**: no llama a ningún modelo y no puede colgarse.
La única llamada de red que agrega el nivel 2 es preguntarle a la tienda el
nombre de los productos conectados —que en la base no lo tienen a propósito—, y
esa llamada:

- **solo ocurre si el anuncio no está registrado**, así que el camino común no
  paga nada;
- **tiene plazo de 2 segundos**, y al vencer se sigue sin esos nombres;
- **si falla, el nivel entero devuelve cero candidatos** en vez de lanzar, para
  que la conversación quede diciendo *desconocido* —que es la pregunta abierta—
  y no «todavía no corrió», que es lo que quedaría si la excepción subiera.

**Con el catálogo vacío —que es producción hoy— no cambia nada**: la cascada
responde *desconocido* sin consultar al matcher. Verificado contra la base de
ensayo con la tabla en cero.

### Un límite medido, y cómo se arregla

El matcher compara **palabras, no significados**. Un anuncio capilar que no
nombre ninguna palabra del catálogo —«¿Se te cae el cabello? Recupéralo con el
tratamiento natural»— queda *desconocido* y Sebastián pregunta abierto. Es la
dirección segura del error, y la forma de resolverlo no es afinar el matcher:
es **registrar ese anuncio en el catálogo**, que es el nivel 1 y siempre gana.

### Se retiró una bandera

`SEMANTIC_LEVEL_WIRED` existía para que el log dijera que el nivel 2 no estaba
cableado. Ya lo está, así que se quitó junto con el campo que imprimía. Desde
hoy un *desconocido* en el log significa lo que dice: **el matcher miró el
anuncio y no supo**.

### Lo que sigue faltando, y no es de este ticket

**La respuesta del lead no se registra.** Sebastián pregunta, el lead contesta
«el combo», y nada escribe ese producto en la conversación; en el segundo turno
se cumple la condición de escalamiento y la conversación pasa a un asesor. La
sesión anterior ya lo dejó dicho y ya lo declaró ticket propio: decidir qué
cuenta como que el lead eligió no es cosa de escritorio cuando cuatro nombres
comparten las palabras «DHT» y «ANTICALVICIE». Por eso este ticket queda
**parcial** aunque sus siete criterios estén marcados.
