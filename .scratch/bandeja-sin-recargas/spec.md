# Spec · La bandeja se actualiza sin recargarse

Status: ready-for-agent

Origen: diagnóstico de rendimiento del 20-ago-2026 · bloquea a [Orientación visual](../panel-orientacion/spec.md)

## Estado · 20-ago-2026

**En producción: PRO-5, PRO-7, PRO-8 y PRO-13.** Los tres `location.reload()` se
fueron, el hilo dejó de saltar con los acuses, el Inbox y Pedidos tienen
esqueleto de carga, y una red de texto impide que una recarga vuelva a entrar.

`apps/web` pasó de cero pruebas a 16, y `pnpm test` desde la raíz corre las del
panel además de las del worker. Detalle en `01-entrega.md`.

**Falta de este spec: PRO-11 y PRO-12.** El estado de la bandeja en la URL, y la
lista que se parchea con el evento en vez de refrescar. PRO-12 ya tiene lo que
necesitaba: PRO-6 dejó el evento enriquecido en producción.

## Problem Statement

La bandeja tiene tres botones de uso diario —Agente ON/OFF, «la trabajo yo», y marcar confirmación— y **los tres recargan el documento entero**. No refrescan datos: hacen `location.reload()`. Al volver, la conversación abierta no está en ninguna parte porque no vive en la URL, así que el panel aterriza en el primer chat de la lista, con el filtro en blanco y el mensaje a medio escribir perdido.

El usuario no lee eso como «recargó». Lo lee como «se me movió solo».

Alrededor hay otras tres formas de perder el sitio, todas del mismo origen: **la bandeja trata cualquier cambio como motivo para rehacer la pantalla entera.**

- Cada evento SSE dispara un `router.refresh()` sin ventana. Con tráfico real eso reordena la lista por última actividad mientras el cursor va bajando, y termina abriendo la conversación equivocada.
- El hilo baja al fondo con cada acuse de entrega o de lectura. La lista sí filtra esos eventos a propósito; el hilo no.
- Cambiar de bandeja no remonta el componente, porque es la misma ruta. Queda abierta una conversación de la otra bandeja, sin ninguna fila resaltada, y con un filtro que el selector ya no sabe mostrar.

Y cuando el panel sí está trabajando, no lo dice: **no existe ningún `loading.tsx` en toda la aplicación**, y las siete pantallas son `force-dynamic`. Una navegación lenta se ve idéntica a una aplicación colgada, así que el usuario vuelve a hacer clic.

Nada de esto se arregla con velocidad. Un panel más rápido que se recarga sola sigue perdiendo el sitio.

## Solution

Un cambio en la bandeja se aplica donde ocurrió, sin rehacer la pantalla.

Tres piezas:

**El evento trae lo que cambió.** Hoy `WaEvent` lleva dos identificadores, así que el cliente no puede hacer nada con él salvo volver a preguntar. El worker, una línea antes de emitirlo, ya calculó el preview, el contador de no leídos y la fecha. Mandarlos no cuesta ninguna consulta nueva.

**La lista se parchea en cliente.** Con el evento enriquecido, un mensaje nuevo actualiza una fila. El patrón ya existe en el repo, dos veces: el hilo de la conversación se actualiza así desde hace tiempo, y la tabla de Pedidos reescribe la fila tocada tras confirmar. La lista es la única que sigue pidiendo la pantalla entera.

**Lo que sí requiere al servidor, avisa.** Las navegaciones entre módulos siguen siendo renders de servidor. Un esqueleto por ruta las vuelve visibles.

## User Stories

1. Como asesor, quiero prender o apagar el agente sin que se recargue la pantalla, para no perder el chat que tenía abierto.
2. Como asesor, quiero marcar «la trabajo yo» sin perder el sitio, porque lo hago decenas de veces al día.
3. Como asesor, quiero marcar una confirmación sin que la app me devuelva al primer chat de la lista.
4. Como asesor, quiero que el mensaje que estoy escribiendo sobreviva a cualquier cosa que pase en la pantalla.
5. Como asesor, quiero que el filtro que elegí siga puesto después de tocar un botón.
6. Como asesor, quiero que la lista no se reordene bajo el cursor justo cuando voy a hacer clic.
7. Como asesor, quiero enterarme de que llegaron conversaciones nuevas sin que se reordenen solas, para decidir yo cuándo mirarlas.
8. Como asesor, quiero leer la parte de arriba de un hilo sin que la vista me arrastre al fondo cada vez que entregan un mensaje mío.
9. Como asesor, quiero que el hilo sí baje solo cuando ya estaba abajo, porque ahí sí estoy siguiendo la conversación en vivo.
10. Como asesor, quiero poder mandarle a un compañero el enlace de una conversación.
11. Como asesor, quiero que el botón Atrás me devuelva al chat anterior y no me saque de la pantalla.
12. Como asesor, quiero que recargar la página me deje en el chat donde estaba.
13. Como asesor, quiero que cambiar de bandeja limpie lo que era de la otra, para no quedar mirando una conversación que ya no pertenece acá.
14. Como asesor, quiero que el selector de filtro muestre siempre lo que la lista está filtrando, para saber por qué faltan filas.
15. Como asesor, quiero ver que el panel está cargando cuando cambio de pantalla, para no hacer clic dos veces.
16. Como asesor, quiero que el tráfico de una operación no mueva la bandeja de la otra.
17. Como admin, quiero que el panel deje de recargarse entero, para que cualquier trabajo de diseño encima tenga un blanco quieto.

## Implementation Decisions

**`WaEvent` se enriquece en el paquete compartido.** Es una unión discriminada, así que ampliarla hace que el compilador señale los cinco sitios de emisión y ninguno quede a medias. Los campos que entran: la operación, el preview, el contador de no leídos y la fecha de última actividad. La operación no es opcional: sin ella, un inbox de Guatemala se mueve por tráfico de Colombia, y hoy lo hace.

**La decisión de qué hacer con un evento sale a una función pura.** Vive en `packages/db`, junto a `resolveInbox` y `sinResponder`, que ya son puras y ya se importan desde el cliente por un subpath export. Recibe la lista y el evento, devuelve la lista nueva. Ahí se decide si la fila se actualiza, si se mueve de puesto, y si el evento se ignora por ser de otra operación.

**Reordenar es una acción del usuario, no del tráfico.** Cuando llega un evento que cambiaría el orden mientras la lista está en uso, la fila se actualiza en su sitio y aparece un aviso de que hay novedades. El reordenamiento ocurre cuando el usuario lo pide. Qué cuenta como «en uso» lo decide la implementación, con una preferencia: errar del lado de no mover.

**Los tres `location.reload()` se van y no vuelven.** Tras el POST, la fila se parchea en memoria. Es el patrón de la tabla de Pedidos.

**La conversación abierta pasa a la URL.** Se escribe con `replace` y sin scroll al seleccionar, y el estado se deriva del parámetro en vez de duplicarse. Eso resuelve el enlace compartible, el botón Atrás y el aterrizaje tras recargar, que hoy son tres síntomas de la misma causa.

**El filtro de la bandeja de operaciones también pasa a la URL.** La bandeja de ventas ya espeja su vista; la otra no. Quedan iguales.

**El hilo filtra los eventos como ya lo hace la lista.** Solo mensajes nuevos y fallos. Y baja solo si ya estaba abajo.

**Un solo `EventSource` por pestaña.** Hoy se abren dos contra el mismo stream, una en la lista y otra en el hilo, y la del hilo se cierra y reabre con cada cambio de chat.

**`router.refresh()` no desaparece, se acota.** Sigue siendo el camino de la navegación y la búsqueda, con ventana y dentro de una transición. Deja de ser el camino de los eventos.

**Un `loading.tsx` por ruta**, empezando por el Inbox y Pedidos, que son las lentas.

## Testing Decisions

**Este spec monta el arnés de pruebas de `apps/web`.** Vitest con jsdom y Testing Library, un `vitest.config.ts` propio, y —esto es lo que decide si sirve— **enganchado al `test` de la raíz**, no solo al del paquete. El repo ya argumentó por escrito que una red que nadie corre es peor que ninguna, y ese argumento se responde con el enganche, no ignorándolo.

**Un buen test acá describe lo que el usuario percibe, no cómo está hecho.** «El borrador sobrevive a un evento» es comportamiento externo. «El componente no se remontó» es implementación, y va a estorbar en cuanto alguien reorganice el árbol.

Qué se prueba y dónde:

- **La función pura de eventos**, desde el worker, como todo lo puro del repo. Un evento de otra operación no toca la lista. Una fila se actualiza conservando su identidad. Un acuse de lectura no reordena. Un mensaje nuevo en una conversación que no está en la lista no la inventa. El prior art de forma es `asignacion.test.ts` y `resolve.test.ts`.
- **La bandeja, en `apps/web`**: el borrador sobrevive a un evento; seleccionar un chat lo escribe en la URL; recargar aterriza en el mismo chat; un acuse de lectura no arrastra el scroll del hilo; cambiar de bandeja no deja abierta una conversación de la otra; el selector de filtro nunca muestra en blanco lo que la lista sí está filtrando.
- **Que los `location.reload()` no vuelvan.** El repo ya tiene una red que lee el código del panel como texto y falla si encuentra una consulta sin acotar. Se le suma una regla: `location.reload()` en `apps/web` es un hallazgo. Vive en el worker por la misma razón que la primera, escrita en su propio encabezado.

No se prueba: que el evento llegue por la red, ni el `EventSource`. Eso es transporte, ya funciona, y probarlo cuesta un arnés que no vale lo que cubre.

## Out of Scope

- Cuántos viajes hace un render y dónde corre la función. Es de [Los diez viajes del panel](../panel-viajes/spec.md).
- `conversationIdsOfInbox` y los índices que faltan. Son de [La bandeja de ventas aguanta encenderse](../bandeja-de-ventas-a-escala/spec.md).
- Cómo se ve la fila, el aviso de novedades o el esqueleto de carga. Este spec decide que existan; [Orientación visual](../panel-orientacion/spec.md) decide su forma.
- Paginación de la lista. Se siguen trayendo 200 filas.
- Virtualizar la lista. Con 200 filas y 78 kB, el tiempo no se va en pintar.
- Quitar `force-dynamic`. No es lo que duele y su radio de impacto es toda la aplicación.

## Further Notes

**Va primero de los cuatro.** [Orientación visual](../panel-orientacion/spec.md) necesita una pantalla que no se recargue sola para poder diseñarse encima, y los otros dos specs se miden mejor con el refresh por evento ya fuera del camino.

**Enriquecer el evento no cuesta consultas.** En el pipeline de entrada, el worker acaba de escribir el preview, el contador y la fecha en la línea anterior al emit, y tiene el contacto y la conversación en mano. Es el hallazgo más barato del diagnóstico.

**El síntoma que el usuario reportó era otro.** Preguntado por qué lo hace perder, respondió «colores, formas, títulos». Este spec arregla bugs reales y medidos que él no nombró: valen por sí solos, y sobre todo porque dejan quieto el terreno donde se va a hacer el trabajo que sí pidió.
