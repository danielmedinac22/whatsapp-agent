# Spec · Los diez viajes del panel

Status: ready-for-agent

Origen: diagnóstico de rendimiento del 20-ago-2026 · conviene después de [La bandeja se actualiza sin recargarse](../bandeja-sin-recargas/spec.md)

## Estado · 20-ago-2026

**En producción: PRO-9.** El contador de viajes vive en el repo
(`scripts/viajes-del-panel.ts`), con la traza apagada salvo `WA_SQL_TRACE=1`.
Detalle y números en `entrega.md`.

**Falta: PRO-14, PRO-15 y PRO-16** — la región, las cachés y bajar el conteo a
cuatro. Los tres se miden con el contador, así que dejaron de ser una impresión.

## Problem Statement

El panel se siente lento y no es por hacer mucho trabajo. Es por distancia.

El worker y el panel leen la misma base por caminos distintos, y nadie lo decidió: salió de que cada uno se deployó donde le tocaba. El worker corre en Railway y llega a Postgres por la red privada interna, con menos de un milisegundo de por medio. El panel corre en Vercel, en Virginia, y no tiene acceso a esa red: sale a internet, cruza el país y entra por el proxy TCP público de Railway.

Encima de esa distancia, **un render del Inbox hace diez viajes a la base**, ocho de ellos dentro de `listConversations`. Medido contra producción:

| | |
|--|--|
| Render con conexiones calientes | 2 002 ms |
| Render con conexiones frías | 2 930 ms |
| Ejecución de cada consulta en Postgres | 1,5 a 3,2 ms |
| Datos que viajan | 78 kB |
| Conversaciones en la operación | 1 762 |

**Menos del 1% del tiempo es la base pensando.** El resto es esperar. Los tiempos se tomaron desde una máquina en Colombia con 117 ms de ida y vuelta, así que desde Vercel el número va a ser menor; lo que no cambia con la ubicación es el conteo de viajes, y ese es el multiplicador.

Dos de esos diez viajes traen datos que casi nunca cambian: las plantillas aprobadas y la URL base de los archivos de logística.

## Solution

Tres frentes, y el primero no es código.

**Acercar la función a la base.** Las funciones de Vercel corren hoy en `iad1` y la base está en la otra costa. Fijar la región del proyecto al lado de la base acorta los diez viajes de una sola vez, sin tocar una línea de aplicación.

**Dejar de pedir lo que no cambió.** Las plantillas y la conexión de logística se leen en cada render. El repo ya tiene su patrón de caché con vencimiento e invalidación explícita, usado para la lista de operaciones.

**Bajar el conteo.** Dentro de `listConversations` hay consultas que pueden viajar juntas o no viajar. La meta es cuatro viajes o menos por render.

Y algo que hace falta para que nada de esto sea una impresión: **el contador de viajes se queda en el repo** como script, no como instrumentación temporal. Es lo que convierte «se siente más rápido» en un número antes y un número después.

## User Stories

1. Como asesor, quiero que la bandeja abra sin que me dé tiempo a preguntarme si se colgó.
2. Como asesor, quiero que cambiar de pantalla sea inmediato, para no perder el hilo de lo que estaba haciendo.
3. Como asesor, quiero que buscar en la bandeja responda mientras escribo y no después.
4. Como admin, quiero que el panel se sienta tan vivo como el worker, porque leen la misma base.
5. Como admin, quiero saber cuántos viajes hace un render, para discutir el rendimiento con un número y no con una sensación.
6. Como admin, quiero que una regresión de rendimiento se note antes de que la note el asesor.
7. Como quien desarrolla, quiero poder medir el efecto de un cambio sin volver a montar instrumentación cada vez.
8. Como quien desarrolla, quiero saber en qué región corre cada cosa sin deducirlo de una latencia rara.
9. Como quien desarrolla, quiero que agregar una consulta al render tenga un costo visible, para pensarlo dos veces.
10. Como admin, quiero que las plantillas y la conexión de logística no se relean en cada render, porque cambian una vez al mes.
11. Como admin, quiero que el trabajo de acercar la función a la base no cambie ninguna otra cosa del despliegue.

## Implementation Decisions

**Antes de mover nada, confirmar la región del servicio Postgres.** El diagnóstico verificó la del worker, no la de la base, y son servicios distintos del mismo proyecto. Mover Vercel a la región equivocada empeora el problema en vez de arreglarlo. Este es el primer paso y es bloqueante.

**La región se fija en la configuración del proyecto web.** Es un cambio de despliegue, no de aplicación, y se verifica con el contador de viajes antes y después.

**Se evalúa también acercar el panel a la red privada.** Mover la función a la región vecina quita la distancia pero no el proxy público. Vivir en la red interna quita las dos. Es una decisión de infraestructura mayor y este spec no la toma: la deja anotada con su medición al lado, para que se decida con datos.

**La caché es la del repo, no una nueva.** Vencimiento por tiempo más invalidación explícita, como la lista de operaciones. Lo que entra: las plantillas aprobadas y la URL base de logística. Lo que no entra: nada que dependa de la conversación o del usuario.

**Invalidar es obligación de quien escribe.** Una caché sin invalidación explícita en el punto de escritura es una caché que miente, y este repo ya pagó caro un contador que decía lo que no medía. Editar plantillas invalida plantillas.

**El contador de viajes vive en `scripts/`.** Reproduce la secuencia real del layout y de la página, cuenta consultas y las cronometra. Es un script y no un test: necesita la base y una red, y un test que depende de las dos es un test que falla por motivos que no son el código.

**El objetivo se declara: cuatro viajes o menos por render del Inbox.** Un número redondo contra el cual medir, no una promesa de que se puede.

## Testing Decisions

**El rendimiento no se prueba con aserciones acá, se mide con el script.** Un umbral de milisegundos en un test es una prueba que falla los martes por la red. El script da el número; quien revisa el cambio lo compara.

Lo que sí se prueba, con el arnés que monta [La bandeja se actualiza sin recargarse](../bandeja-sin-recargas/spec.md):

- **La caché, como función pura**, desde el worker: entrega el valor guardado antes del vencimiento, vuelve a la fuente después, y la invalidación explícita la vacía de inmediato. Sin reloj real: el tiempo entra como parámetro, que es como el repo ya prueba todo lo que depende de fechas.
- **Que la caché no cruce operaciones.** Es la regla que este repo vigila en todas partes, y una caché mal llaveada es una fuga silenciosa: le muestra a Guatemala las plantillas de Colombia sin que nada falle.
- **Que las consultas fusionadas devuelvan lo mismo.** Si una consulta se parte o se junta, lo que importa es que el resultado no cambie. La red de alcance por operación del worker sigue vigilando que ninguna consulta nueva se salte el filtro, y cualquier función que se agregue tiene que sumarse a su lista de nombres o la red no la ve.

No se prueba la región de despliegue. Eso se verifica mirando el despliegue.

## Out of Scope

- El refresh por evento SSE. Es de [La bandeja se actualiza sin recargarse](../bandeja-sin-recargas/spec.md), y sale antes justamente porque baja la frecuencia con la que estos diez viajes ocurren.
- `conversationIdsOfInbox` y los índices. Son de [La bandeja de ventas aguanta encenderse](../bandeja-de-ventas-a-escala/spec.md).
- Quitar `force-dynamic` o adoptar caché de páginas. Radio de impacto grande, ganancia chica: lo único cacheable en el render son las plantillas, que este spec ya cubre.
- Paginación por cursor. El problema que resuelve, que las páginas deriven al insertar, es real y futuro: hoy se traen 200 sin paginar.
- Partir los componentes cliente grandes. Es trabajo de peso de bundle, no de viajes, y se guía midiendo antes.
- Mudar el panel fuera de Vercel. Este spec mide y anota; no decide.

## Further Notes

**El orden importa poco entre este spec y el de recargas, pero conviene medir después.** Bajar la frecuencia de los renders y bajar el costo de cada uno son mejoras independientes; hacerlas en ese orden deja el número final más limpio de leer.

**El primer paso puede ser el más rentable de los cuatro specs.** Es una línea de configuración, no toca código de aplicación y afecta a los diez viajes a la vez. También es el único que necesita el visto bueno del dueño antes de tocarse, porque es producción.

**La medición completa**, con el detalle de las once consultas en orden y sus tiempos, está en el reporte del 20-ago-2026.
