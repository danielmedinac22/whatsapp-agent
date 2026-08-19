# 05 — El estado del reporte de conversiones, en el panel

**What to build:** Que un admin pueda ver si las ventas le están volviendo a Meta
—y cuáles no— sin pedirle a nadie que corra un comando.

**Blocked by:** 03 · Envío asíncrono con reintentos

**Status:** claimed — worktree `cierre-final`, 19-ago-2026

Levantado el 19-ago-2026 al cerrar la ola 4. El worker del ticket 03 quedó
construido, desplegado y con su estado consultable por `GET /api/capi/estado`,
pero **no hay nada en el panel**: `apps/web` no era del worktree que lo
construyó, y lo dejó dicho.

## Por qué esto no es cosmético

Es la regla del proyecto de que **un ticket resuelto que el operador no puede
usar no está resuelto**. Y acá pesa más que de costumbre, por dos razones que ya
están registradas:

1. **El reporte a Meta puede estar muerto y verse sano.** Es el hallazgo del
   nivel 3 del árbol de diseño sobre la variante elegida para registrar anuncios:
   se registran los anuncios, la pantalla se ve completa y correcta, y **no pasa
   nada** si la referencia del anuncio nunca llega. Sin una señal explícita,
   nadie se entera hasta preguntarse por qué la pauta no aprende.
2. **Hay dos estados que sólo un humano puede resolver**, y el ticket 03 los dejó
   consultables justamente para eso:
   - **`pending` viejo** — una conversión que se escribió antes de llamar y cuyo
     proceso se murió en el medio. **No se reintenta sola a propósito**: hacerlo
     reintroduce el duplicado que toda esa arquitectura existe para evitar. Es
     una venta que Meta nunca supo, y alguien tiene que decidir.
   - **`unconfirmed`** — la petición salió y nunca se supo si llegó. Lo único que
     puede resolverlo es el administrador de eventos de Meta, que es el ticket
     `ventas-capi/04`. Cada fila trae `dataset`, `event_time` y valor, que son
     las tres cosas con las que se busca allá.

## Lo que ya existe y no rehacés

- `GET /api/capi/estado` en el worker, que ya contesta con el veredicto
  (`blocked` / `failing` / lo que corresponda), los `pending` viejos **listados**
  —no contados—, y los `unconfirmed` con sus tres datos de búsqueda.
- La tabla `capi_conversions` (migración `0027`, aplicada) con `status`
  (`pending` · `sent` · `failed` · `unconfirmed`), `attempts`, `last_error`,
  `event_time`, `value`, `currency`.
- El interruptor por entorno: `META_CAPI_MODE` (`off` \| `test` \| `live`),
  arranca en `off`. **Hoy en producción el estado contesta `blocked`**, porque
  falta el token de usuario de sistema.

## Lo que hay que respetar de lo ya decidido

- **La pantalla va dentro de la operación**, como todo el panel: primero país,
  módulo dentro.
- **El marco ubica; la pantalla confirma** — si escribe o si muestra algo que
  depende del país, lleva el país en su propio encabezado.
- **No inventes vocabulario.** Si el panel ya nombra algo, se llama igual.
- El estado normal hoy es **«sin conectar»**, y tiene que ser una pantalla
  honesta y esperada, no un error.

## Criterios

- [ ] Un admin ve si el reporte de conversiones está encendido, apagado o
      bloqueado, y **por qué**.
- [ ] Ve las conversiones que **no llegaron**, con su motivo.
- [ ] Los `pending` viejos y los `unconfirmed` **se ven como lo que son: casos
      que esperan a una persona**, no como fallas del sistema.
- [ ] Un `unconfirmed` muestra los tres datos con los que se busca en el
      administrador de eventos de Meta.
- [ ] **La pantalla no ofrece reintentar un `pending` viejo.** Es deliberado: el
      reintento automático reintroduce el duplicado, que es el riesgo R7 y no se
      revierte borrando datos.
- [ ] `pnpm -r typecheck` limpio y la suite del worker en verde.

## No-regresión

Es una pantalla de sólo lectura sobre una tabla que hoy tiene **0 filas**. No
toca el camino que factura. Lo único que hay que cuidar es que **no encienda
nada**: el modo se cambia por entorno y **con un despliegue, no con un clic** —
decisión del ticket 03, y es lo que evita que alguien encienda el reporte real
sin querer.
