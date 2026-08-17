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
