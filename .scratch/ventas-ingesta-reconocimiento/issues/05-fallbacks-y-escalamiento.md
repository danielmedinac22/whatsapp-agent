# 05 — Fallbacks: semántico, pregunta y escalamiento

**What to build:** Cuando el anuncio no está registrado, el sistema intenta deducir el producto del texto del anuncio. Cuando eso no alcanza —o cuando el anuncio apunta a varios productos— pregunta al lead con una lista corta. Tras dos intentos sin resolver, escala a un asesor en vez de seguir vendiendo a ciegas.

**Blocked by:** 04

**Status:** parcial — la pregunta al lead ya sale (worktree `reconocimiento-registrado`, 19-ago-2026). **Falta el matcher semántico, y falta que la respuesta del lead se registre.** Ver el segundo `## Answer`.

- [ ] Un anuncio no registrado se resuelve comparando titular y cuerpo contra el catálogo.
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
