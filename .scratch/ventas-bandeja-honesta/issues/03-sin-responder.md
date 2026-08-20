# 03 — «Sin responder»: que cada vista diga su regla

**What to build:** Que los tres contadores de la barra lateral y las tarjetas del
Inbox cuenten algo verificable, y se llamen como lo que cuentan.

**Blocked by:** nada para construir. **Sí para verificar:** sus números salen de
las columnas que arregla el **02**, así que los conteos contra producción no
significan nada hasta que el 02 esté mergeado y desplegado.

**Status:** open — arranca cuando mergee el 01

> **Lo que te dejó el 01, y es obligatorio.** `resolveInbox` ahora recibe la
> línea de corte del vendedor como **segundo parámetro opcional**, y omitirlo
> significa «no hay vendedor»: la bandeja de ventas queda vacía. Tuvo que ser
> opcional porque hacerlo obligatorio rompía el `typecheck` de `queries.ts`, que
> el 01 tenía prohibido tocar. **Vos sos el dueño de `apps/web`, así que te toca
> pasarlo en los cuatro call sites** — si no, encender a Sebastián deja su
> bandeja permanentemente en cero (medido sobre el panel corriendo):
>
> | Línea | Función | Qué le falta |
> | -- | -- | -- |
> | `queries.ts:345` | `conversationIdsOfInbox` | `conversations.created_at` al `select`, y el corte |
> | `queries.ts:349` | `inboxChangedSince` | el mismo corte |
> | `queries.ts:549` | `listConversations` | ya tiene `r.conversation.createdAt`; falta el corte |
> | `queries.ts:598` | `countSalesInboxViews` | `conversations.created_at` al `select`, y el corte |
>
> El corte es `{ activatedAt: seller?.activatedAt ?? null, bornAt: <nacimiento> }`
> y `seller` sale de `getSalesAgentSettings(op)`. Y ojo con el vocabulario: la
> regla `no_order` **ya no significa ventas** — ahora significa lo contrario, y
> las dos formas de entrar a la bandeja de ventas sin pedido se llaman
> `born_after_activation` y `ad_click_after_activation`.

**Este ticket NO arranca en paralelo con el 01.** Los dos tocan
`apps/web/src/app/(app)/nav.ts` y `apps/web/src/app/(app)/inbox/page.tsx`, así que
va después: nace de un `main` que ya trae el 01 mergeado.

Es dueño de `apps/web` completo, incluida la mitad del panel del ticket 02 —
**pasar `sentByUserId` desde la acción de enviar**. La mitad del worker ya la dejó
hecha el 02; vos solo le das el valor.

## Qué está mal hoy, medido

En Guatemala, 19-ago-2026, «necesita atención» daba 55 y **ninguna de las 54 que
pude reproducir era trabajo vivo**: las 54 fuera de la ventana de 24h, 46 con más
de 30 días, 30 ya respondidas, y la entrante más reciente de todo el grupo del
**26-jul-2026**.

La causa es que la regla es `!agentMode && unread > 0`
(`inbox-client.tsx:537`, y `queries.ts:605` para el contador de la barra), y
`unread_count` mide «nadie la abrió en el panel», no «hay que atenderla».

Lo que cuesta cada definición, medido sobre las 1.759 conversaciones:

| Definición | Conversaciones |
| -- | --: |
| Hoy: `unread > 0` y agente apagado | **90** |
| La pelota es nuestra (último mensaje entrante) | 68 |
| **La pelota es nuestra y actividad en 30 días** | **20** |
| La pelota es nuestra y dentro de las 24h | 0 |

## Las tres vistas, después

### «Sin responder» (antes «Necesitan atención»)

Una conversación entra si:

- el **último mensaje es entrante** (la pelota es nuestra), **y**
- el agente **no la lleva** (`agent_mode` en `false`), **y**
- hubo actividad en los **últimos 30 días**, **y**
- **no está asignada** a nadie.

**O bien** si tiene una **escalada** dentro de los mismos 30 días, aunque el
último mensaje sea saliente: el agente puede escalar *después* de contestar, y
entonces la pelota es nuestra igual.

Por qué 30 días y no la ventana de 24h: con 24h da **cero hoy**, y eso es mentira
por el otro lado. Un lead que escribió hace 30 horas y nadie contestó es una
venta perdida, y el panel ya sabe reabrir con plantilla —«Retomar conversación»
está en la pantalla—. Que la ventana cerrada **se vea en la fila**, no que saque
la conversación de la cuenta.

Por qué las asignadas salen: si tomar un chat no lo saca de la lista roja, el
botón «TRABAJARLA YO» no sirve para nada — dos personas siguen viendo el mismo
pendiente. El abandono ya está cubierto: `releaseStaleAssignments` la suelta sola
cuando cambia de bandeja, y si nunca se contesta vuelve a aparecer al soltarse.

**Esta definición y este nombre valen también para la bandeja de Katherine**, que
usa el mismo cálculo en su tarjeta. Pasa de **90 a 20**. Las 70 que se caen son
mes-viejas o ya respondidas. Dos nombres para el mismo número es cómo nacen dos
respuestas a la misma pregunta.

### «En automático» (antes «Las lleva el vendedor»)

`agent_mode` **y** bandeja de ventas **y** el vendedor realmente encendido. Ese
tercer requisito es el que falta hoy: `contacts.agent_mode` es un solo booleano
que `confirmation-ack.ts`, `followup.ts` y `remarketing.ts` también prenden, y son
flujos de Katherine — 1.579 conversaciones de ella lo tienen en `true`.

No se parte la columna en dos. Derivar alcanza mientras solo un agente esté
encendido sobre el número; el día que los dos atiendan a la vez, es un ticket
propio.

El nombre: «En automático» es el opuesto exacto de «Respuesta manual», que la
cabecera del hilo ya dice. «Modo agente» nombra el interruptor, no el estado de
la conversación, y como vista se lee raro. Y «En automático» es el único que no
se rompe cuando `display_name` está vacío — hoy la barra dice «Las lleva el
ven…».

### «Todas»

Se queda. Es la única salida para una conversación que no cae en ninguna de las
dos —agente apagado y pelota del cliente—, y sin ella esa conversación no existe
en la barra.

## El orden en la barra

**En automático → Sin responder → Todas.**

Primero lo que el vendedor está haciendo solo; después lo que le toca a una
persona. Es el pedido explícito del usuario: *«las que le interesan son las del
segundo nivel»*.

## La escalada, también en la bandeja de Katherine

`resolveRowMark` (`packages/db/src/sales-context.ts:185`) marca `escalada` cuando
el agente le pasó la conversación a una persona. Hoy solo se calcula **con
bandeja** (`queries.ts:534`), y sin vendedor no hay bandeja: **Katherine no las
ve**.

En producción hay **93 escaladas sobre 37 contactos**, la última el **13-ago**.
Son conversaciones en las que un agente pidió expresamente que mirara alguien.

Cuesta **una consulta más** por carga del Inbox — la que el comentario de
`queries.ts:526` decidió no cobrarle a Katherine. Se paga: es un `IN` sobre
`outbound_messages` filtrado por `source`, no un escaneo, y a cambio dejan de
perderse 37 conversaciones.

**De paso:** `loadEscalationsByWaId` (`queries.ts:238`) filtra por `to_wa_id` y
**no por operación**. Hoy no filtra de más porque los `waId` vienen de contactos
de la operación, pero es la clase de aislamiento que este repo trata como bug. Si
la tocás, dejala con su `operationId`.

## Restricción de la barra

La barra lateral **corta alrededor de los 14–16 caracteres** — hoy se ve
«Necesitan ate…» y «Las lleva el ven…». «Sin responder» (13) y «En automático»
(13) caben enteros. Cualquier alternativa tiene que caber también.

## Lo que hay que respetar

- **La definición nueva toca la bandeja de Katherine.** Leé
  `.scratch/panel-de-ventas/no-regresion.md`. Es solo lectura y solo pintura,
  pero es su pantalla de todos los días.
- **No inventes vocabulario.** Si el panel ya nombra algo, se llama igual.
- **Un nombre por número**: la tarjeta del Inbox y la vista de la barra cuentan lo
  mismo y se llaman igual.
- El corte de 30 días va **fijo en código**, con su constante nombrada y su
  porqué al lado. Si algún día hay que configurarlo, ese es el sitio.
- **`apps/web/src/app/(app)/inbox/inbox-client.tsx` son 1.023 líneas y este
  ticket es su único dueño** durante la tanda.

## Criterios

- [ ] «Sin responder» cuenta: último mensaje entrante · agente apagado · 30 días ·
      no asignada; **o** escalada dentro de los 30 días.
- [ ] La misma definición y el mismo nombre en la tarjeta del Inbox de Katherine.
      Contra producción da **20** donde hoy da 90.
- [ ] «En automático» exige que el vendedor esté realmente encendido. Con
      `display_name` vacío, la vista no existe (la bandeja tampoco — ticket 01).
- [ ] El orden en la barra es En automático → Sin responder → Todas.
- [ ] La escalada se ve **también** sin vendedor configurado: las 37 conversaciones
      escaladas aparecen en la bandeja de Katherine.
- [ ] Una conversación fuera de la ventana de 24h **sigue contando** y la fila lo
      dice.
- [ ] Ningún nombre nuevo se corta en la barra.
- [ ] `pnpm -r typecheck` limpio y `pnpm --filter @wa/worker test` en verde.

## No-regresión

Es solo lectura: ninguna de estas reglas escribe nada. Lo que hay que cuidar es
**el costo**, porque la escalada agrega una consulta a la pantalla que Katherine
abre todo el día. Medí el tiempo de carga del Inbox antes y después contra
producción, con las 1.759 conversaciones reales.

Y la trampa de verificación: **los números de este ticket no cierran hasta que el
02 esté desplegado.** Antes de eso, «el último mensaje es entrante» calculado
desde `last_outbound_at` da 85 y calculado desde `messages` da 68 — la diferencia
son las 536 conversaciones cuya columna del saliente está en `null`. Mientras el
02 no esté, **calculalo desde `messages`** y dejá dicho en el código que la
columna es la fuente correcta una vez arreglada.
