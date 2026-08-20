# 03 — Entrega · «Sin responder»

Rama `danielmedinac22/sin-responder`, commit `7b443b7`, empujada.
**Sin mergear y sin deployar.** `pnpm -r typecheck` limpio;
`pnpm --filter @wa/worker test` en verde: **878 pruebas en 56 archivos**
(la base eran 859 en 55).

Todo lo medido sale de producción de Guatemala, solo `SELECT`, 20-ago-2026.

---

## 1 · El número: 35, no 39

**El ticket decía 39 y el 39 está mal.** Ese número agrupaba
`outbound_messages` por `conversation_id`, y esa columna está en **`null` en 316
de los 352 salientes `manual`** — los que escribe una persona desde el panel, que
son justamente la respuesta más humana que existe en esta base.

```
 source           | conversation_id null | filas
------------------+----------------------+-------
 manual           | sí                   |   316
 manual           | no                   |    36
```

Agrupando por ahí, cuatro conversaciones donde una persona **sí** contestó
contaban como «nadie contestó». Se leen sus respuestas:

| Cliente | Último entrante | Respuesta `manual`, después | Texto |
| -- | -- | -- | -- |
| `50234818739` | 12-ago 14:25 | 12-ago 14:26 | «Okay perfecto, procedemos a confirmar el pedido…» |
| `50247969401` | 15-ago 02:43 | 15-ago 11:15 | «Hola Wilson como estas? unicamente despachamos producto orig…» |
| `16012095743` | 08-ago 21:34 | 09-ago 14:47 | «Hola Wilfredo, tu pedido ya fue despachado…» |
| `12403988986` | 31-jul 02:00 | 31-jul 14:35 | «Te enviaremos la actualizacion de tu envio…» |

La clave correcta es `to_wa_id` —la que `loadEscalationsByWaId` ya usaba, con el
porqué escrito— y el número es **35**.

| Definición | Conversaciones |
| -- | --: |
| Hoy en el panel: `!agent_mode && unread_count > 0` | **90** |
| Base: agente apagado · 30 días · no asignada · con entrante | 44 |
| **«Sin responder» (la nueva)** | **35** |
| La misma, agrupando por `conversation_id` (el 39 del ticket) | 39 |
| Contra *cualquier* saliente, por `to_wa_id` | 28 |
| Contra `conversations.last_outbound_at` | 21 |

La consulta, tal cual, contra producción:

```sql
with respuesta as (   -- el último saliente CONVERSACIONAL por cliente
  select to_wa_id, max(created_at) as at
  from outbound_messages where source in ('agent','manual') group by 1
), escalada as (      -- la última escalada AL CLIENTE por cliente
  select to_wa_id, max(created_at) as at
  from outbound_messages
  where source = 'escalation' and dedup_key like 'escalation-customer-%' group by 1
)
select count(*) as sin_responder
from conversations c
join contacts ct on ct.id = c.contact_id
left join respuesta r on r.to_wa_id = ct.wa_id
left join escalada e on e.to_wa_id = ct.wa_id
where c.operation_id = '63937b3d-6312-446d-8bb8-1b9468afdd87'
  and ct.agent_mode = false
  and c.assigned_user_id is null
  and greatest(coalesce(c.last_inbound_at,'epoch'::timestamptz),
               coalesce(c.last_outbound_at,'epoch'::timestamptz),
               c.created_at) >= now() - interval '30 days'
  and (
    (c.last_inbound_at is not null and (r.at is null or c.last_inbound_at > r.at))
    or e.at >= now() - interval '30 days'
  );
--  sin_responder
-- ---------------
--             35
```

Y el mismo 35 sale del **código del panel** corriendo contra producción, no solo
de esta consulta: `listConversations(op, {})` devuelve 234 filas con 35 marcadas.

### La tesis del ticket se confirma, con otro número

El ticket decía «los 19 de diferencia son todos notificaciones». Con la clave
correcta la diferencia contra *cualquier* saliente es de **7**, y las 7 son
notificaciones. Dos de ellas son de las que más duelen:

| Último entrante | Lo que salió después | `source` |
| -- | -- | -- |
| 25-jul 23:39 | «Recibí tu audio 🎙️ Un asesor te responderá en unos minutos…» | `escalation` |
| 23-jul 23:20 | «Recibí tu audio 🎙️ Un asesor te responderá en unos minutos…» | `escalation` |
| 11-ago 14:22 | «Te escribimos nuevamente porque tu pedido continúa pe…» | `dropi_status` |
| 04-ago 09:18 | ídem | `dropi_status` |
| 27-jul 14:49 | «Hola Kevin 🙌 ¡Muchísimas gracias por tu compra!…» | `dropi_status` |
| 25-jul 01:13 | ídem, para Marleny | `dropi_status` |
| 20-ago 03:37 | «✅ Token Dropi renovado · user 12178» | `dropi_2fa` |

Dos clientes mandaron un audio, el sistema les prometió un asesor, y el asesor
nunca llegó. Con la regla vieja esas dos no estaban en la lista.

### Las que no tienen fila en el outbox

**24 de las 35** no tienen ni un saliente conversacional registrado. La ausencia
cuenta como «no contestamos», que es lo conservador, y está dicho en el código
(`SinResponderFacts.lastConversationalOutboundAt`). Verificado contra `messages`:
15 de las 35 tienen un saliente posterior al último entrante, **ninguno con
`from_agent` ni con `sent_by_user_id`**, y leyéndolos uno por uno son
confirmaciones y avisos de despacho salvo **una** (`50242899292`), donde se ve a
una persona conversando por una puerta que no dejó fila. Una de 35 de más, y del
lado correcto.

---

## 2 · Lo que la medición encontró y el ticket no sabía

**La tarjeta del Inbox de Katherine no decía 90. Decía 0.**

El contador se calculaba en el cliente sobre las filas cargadas, y la lista carga
las 200 más recientes por actividad:

| | |
| -- | --: |
| Rango que cubren las 200 más recientes | 15-ago → 20-ago (5 días) |
| De esas 200, con el agente apagado | **1** |
| Mejor puesto de una conversación con `unread > 0` y agente apagado | **668** |
| Lo que mostraba la tarjeta, entonces | **0** |

El 90 era la medición contra la base entera; en pantalla nunca se vio. Con la
regla nueva calculada igual —sobre lo cargado— la tarjeta habría dicho **1**.

Por eso el conteo cambió de sitio: **lo hace el servidor sobre las 1.760
conversaciones**, y `listConversations` trae siempre las que están sin responder
aunque queden fuera del corte por viejas. La lista pasa de 200 a **234** filas.
Es la única forma de que la tarjeta diga 35 y el filtro muestre 35 — si no, el
panel vuelve a mentir, con otro número.

---

## 3 · Lo que cambió

Cuatro archivos nuevos, once tocados.

**`packages/db` — la regla, pura y probada**

- `sin-responder.ts` — `sinResponder`, `pelotaNuestra`, `puedeEstarSinResponder`,
  `actividadDe` y `DIAS_SIN_RESPONDER = 30` con su porqué al lado.
- `saliente-conversacional.ts` — **la mudanza de `esSalienteConversacional`**.

**La mudanza, que es lo único que toca `apps/worker`.** El encargo pedía avisar
antes de copiarla: no la copié, la mudé. `apps/web` no depende de `@wa/worker` y
no puede, así que el único sitio compartido es `@wa/db`.
`apps/worker/src/inbox/saliente-conversacional.ts` la re-exporta, sus dos
llamadores (`jobs/outbound.ts` y su test de 17 casos) no cambiaron ni una línea,
y sigue habiendo **una** definición de «esto fue contestar». La lista de
`source` conversacionales para el `where … in (…)` sale de
`outboundSource.enumValues.filter(esSalienteConversacional)`: ni siquiera esa
lista está escrita a mano.

**`apps/web` — el resto**

- `queries.ts`: `loadSinResponderIds`, la unión en `listConversations`,
  `countSalesInboxViews` con las tres vistas nuevas, la línea de corte en los
  cuatro call sites, `loadEscalationsByWaId` acotada por operación, y las cuatro
  cargas finales del Inbox en paralelo.
- `operation-scope.ts`: `waIdOfOperation`, para acotar `outbound_messages` —que
  no lleva operación y cuyo `conversation_id` no alcanza.
- `nav.ts` / `module-nav.tsx`: los nombres y el orden.
- `inbox/page.tsx` / `inbox-client.tsx`: la tarjeta, el filtro, el borde rojo, la
  marca de escalada y la insignia de ventana cerrada.
- `api/wa/send*/route.ts` + `lib/quien-envia.ts`: `sentByUserId`.

**`apps/worker`** — solo la re-exportación y el test nuevo
(`inbox/sin-responder.test.ts`, 19 casos).

### La única copia de la regla que existe, y por qué

`queries.ts` repite **tres condiciones** en SQL —agente apagado, sin asignar,
actividad en 30 días— para no traerse las 1.760 conversaciones en cada carga:
573 ms contra 132. Están separadas y exportadas como `puedeEstarSinResponder`,
son las tres que hacen falta siempre, y hay un test que ata las dos mitades sobre
las 32 combinaciones de los hechos: si alguna deja de ser necesaria, el test
falla. Lo que **decide** sigue siendo la función pura, sobre lo que la consulta
deja pasar.

---

## 4 · Los criterios, uno por uno

- **«Sin responder» cuenta lo que dice.** ✅ Contra producción, **35** donde hoy
  daría 90. La escalada suma 0 hoy: las 4 con escalada reciente ya entran por la
  pelota.
- **La misma definición y el mismo nombre en la tarjeta del Inbox.** ✅ La
  tarjeta, el filtro, el borde rojo de la fila y el contador de la barra leen el
  **mismo booleano**, calculado una vez en el servidor.
- **«En automático» exige vendedor encendido.** ✅ `countSalesInboxViews` recibe
  la fila del vendedor, y solo se llama después de `salesAgentIsConfigured`. Con
  `display_name` vacío no hay bandeja, no hay vistas y la consulta no corre.
- **El orden de la barra.** ✅ En automático → Sin responder → Todas.
- **Las escaladas se ven sin vendedor.** ⚠️ **Con un matiz medido.** De las 93
  filas `escalation`: 36 son avisos al cliente (36 contactos), 36 son avisos al
  admin —todos al mismo número— y 21 son claves de `dropi-novedad`. O sea que las
  «37 escaladas» son 36 clientes + el teléfono del admin, y la última al cliente
  es del **27-jul**, no del 13-ago. De esas 36: **ninguna** estaba en las 200
  filas que Katherine cargaba, **5** siguen vivas dentro de los 30 días —y esas 5
  ahora aparecen marcadas, porque la unión las trae—, y **31** llevan más de 30
  días quietas y ya fueron contestadas. Traer también esas 31 sería meterle 31
  filas sin trabajo pendiente a su pantalla de todos los días; **decilo si lo
  querés y es un `or` de una línea.**
- **Fuera de la ventana de 24h sigue contando y la fila lo dice.** ✅ **34 de las
  35** tienen la ventana cerrada; llevan una insignia ámbar «ventana cerrada» con
  su explicación. Con la ventana de 24h como regla, la cuenta daría 1.
- **Ningún nombre se corta.** ✅ «Sin responder» (13) y «En automático» (13),
  contra los 14–16 que corta la barra. Además el nombre del vendedor salió de la
  etiqueta —era «Las lleva Sebastián», que es lo que se cortaba— y quedó donde ya
  estaba, al lado del módulo.
- **Verde.** ✅ `pnpm -r typecheck` limpio, 878 pruebas en 56 archivos.

---

## 5 · La deuda del 01, pagada y verificada

`resolveInbox` recibe la línea de corte en los cuatro call sites. Que era
necesario no es una opinión: corriendo `countSalesInboxViews` contra producción
con una activación hipotética del 1-jul-2026,

| | Sin responder | En automático | Todas |
| -- | --: | --: | --: |
| Código de `main` (sin corte) | 0 | 0 | **0** |
| Este commit | 24 | 1 | **49** |

Encender a Sebastián con el código de hoy le habría dejado la bandeja
permanentemente vacía, sin que nada dejara de compilar. Ahora el tipo lo impide:
pedir la bandeja **es** pasar el corte (`BandejaPedida`).

Y el otro extremo, que es la historia de usuario 6: activándolo *ahora mismo*,
los tres contadores dan **0 / 0 / 0** — la bandeja arranca limpia, sin heredar ni
una conversación de Katherine. Con `activated_at` en `null`, que es producción
hoy, también 0/0/0.

---

## 6 · El costo

Medido contra las 1.760 conversaciones reales, corriendo el código del panel —no
una consulta suelta—, 7 vueltas por lado, alternando:

| | Filas | Sin responder | Con escalada | Mediana |
| -- | --: | --: | --: | --: |
| `main` | 200 | 0 | 0 | **815 ms** |
| Este commit | 234 | 35 | 5 | **828–881 ms** |

**+13 a +66 ms (≈ +2–8 %)** por cinco consultas más, 34 filas más y el número de
verdad. Sale barato porque las cuatro cargas finales del Inbox —logística,
tienda, pedidos del ruteo y escaladas— iban en fila india y ahora van en
paralelo; sin eso, la misma medición daba 1.573 ms. La medición es desde un
portátil contra el proxy de Railway, así que está dominada por la ida y vuelta:
en producción el número absoluto es menor y la diferencia también.

Ni una escritura nueva. `releaseStaleAssignments` sigue siendo la única, y sin
vendedor no corre.

---

## 7 · Qué mirar en el preview de Vercel

Entrando como Katherine, en `/inbox` (sin `?b=`), que es la pantalla de todos los
días:

1. **La tarjeta de la derecha dice «Sin responder» y un número alrededor de 35**
   —hoy dice «Necesita atención» y **0**—. En rojo.
2. **Clic en la tarjeta**: la lista queda en 35 filas y el contador de arriba a
   la derecha dice `35/234`. Cada fila tiene el borde izquierdo rojo.
3. **Casi todas esas filas llevan una insignia ámbar «ventana cerrada»** (34 de
   35). Es lo que hay que ver para saber que hace falta plantilla antes de
   escribir.
4. **Cinco de ellas llevan además la insignia roja «escalada»** — hoy no aparece
   ninguna. Pasando el mouse: «El vendedor pasó esta conversación a un asesor».
5. **La lista completa tiene 234 filas y no 200**: al bajar del todo aparecen
   conversaciones de julio, que son las que estaban esperando respuesta y no se
   podían alcanzar sin buscarlas por nombre.
6. **El desplegable de filtros** dice «Sin responder (35)» donde decía
   «Atención (0)».
7. **La barra lateral no cambia**: sin vendedor no hay grupo de Ventas ni vistas,
   igual que hoy. Para ver las tres vistas nuevas hay que configurar el vendedor,
   y eso **no** es parte de este ticket.

Y lo que **no** tiene que haber cambiado: el orden de la lista, el hilo, el
envío, los chulos de entrega, las insignias de confirmación y logística, y el
contador «Sin leer».

---

## 8 · Fuera de alcance, y por qué

- **Sebastián sigue apagado.** No se tocó `sales_agent_settings`.
- **Las otras tarjetas del Inbox** («Sin leer», «Modo agente», «Por confirmar»)
  siguen contando sobre las filas cargadas. Tienen el mismo problema de alcance
  que tenía «Necesita atención», y cambiarlas es cambiarle a Katherine números
  que nadie pidió que cambiaran. Queda dicho acá para cuando alguien lo pida.
- **`next lint` no corre** en este repositorio desde Next 16 (`next lint` ya no
  existe); falla igual en `main`. Las puertas del ticket son `typecheck` y las
  pruebas del worker, y las dos están en verde.
