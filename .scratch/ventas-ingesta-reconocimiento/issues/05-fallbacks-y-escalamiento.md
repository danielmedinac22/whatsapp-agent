# 05 — Fallbacks: semántico, pregunta y escalamiento

**What to build:** Cuando el anuncio no está registrado, el sistema intenta deducir el producto del texto del anuncio. Cuando eso no alcanza —o cuando el anuncio apunta a varios productos— pregunta al lead con una lista corta. Tras dos intentos sin resolver, escala a un asesor en vez de seguir vendiendo a ciegas.

**Blocked by:** 04

**Status:** claimed — worktree `sebastian-persona`, tanda del 17-ago-2026

- [ ] Un anuncio no registrado se resuelve comparando titular y cuerpo contra el catálogo.
- [ ] **Ante candidatos de nombre muy parecido entre sí, el resultado es ambiguo, nunca una elección.** Este es el caso que motivó toda la decisión: la familia de cuatro SKUs casi homónimos concentra la mayoría del volumen.
- [ ] El umbral de similitud es una constante del sistema, no un campo configurable.
- [ ] Un resultado ambiguo produce una pregunta al lead con lista corta acotada a los candidatos.
- [ ] Un mensaje sin referencia de anuncio entra directo a la pregunta.
- [ ] Tras dos rondas de pregunta sin producto identificado, la conversación se marca para asesor.
- [ ] Los tests cubren: anuncio no registrado que el matcher resuelve, anuncio no registrado que queda ambiguo, mensaje sin referencia, catálogo vacío, y el caso real de los cuatro nombres casi idénticos.
