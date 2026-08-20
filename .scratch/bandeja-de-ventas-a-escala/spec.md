# Spec · La bandeja de ventas aguanta encenderse

Status: ready-for-agent

Origen: diagnóstico de rendimiento del 20-ago-2026 · **bloqueante para configurar al vendedor**

## Estado · 20-ago-2026

**En producción: PRO-10, PRO-18 y PRO-20.** Falta aplicar la migración de PRO-17.

Encender la bandeja de ventas **dejó de ser una apuesta**. Antes leía 8.407 filas a la escala de hoy y 69.857 a diez veces esa escala; ahora lee **1.611 en las dos**, porque dejó de escalar con el tamaño de la operación. Y mirar la bandeja pasó de escribir 199 filas por render a **cero**.

**Pendiente y bloqueante: la migración `0031`** (los dos índices) está escrita, ensayada y mergeada, pero **no aplicada a producción**. Hasta que se aplique, PRO-17 sigue abierto y PRO-24 —borrar el índice muerto— sigue bloqueado.

El techo entre 36.000 y 45.000 conversaciones sigue en pie: los índices no lo mueven. Lo que cambió es que ahora se llega mucho más tarde.


## Problem Statement

Hoy la bandeja de ventas está apagada: no hay vendedor configurado, así que `bandejaPedida` devuelve indefinido y la derivación de bandeja no corre. Todo lo que sigue está escrito, probado y sin ejecutarse.

El día que se configure a Sebastián, cada carga del Inbox va a hacer esto, antes de aplicar el corte de 200 filas:

1. Un `SELECT` **sin `LIMIT`** de todas las conversaciones de la operación, con su join de contactos y ordenadas por actividad. Hoy son 1 762 filas.
2. Los pedidos de **todos** esos contactos, en dos consultas más.
3. Un recorrido en memoria decidiendo, fila por fila, a qué bandeja pertenece cada una.
4. Un `UPDATE` sobre `conversations`, soltando las asignaciones que cambiaron de bandeja.

Y como el panel llama `router.refresh()` con cada evento SSE, **eso ocurre una vez por mensaje de WhatsApp que entra**. Un refresh por mensaje deja de ser una lectura: es una escritura sobre la tabla más caliente del sistema, disparada por el tráfico de esa misma tabla.

Debajo hay un problema de índices que hoy no duele y ahí sí va a doler. `conversations` no tiene índice sobre `operation_id`, así que todo filtro por operación es un escaneo completo. Y el orden de la bandeja es `GREATEST(last_inbound_at, last_outbound_at, created_at)`, una expresión que ningún índice actual puede servir, así que la tabla se ordena entera en cada render. Con 1 762 filas eso cuesta 0,4 ms y no se nota. El patrón del índice que falta ya existe en el repo, aplicado a otras dos tablas.

El contador de la barra lateral tiene la misma forma: cuenta sobre todas las conversaciones de la operación, se dibuja en las siete pantallas del panel, y hoy tampoco corre por la misma razón.

## Solution

Que encender al vendedor sea una decisión de producto y no una apuesta de rendimiento.

**Acotar la derivación antes de derivar.** La bandeja de una conversación se decide con sus pedidos y su fecha de nacimiento. No hace falta traer las 1 762 para quedarse con 200: hace falta traer las candidatas en el orden en que se van a mostrar y cortar antes, no después.

**Sacar la escritura del camino de lectura.** Soltar asignaciones que quedaron obsoletas es correcto y hay que seguir haciéndolo. Lo que no puede seguir es que lo dispare cada carga de pantalla.

**Poner los índices que la consulta ya pide.** Uno compuesto por operación y actividad, y uno de expresión sobre el orden real. El repo ya tiene el patrón en dos tablas y sus migraciones.

**Medirlo con el vendedor encendido antes de encenderlo de verdad.** Contra la base de ensayo con datos, no contra producción y no contra una tabla vacía.

## User Stories

1. Como admin, quiero encender la bandeja de ventas sin que el panel se vuelva más lento para Katherine.
2. Como admin, quiero saber cuánto cuesta la bandeja de ventas antes de encenderla, no después de que alguien se queje.
3. Como asesor de ventas, quiero que mi bandeja abra igual de rápido que la de confirmaciones.
4. Como asesor, quiero que la bandeja siga siendo rápida cuando la operación tenga diez veces más conversaciones.
5. Como asesor, quiero que el contador de la barra lateral esté al día sin que costear ese número frene la pantalla que estoy usando.
6. Como admin, quiero que mirar la bandeja no escriba en la base, para que leer no tenga consecuencias.
7. Como admin, quiero que una asignación se suelte cuando de verdad cambió de bandeja, y no como efecto colateral de que alguien abrió una pantalla.
8. Como admin, quiero que abrir la segunda operación colombiana no empeore el rendimiento de Guatemala.
9. Como quien desarrolla, quiero que la consulta de la bandeja use un índice y no ordene la tabla entera.
10. Como quien desarrolla, quiero saber a partir de cuántas conversaciones esto deja de aguantar, para no enterarme el día que pase.

## Implementation Decisions

**El corte ocurre antes de la derivación, no después.** Hoy el orden es traer todo, derivar todo y cortar a 200. La derivación necesita los pedidos del contacto y la fecha de nacimiento de la conversación, dos cosas que se pueden acotar por el mismo criterio con el que se va a cortar.

**Si el corte previo cambia qué filas aparecen, gana la definición vigente.** La bandeja ya tiene una regla escrita de qué entra, incluidas las que están sin responder y quedaron fuera del corte por viejas. Optimizar no puede cambiar en silencio qué ve el usuario: si la forma rápida trae otro conjunto, es un cambio de producto y se decide como tal, no se acepta como efecto secundario. Este repo ya tuvo un contador que decía lo que no medía.

**La liberación de asignaciones sale del camino de lectura.** Pasa a ocurrir donde el hecho ocurre, que es cuando cambian los pedidos de un contacto, o en un trabajo periódico del worker. La lectura de la bandeja vuelve a ser solo lectura.

**Dos índices sobre `conversations`:** uno compuesto por operación y actividad, siguiendo el patrón que ya está en el repo, y uno de expresión sobre el `GREATEST` por el que la lista ordena. Van con su migración, generada y aplicada por el flujo normal.

**El contador de la barra sigue la misma suerte que la bandeja.** Comparte forma y comparte costo. Si hace falta desacoplarlo del render de la pantalla, se desacopla; qué número muestra no cambia.

**La medición usa la base de ensayo con Docker, con datos.** Con la tabla vacía cualquier consulta es rápida y la medición no dice nada. El repo ya tiene sembradores para escenarios de bandeja.

**Se declara el techo.** El trabajo termina sabiendo a cuántas conversaciones por operación esto deja de aguantar. Un número, escrito, para que la siguiente vez la conversación empiece con un dato.

## Testing Decisions

**Lo que se prueba es que la bandeja no cambió de opinión, no que quedó más rápida.** El riesgo real de este spec no es no mejorar: es mejorar y traer otro conjunto de filas sin que nadie lo note.

- **La derivación de bandeja ya está probada** en el worker, sobre funciones puras, con casos de conversación que entra, que sale y que vuelve. Esos tests son la red que tiene que seguir en verde: si acotar antes cambia una decisión, ahí se ve.
- **Un caso nuevo por cada motivo por el que una fila entra a la bandeja**, incluido el que más fácil se rompe al cortar antes: la conversación vieja que aparece por estar sin responder y que quedaría fuera de cualquier corte por actividad.
- **Que leer no escriba.** Con la liberación fuera del camino, una carga de la bandeja no puede dejar rastro. Se prueba donde vive la lógica, verificando que la lectura no llama a la liberación.
- **La red de alcance por operación del worker** sigue vigilando que ninguna consulta nueva se salte el filtro. Toda función que se agregue o se parta tiene que sumarse a su lista de nombres, o la red no la ve.
- **Los índices no se prueban con aserciones**, se verifican con el plan de ejecución antes y después, y el resultado se anota en el ticket. Un test que afirma que el planificador eligió un índice es un test que falla cuando la tabla crece y el planificador cambia de opinión con razón.

## Out of Scope

- Encender al vendedor. Este spec deja el terreno listo; la decisión de producto es aparte.
- El refresh por evento SSE, que es lo que multiplica este costo. Es de [La bandeja se actualiza sin recargarse](../bandeja-sin-recargas/spec.md), y bajarlo reduce el daño sin quitar la causa.
- La región de despliegue y la caché de plantillas. Son de [Los diez viajes del panel](../panel-viajes/spec.md).
- Cambiar qué conversaciones pertenecen a cada bandeja. La definición vigente es la que hay que preservar.
- Paginar la bandeja. Sigue con su corte de 200.
- Cómo se ve la bandeja de ventas. Es de [Orientación visual](../panel-orientacion/spec.md).

## Further Notes

**Es el único de los cuatro que bloquea otra cosa.** Los otros tres mejoran algo que ya funciona. Este evita que encender una función planeada degrade el panel de quien no la pidió.

**Hoy no se puede medir en producción**, porque el código no corre. Por eso la base de ensayo con datos no es una comodidad: es la única forma de ver esto antes de que sea tarde.

**Es el candidato natural a hacerse en un worktree aparte**, porque toca la base de datos con migraciones y su medición necesita una base propia con datos sembrados.
