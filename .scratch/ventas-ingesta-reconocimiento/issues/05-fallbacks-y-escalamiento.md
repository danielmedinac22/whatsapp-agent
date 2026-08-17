# 05 — Fallbacks: semántico, pregunta y escalamiento

**What to build:** Cuando el anuncio no está registrado, el sistema intenta deducir el producto del texto del anuncio. Cuando eso no alcanza —o cuando el anuncio apunta a varios productos— pregunta al lead con una lista corta. Tras dos intentos sin resolver, escala a un asesor en vez de seguir vendiendo a ciegas.

**Blocked by:** 04

**Status:** claimed — worktree `sebastian-persona`, tanda del 17-ago-2026

- [ ] Un anuncio no registrado se resuelve comparando titular y cuerpo contra el catálogo.
- [ ] **Ante candidatos de nombre muy parecido entre sí, el resultado es ambiguo, nunca una elección.** Este es el caso que motivó toda la decisión: la familia de cuatro SKUs casi homónimos concentra la mayoría del volumen.
- [ ] El umbral de similitud es una constante del sistema, no un campo configurable.
- [ ] Un resultado ambiguo produce una pregunta al lead con lista corta acotada a los candidatos.
- [ ] Un mensaje sin referencia de anuncio entra directo a la pregunta.
- [x] Tras dos rondas de pregunta sin producto identificado, la conversación se marca para asesor.
- [ ] Los tests cubren: anuncio no registrado que el matcher resuelve, anuncio no registrado que queda ambiguo, mensaje sin referencia, catálogo vacío, y el caso real de los cuatro nombres casi idénticos.

## Answer — solo la mitad del escalamiento (17-ago-2026, worktree `sebastian-persona`)

De este ticket, el worktree `sebastian-persona` tomó **una sola casilla**: la del escalamiento, que es la otra mitad de `ventas-conversacion/04`. Lo demás —el matcher semántico, la lista corta de la pregunta, el catálogo vacío— es de la cascada de `sales/recognition.ts` y de quien orquesta la pregunta, y **no se tocó**: ese archivo es de otro worktree y ya tiene sus 17 tests.

**Cómo quedó.** El disparador `product_unidentified` de `sales/escalation-triggers.ts`, con `MAX_PRODUCT_ATTEMPTS = 2` como **constante del sistema** —igual criterio que el umbral de confianza del reconocimiento: cada perilla es superficie de falla y soporte no cotizado—. Escala cuando el producto sigue sin identificar y ya se procesaron dos turnos del lead; con uno todavía se pregunta.

**Los intentos se cuentan sin columna nueva.** `sales/escalation-facts.ts` cuenta los turnos entrantes del lead **desde `conversations.ad_referral_at`**, no desde el principio de la conversación: hay una conversación por contacto para siempre, así que un recomprador arrastra meses de postventa y contarlos escalaría la venta de hoy antes de que Sebastián diga una palabra. Sin clic de anuncio —un lead orgánico— se mira la conversación entera, que por definición empieza ahí. Si el producto estuviera identificado, el disparador ni se evalúa.

Tests: cuatro casos en `sales/escalation-triggers.test.ts` — escala al segundo intento, no escala al primero, no escala con el producto ya identificado (aunque haya cinco intentos previos), y la petición explícita de humano gana sobre este cuando concurren.
