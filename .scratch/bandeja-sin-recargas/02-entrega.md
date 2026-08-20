# 02 — Entrega · La bandeja se actualiza sola (PRO-11 + PRO-12)

Rama `danielmedinac22/bandeja-viva`. **Sin mergear, sin empujar y sin
deployar.**

| | Antes | Ahora |
| -- | --: | --: |
| `pnpm -r typecheck` | limpio | limpio |
| Pruebas del worker | 915 en 58 archivos | **940 en 59** |
| Pruebas del panel | 16 en 2 archivos | **43 en 4** |
| `pnpm test` desde la raíz | 931 | **983** |
| `next build` de `apps/web` | pasa | pasa |

No se tocó la base —no hay `.env` y no hizo falta—, no se envió ningún mensaje,
y `apps/web/src/lib/queries.ts` y `packages/db/src/schema.ts` quedaron intactos.

---

## 1 · El número

**Una ráfaga de 60 mensajes entrantes pedía 60 renders de servidor. Ahora pide
cero.** Medido el 20-ago-2026 sobre el componente de verdad, con el camino viejo
puesto y sacado: está fijado como prueba en
`inbox-lista.test.tsx` («una ráfaga de 60 mensajes no pide ni un render de
servidor»).

Lo que cuesta cada uno de esos renders no lo volví a medir: son las **23 idas y
vueltas a la base y 1.256 filas leídas** que trae el encargo, y este ticket no
las cambia —no toca `queries.ts`—. Lo que cambia es **cuántas veces se piden**.
Con la operación viva de Guatemala eso es un render por mensaje entrante,
mientras haya una pestaña abierta.

`router.refresh()` no desapareció: se acotó a lo que solo el servidor sabe, con
ventana de 400 ms y dentro de una transición. Los caminos que quedan son la
navegación, la búsqueda, dos casos nombrados del stream (abajo) y el botón que
suelta una conversación o apaga el agente.

---

## 2 · El estado de la bandeja vive en la dirección (PRO-11)

La conversación abierta y el filtro se **derivan** de `?c=` y `?v=`. No hay un
estado en memoria que pueda ir por su cuenta: es la misma decisión que el spec
pedía, y es lo que hace que los cuatro síntomas se vayan juntos.

| | Antes | Ahora |
| -- | -- | -- |
| Mandarle a un compañero el enlace de un chat | no se podía | `?c=` |
| Atrás | te sacaba de la pantalla | vuelve al chat anterior |
| Recargar | aterrizabas en el primero | en el que estabas |
| Filtro de operaciones | se perdía al recargar | `?v=` |
| Cambiar de bandeja | quedaba abierta una de la otra | se abre una de esta |
| El selector | en blanco mientras la lista filtraba | no puede quedar en blanco |

**Se escribe con la History API y no con `router.push`.** Lo que se guarda es
dónde está parado el asesor, no otra pantalla: Next sincroniza `useSearchParams`
con `pushState`/`replaceState` (`app-router.js` los parchea desde 14.1), así que
la dirección y lo que se ve no se pueden separar, **y seleccionar un chat no
cuesta un render de servidor ni mueve el scroll**. Con `router.push` cada clic en
la lista habría costado los 23 viajes que el otro ticket acaba de sacar.

`push` para la conversación —es lo que Atrás tiene que devolver— y `replace`
para el filtro, que es cómo se está mirando y no a dónde se fue.

**El ticket y el spec discrepaban y le hice caso al ticket.** El spec decía
«se escribe con `replace`»; con `replace` no hay historial, y «Atrás devuelve a
la conversación anterior» es una casilla del ticket y la historia de usuario 11.

**El selector no puede quedar en blanco, por construcción y no por cuidado.**
Las opciones que dibuja y los tokens que `?v=` acepta salen de **la misma
lista** (`filtrosDeLaBandeja`). Mientras fueron dos listas podían discrepar, y
discrepaban: «En automático» sobrevivía al salto a operaciones, donde esa opción
no existe, y el `<select>` se quedaba vacío mientras la lista sí filtraba. Un
valor que la bandeja no ofrece ahora ni siquiera se puede representar.

Tokens nuevos de `?v=`, para la bandeja de operaciones: `pendientes`,
`confirmadas`, `no-confirmadas`. Los de ventas —`sin-responder`,
`en-automatico`— son los de `./nav` y no cambiaron; **la URL sin parámetro sigue
significando «Todas»**, que es lo que mantiene vivos los enlaces de hoy.

---

## 3 · La lista se parchea con el evento (PRO-12)

**La decisión salió a una función pura**: `aplicarEvento`, en
`packages/db/src/bandeja-viva.ts`, junto a `resolveInbox` y `sinResponder`, y
probada desde el worker como todas ellas (25 casos). Se agregó el subpath
`@wa/db/bandeja-viva` al mapa de `exports` para poder importarla desde el
cliente sin arrastrar el cliente de la base.

Tres respuestas, y son tres a propósito:

| respuesta | cuándo |
| -- | -- |
| **parchear** | el evento dice lo que cambió y la fila lo escribe sola |
| **ignorar** | con motivo: otra operación, un acuse, o fuera de la lista |
| **refrescar** | cambió algo que el evento **no alcanza a describir** |

`refrescar` no es un cajón de sastre: son dos casos nombrados y los dos son
raros al lado del tráfico de mensajes.

1. **`conversation.updated`.** Sus dos emisores lo prueban: el clasificador de
   confirmación mueve `confirmation_status`, que no viaja en la instantánea, y
   el aviso que el propio panel manda al tomar una conversación llega con la
   instantánea en `null` a propósito. Es lo que hace que el resto del equipo vea
   quién tomó una conversación **antes** de ponerse a escribirle al mismo
   cliente, y por eso no lo puse detrás del aviso de novedades.
2. **Una fila que estaba «sin responder» y quedó con el contador en cero.**
   Alguien pudo haber contestado. Ver el punto 5.

### Lo que el evento sí resuelve solo

- Un entrante escribe vista previa, contador y fecha **en su sitio**.
- Un `failed` —o un `message.created` sin instantánea, que es un envío que murió
  porque `huellaDelSaliente` devuelve `null` sin `wa_id`— enciende el aviso de
  «no entregado» sin viaje.
- Un acuse de entrega o de lectura no toca la lista: es lo que ya hacía.
- Un evento de **otra operación** no la mueve. El stream ya filtra en el
  servidor; esto es el cinturón del cliente, porque una pestaña puede quedar
  abierta mientras el riel cambia de operación sin que el `EventSource` se
  reabra. **La regla es una sola**: `esParaElPanel` (worker) ahora llama a
  `esDeLaOperacion` (`@wa/db/bandeja-viva`) en vez de tener su propia copia.
- Un mensaje de una conversación **que no está en la lista no la inventa**: el
  evento trae tres campos y la fila dibuja veinte. Se avisa, y traerla es del
  servidor.

---

## 4 · Reordenar pasa a ser una acción del asesor

La fila se actualiza donde está y aparece un aviso —«3 conversaciones con
novedades · ponerse al día»—. Tocarlo reordena por actividad al instante, y
**solo pide el servidor si alguna novedad es de una conversación que la lista no
tiene**, que es lo único que el cliente no puede resolver.

Qué cuenta como «desordenada»: que la fila parcheada tenga **por encima** alguna
con actividad más vieja. Se mira solo hacia arriba a propósito —la lista del
servidor viene ordenada por actividad salvo la conversación anclada por `?c=`,
que se pone primera aunque sea vieja—; comparar contra la lista entera diría
«desordenada» desde el primer evento por culpa del ancla, y el aviso dejaría de
significar «llegó algo». El aviso que aparece siempre es el que nadie mira.

**Dónde queda el hueco, dicho claro.** Un render del servidor sigue trayendo el
orden del servidor, así que los dos casos de `refrescar` de arriba pueden
reordenar la lista sin que el asesor lo pida. Es el comportamiento de hoy para
un evento **mucho** más raro que un mensaje —el clasificador solo emite cuando el
estado cambia, y lo otro es un clic de un asesor—, y la ventana de 400 ms junta
la ráfaga en uno. Lo alternativo era congelar el orden también contra el
servidor, y eso trae tres inconsistencias nuevas: filas retenidas que no se ven,
contadores que cuentan de menos, y filas que el servidor ya soltó quedándose.
Preferí un hueco nombrado a tres sin nombre.

---

## 5 · «Sin responder», que es derivado y ya mintió una vez

El parche lo enciende **solo hacia arriba y con certeza**, y no lo apaga nunca.

**Hacia arriba.** El contador de no leídos sube en un solo sitio de todo el
worker —la ingesta de un entrante—, así que verlo subir es la prueba de que el
cliente acaba de escribir. Con eso las cuatro condiciones de `sinResponder`
quedan resueltas sin salir de la fila: el agente no la lleva y no está asignada
(los dos están en la fila), la actividad es de ahora, y la pelota es nuestra
porque acaba de escribir. **El test lo ata a la función de verdad**: lo que el
parche decide con tres campos es lo que `sinResponder` decide con los seis
hechos, y si alguna de las dos cambia de opinión la prueba lo dice.

**Hacia abajo, nunca.** Apagar el rojo exigiría saber si el saliente fue una
respuesta o una notificación (`esSalienteConversacional`) y si hay una escalada
reciente —que deja la conversación sin responder **aunque le hayamos
contestado**—. Nada de eso viaja en el evento. Ahí se le pregunta al servidor, y
el costo está acotado por cuántas filas están en rojo: 35 de 1.760 en producción
el 20-ago-2026.

---

## 6 · Una sola conexión al stream

Se abrían dos contra `/api/events` —una la lista y otra el hilo— y la del hilo se
cerraba y reabría con cada cambio de conversación. Ahora la abre la lista, una
vez y con dependencias vacías, y el hilo se cuelga de ella. El hilo sigue
enterándose exactamente de lo mismo; hay prueba de las tres cosas.

---

## 7 · Un apretón que nadie pidió, y por qué

El `router.refresh()` que seguía a cada botón ahora es **explícito y no
automático**: soltar una conversación o apagar el agente pueden devolverla a
«sin responder» —eso mira la escalada y la actividad, que la fila no trae— y sí
refrescan; **marcar una confirmación no deriva nada y ya no refresca**. Pedir la
pantalla entera para repintar un chip que el parche acaba de repintar eran 23
viajes a la base por clic, y el botón de estado se toca decenas de veces al día.

---

## 8 · Qué mirar en el preview, y en qué orden

Cuatro minutos. Todo en el Inbox.

**A · La dirección**

1. Abrí el Inbox y hacé clic en la **tercera** conversación. Mirá la barra de
   direcciones: aparece `?c=…`. *Antes no aparecía nada.*
2. Copiá esa dirección, abrila en otra pestaña. → Abre **esa** conversación.
3. Recargá (⌘R). → Seguís en la misma. *Antes volvías a la primera.*
4. Hacé clic en otra conversación y tocá **Atrás**. → Volvés a la anterior.
   *Antes te sacaba del Inbox.*
5. Poné un filtro («Pendientes») y recargá. → El filtro sigue puesto.

**B · El salto entre bandejas** (solo con vendedor configurado)

6. En Conversaciones (ventas) elegí la vista «En automático» y abrí un chat.
7. Andá al Inbox de Katherine por la barra lateral.
   → El chat abierto es uno **de esta** bandeja, con su fila resaltada, y el
   selector dice «Todas (N)». *Antes quedaba abierto el de ventas, sin fila
   marcada, y el selector se veía vacío mientras faltaban filas.*

**C · La lista en vivo** (hace falta tráfico real entrando)

8. Dejá el Inbox abierto con una conversación abierta y el cursor sobre la
   lista. Que entre un mensaje de **otro** cliente.
   → Esa fila se actualiza **donde está** —vista previa, contador, hora— y
   arriba de la lista aparece «1 conversación con novedades». *Antes la pantalla
   entera se rehacía y esa fila se te subía al primer puesto justo cuando ibas a
   hacer clic.*
9. Tocá el aviso. → La lista se reordena y el aviso desaparece.
10. Mientras tanto, el borrador que tenías escrito y el filtro puesto siguen ahí.

**Si nada de C se ve**, revisá que esté entrando tráfico: sin mensajes nuevos
esta parte no tiene nada que mostrar.

---

## 9 · Lo que quedó fuera, a propósito

- **`loading.tsx` en el resto de las rutas.** El del Inbox y el de Pedidos ya
  están (PRO-8); las otras cinco son de otro ticket del mismo spec.
- **Paginación y virtualización de la lista.** Fuera de alcance del spec.
- **Cómo se ve el aviso de novedades.** Que exista es de acá; su forma es de
  `.scratch/panel-orientacion/spec.md`.
- **`pnpm -r lint` sigue roto y ya lo estaba** (Next 16 quitó `next lint`). Es
  PRO-23, otro worktree; no lo toqué.

## 10 · Dónde mirar el código

| | |
| -- | -- |
| La decisión pura y sus tres respuestas | `packages/db/src/bandeja-viva.ts` |
| Sus 25 casos | `apps/worker/src/inbox/bandeja-viva.test.ts` |
| La bandeja | `apps/web/src/app/(app)/inbox/inbox-client.tsx` |
| PRO-11, 12 casos | `apps/web/src/app/(app)/inbox/inbox-direccion.test.tsx` |
| PRO-12, 15 casos | `apps/web/src/app/(app)/inbox/inbox-lista.test.tsx` |
| La dirección de mentira del arnés | `apps/web/src/app/(app)/inbox/inbox-harness.tsx` |

**Se comprobó que las pruebas nuevas fallan sin el arreglo**, sembrando cinco
regresiones a mano: seleccionar con `replace` en vez de `push` (cae «Atrás»), el
filtro sin acotar a la bandeja (caen las dos del selector en blanco), un
`refresh` por evento (caen 10 de la lista), reordenar dentro del parche (caen 4),
y devolverle al hilo su propio `EventSource` (caen las dos de la conexión única).
