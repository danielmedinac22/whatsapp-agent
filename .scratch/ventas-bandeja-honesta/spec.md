# Spec · La bandeja honesta

Status: ready-for-agent

Origen: comentario de Pablo por WhatsApp, 19-ago-2026 · árbol de diseño cerrado
en 16 decisiones el mismo día · todo lo medido sale de la base de producción de
Guatemala, **solo lectura**

## Problem Statement

El panel le dice a un vendedor que no existe que tiene 55 conversaciones
esperándolo. Ninguna es suya, ninguna es urgente, y la mitad ya fue contestada.

Pablo lo vio y lo dijo así: *«GORDO ESTAS CONVERSACIONES DE SEBAS DE Q SON? NO
ENTENDER»*. La respuesta —«son de Katherine, todavía Sebastián no está
encendido»— es correcta y es exactamente el problema: **el panel está mostrando
como pendiente de un módulo apagado el trabajo histórico del módulo que sí
factura.**

Medido contra producción el 19-ago-2026, las 1.759 conversaciones de Guatemala:

| Regla que decidió la bandeja | Conversaciones | «Necesita atención» |
| -- | --: | --: |
| `operaciones` · pedido en curso | 359 | 4 |
| `operaciones` · pedido terminado | 1.290 | 32 |
| **`ventas` · sin pedido** | **110** | **54** |

Y de esas 54 supuestas urgencias:

| | |
| -- | --: |
| Fuera de la ventana de 24h de WhatsApp | **54 de 54** |
| Con más de 30 días | 46 |
| **Ya respondidas** (el último mensaje es saliente) | **30** |
| Entrante más reciente del grupo entero | **26-jul-2026** |

Son cuatro mentiras encadenadas, y cada una tiene una causa distinta:

1. **La bandeja de ventas está definida por resta.** `resolveInbox` manda a
   ventas todo contacto **sin ninguna fila de pedido** (regla `no_order`,
   `packages/db/src/inbox.ts:241`). Las 110 no son pedidos de Katherine: son
   contactos que escribieron y nunca generaron pedido en la tienda. 72 de ellas
   Katherine las marcó `confirmado` **a mano**. Y **ninguna llegó por un
   anuncio**: `ad_referral_at` es `null` en las 1.759, así que la regla del
   recomprador nunca se disparó y hoy la bandeja de ventas **no contiene ni una
   sola conversación de Sebastián**.

2. **El módulo se encendió solo.** El panel decide «hay vendedor» por
   *existe la fila* (`layout.tsx:100`), y el worker por *`display_name` no
   vacío* (`salesAgentIsConfigured`, `apps/worker/src/sales/settings.ts:38`).
   Alguien abrió `/vendedor`, el `upsert` creó la fila con todo en `''`, y el
   menú se encendió mientras el vendedor sigue apagado. El listón correcto ya
   estaba decidido en tres tickets: `ventas-conversacion/01`, `ventas-panel/01`
   y `ventas-ingesta-reconocimiento/01`.

3. **`unread_count` no mide lo que su nombre dice.** Solo se pone en cero cuando
   alguien **abre la conversación en el panel** (`markRead`,
   `apps/web/src/lib/queries.ts:795`). Si el agente contesta, o el asesor
   contesta desde el celular, el contador queda en rojo para siempre. No mide
   «hay que atenderla»: mide «nadie la abrió acá adentro».

4. **`agent_mode` es un solo booleano para dos agentes.** «Las lleva el
   vendedor» sale de `contacts.agent_mode`, que `confirmation-ack.ts`,
   `followup.ts` y `remarketing.ts` también prenden — y son flujos de Katherine
   (1.579 conversaciones de ella lo tienen en `true`).

## Solution

Que cada número del panel diga algo verificable, y que **la bandeja de ventas
esté vacía mientras no haya vendedor** — que es la verdad de hoy.

Tres cambios independientes, en tres tickets:

1. **El listón del vendedor.** Un solo predicado compartido, una **línea de
   corte** (`activated_at`) y la regla `no_order` acotada a lo que nació después
   de encender. Sin vendedor, la bandeja de ventas no existe y el Inbox de
   Katherine vuelve a ser exactamente el de antes del módulo.
2. **El saliente conversacional.** Que responder deje huella: `unread_count` en
   cero y `last_outbound_at` estampado cuando sale una respuesta de verdad.
3. **«Sin responder».** Redefinir y renombrar las vistas para que digan su regla.

## User Stories

1. Como dueño de la operación, quiero que el panel no me muestre pendientes de un
   agente que no encendí, para no perder tiempo entendiendo un número que no
   significa nada.
2. Como asesor, quiero que «necesita atención» sean conversaciones que de verdad
   esperan una respuesta mía, para poder confiar en el rojo.
3. Como asesor, quiero que contestar desde el celular apague el contador, porque
   contestar es contestar.
4. Como asesor, quiero ver las conversaciones que el agente escaló, porque son
   exactamente en las que hago falta.
5. Como asesor, quiero que tomar un chat lo saque de la lista de pendientes, para
   que dos personas no trabajen lo mismo.
6. Como dueño de la operación, quiero que el día que encienda a Sebastián su
   bandeja arranque limpia, sin heredar el historial de Katherine.
7. Como dueño de la operación, quiero ver primero lo que el vendedor está
   haciendo solo, y después lo que me toca a mí.

## Implementation Decisions

Las dieciséis salieron de un árbol de diseño cerrado con el usuario el
19-ago-2026. Cada ticket lleva las suyas, con su porqué. Las que valen para todo
el lote:

**La bandeja de ventas se define en positivo, no por resta.** Una conversación es
de Sebastián si hay un motivo para creerlo —llegó por un anuncio, o nació después
de que se encendiera el vendedor—, nunca por no tener pedido.

**La línea de corte mira la fecha de nacimiento y se escribe una sola vez.** Lo
histórico es de Katherine para siempre. Mirar la última actividad movería
conversaciones vivas de bandeja sin que nadie lo pida, que es justo lo que
`no-regresion.md` prohíbe; y el caso que eso querría cubrir —el recomprador— ya
lo cubre la regla del anuncio el día que haya anuncios.

**Un solo listón de «hay vendedor», y es el del worker.** Abrir una pantalla de
configuración no puede ser lo que enciende un módulo.

**El histórico no se reconstruye.** El corte de recencia de 30 días ya deja fuera
todo lo que un backfill arreglaría, y a cambio un backfill es una escritura
masiva sobre la tabla viva de Guatemala.

**Un nombre por número.** Si la bandeja de Katherine y la de ventas cuentan lo
mismo, se llaman igual. Dos nombres para el mismo número es cómo nacen dos
respuestas a la misma pregunta.

**No se inventa vocabulario.** «En automático» es el opuesto de «Respuesta
manual», que la cabecera del hilo ya dice. «Sin responder» es literalmente la
regla que el código calcula.

## Testing Decisions

Los tests viven **solo** en `apps/worker` (`pnpm --filter @wa/worker test`). Las
tres piezas nuevas son funciones puras o casi, y las tres se prueban ahí:

- La regla `no_order` con línea de corte, en `packages/db/src/inbox.test.ts`:
  contacto anterior al corte, posterior al corte, y **sin corte** (que es
  producción hoy, y tiene que dar «bandeja de ventas vacía»).
- El predicado de «hay vendedor», con fila inexistente, fila con `display_name`
  vacío y fila llena.
- La decisión de «este saliente es conversacional», por `source`, con un caso por
  cada uno de los ocho valores que existen en producción. Que no compile si
  aparece un `source` nuevo sin que alguien diga de qué lado cae.

**Verde no significa correcto.** El criterio de terminado de cada ticket está
escrito en términos de lo observable: qué número sale en el panel, qué fila queda
en la base, qué se ve en la barra lateral.

## Out of Scope

- **Partir `agent_mode` en dos columnas.** Derivar alcanza mientras solo un agente
  esté encendido sobre el número. El día que los dos atiendan a la vez, es un
  ticket propio.
- **Reconstruir el histórico** de `unread_count` y `last_outbound_at`.
- **Las 72 conversaciones marcadas `confirmado` sin ningún pedido detrás.** Es un
  hallazgo de esta medición y merece su propia pregunta —¿son ventas que
  ocurrieron fuera del sistema, o una marca manual que significa otra cosa?—,
  pero no bloquea nada de este lote.
- **Encender a Sebastián.** Sigue mandando `panel-de-ventas/estado.md` y el orden
  de los tres interruptores.

## Further Notes

**`psql` sí está instalado** (`/opt/homebrew/bin/psql`), al contrario de lo que
dice el skill `tanda-de-tickets`. Todo lo medido en este spec salió de ahí, con
el `DATABASE_URL` del `.env`, que **es producción**. Solo `SELECT`.

**La próxima migración es la `0030`.** La `0029` existe sin commitear en la rama
`credenciales-de-vorare`.

**Hallazgo de paso, sin ticket:** `loadEscalationsByWaId`
(`apps/web/src/lib/queries.ts:238`) filtra por `to_wa_id` y **no por operación**.
Hoy no filtra de más porque los `waId` vienen de contactos de la operación, pero
es la clase de aislamiento que este repo trata como bug. Si el ticket 03 la toca,
que la deje con su `operationId`.
