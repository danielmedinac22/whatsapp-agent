# Spec · Orientación visual del panel

Status: ready-for-agent

Método: **`grill-design`** — cinco prototipos radicalmente distintos por pregunta, en un solo archivo HTML vivo, y el veredicto del usuario baja un nivel del árbol. Es el mismo método de [Pulido de interfaz](../ventas-pulido-ui/spec.md), y por la misma razón: son decisiones de diseño, y un agente que responde sus propias preguntas de diseño no está haciendo el ejercicio.

Origen: diagnóstico de rendimiento del 20-ago-2026 · retoma lo que [Pulido de interfaz](../ventas-pulido-ui/spec.md) declaró fuera de alcance

## Problem Statement

El dueño del producto lo dijo así: **«es más colores, formas, títulos. Es difícil navegarlo en general.»**

No es pérdida de estado ni lentitud. Es que el panel no se deja recorrer con la vista. Todo pesa lo mismo, así que ubicarse cuesta leer, y leer cuesta tiempo en la pantalla donde se le escribe a clientes reales.

Los sitios donde eso se ve, medidos contra el código de hoy:

**Los títulos no dicen dónde estás.** De las ocho pantallas del panel, solo dos llevan una línea de contexto sobre el `h1`: Catálogo y Reporte. El Inbox y Pedidos, las dos que más se abren, dicen `Inbox` y `Pedidos` a secas. En la pantalla desde la que salen mensajes a Guatemala, el único indicio del país es una bandera de 8×30 px en el riel lateral, que además se pliega.

**No hay tipografía de título.** `--font-display` y `--font-body` tienen el mismo valor. Un título se distingue del cuerpo por tamaño y peso, nada más, y `.app-title` es el único estilo de encabezado que existe.

**Las dos pantallas más densas no tienen estructura interna.** El Inbox y Pedidos tienen un `h1` y cero `h2` o `h3`. Vendedor tiene seis `h2`; Conexión, cuatro. Las pantallas de configuración, que se abren una vez al mes, están mejor articuladas que las de trabajo diario.

**Un mismo estilo hace dos trabajos.** `app-eyebrow` es a la vez la línea de contexto de la página y el encabezado de sección dentro del Catálogo. Dos significados, un solo aspecto.

**Nada se distingue por forma ni por color.** `.app-card` y `.app-card-muted` son las dos un rectángulo redondeado con borde. Los tres tonos de panel se diferencian por opacidad de casi el mismo color. Hay un acento (menta) para todo lo accionable, un ámbar y un rojo. El tinte de la operación existe pero muere en el marco por decisión de diseño previa, así que no llega al contenido.

**La lista miente sobre el tiempo.** Cada fila muestra solo la hora. La bandeja mezcla a propósito las 200 más recientes con todas las que están sin responder, que son mucho más viejas, y las pinta con el mismo formato: «14:32» puede ser de hace cinco minutos o de hace tres semanas.

## Solution

Rondas de prototipos, no de conversación. El árbol baja en este orden, y cada nivel se cierra con un veredicto antes de abrir el siguiente.

**Nivel 1 · El sistema.** Cómo se jerarquiza una pantalla del panel: qué tipografía carga los títulos, cuántos niveles de encabezado existen y qué significa cada uno, y qué distingue una superficie de otra más allá de la opacidad. Es la decisión que condiciona todo lo demás, y la única que toca `globals.css`.

**Nivel 2 · Las dos pantallas de trabajo.** El Inbox y Pedidos, que son las que se viven. Qué zonas tiene una pantalla, qué las separa, y dónde va el contexto de operación y bandeja.

**Nivel 3 · La fila y sus estados.** La fila de conversación es la unidad que más se lee del producto. Qué la hace distinguible de un vistazo: sin responder, en automático, escalada, con novedad de logística, sin producto reconocido. Y cómo se dice el tiempo sin mentir.

## User Stories

1. Como asesor, quiero saber sobre qué operación estoy trabajando sin buscarlo, para no escribirle a un cliente del país equivocado.
2. Como asesor, quiero saber en qué bandeja estoy sin leer el selector, para no confundir el trabajo de Katherine con el de Sebastián.
3. Como asesor, quiero recorrer la bandeja con la vista y no leyendo fila por fila, para encontrar la que me toca sin detenerme en todas.
4. Como asesor, quiero distinguir una conversación sin responder de una que va bien sin abrirla, para priorizar.
5. Como asesor, quiero notar la conversación que un agente escaló a una persona, porque es donde hago falta.
6. Como asesor, quiero ver si una fila es de hoy o de hace tres semanas sin abrirla, para no tratar como urgente algo viejo.
7. Como asesor, quiero distinguir una conversación en automático de una que llevo yo, para no escribir encima del vendedor.
8. Como asesor, quiero que una fila con novedad de logística se note distinta, porque es la que tiene consecuencia si nadie la mira.
9. Como asesor, quiero que el hilo abierto y la lista se lean como dos zonas y no como un continuo, para saber dónde estoy mirando.
10. Como admin, quiero que una pantalla densa tenga secciones con nombre, para saltar a la que busco sin recorrerla entera.
11. Como admin, quiero que un título se vea título, para ubicarme al aterrizar en una pantalla nueva.
12. Como admin, quiero distinguir lo que puedo tocar de lo que solo informa, para no buscar clics donde no los hay.
13. Como admin, quiero que lo que tiene consecuencia se vea distinto de lo que es cosmético, para no tratarlos igual.
14. Como admin, quiero que las pantallas de trabajo diario estén al menos tan articuladas como las de configuración, porque son las que uso todos los días.
15. Como usuario del panel, quiero que las ocho pantallas se lean como un mismo producto, para no aprender ocho veces.

## Implementation Decisions

**El sistema visual sí se toca, y esa es la diferencia con el spec anterior.** [Pulido de interfaz](../ventas-pulido-ui/spec.md) puso «cambiar el sistema visual del panel» y «rediseñar las pantallas existentes» fuera de alcance porque su pregunta era otra: cómo se manifiesta la operación activa en pantallas que todavía no existían. Este spec recoge justo eso, porque el problema que reporta el usuario no se arregla dentro del sistema actual.

**La identidad se conserva.** Fondo oscuro, familia de azules profundos, acento menta. Lo que se agrega es jerarquía, no una paleta nueva. Una variante puede proponer lo contrario, pero tiene que ganárselo contra las demás.

**Segunda tipografía para títulos.** Hoy `--font-display` y `--font-body` son el mismo valor, así que existe la variable y no la distinción. La ronda del nivel 1 decide qué familia entra y en qué niveles manda.

**Los estados de la fila se codifican en más de un canal.** Color solo no alcanza: hay cinco estados que pueden coincidir en una misma fila. Forma, posición y peso también cargan significado, y ninguna variante puede depender solo del matiz.

**El tiempo se dice en relativo.** Hora si es de hoy, día si es de esta semana, fecha si no. Es lo que vuelve legible una lista que mezcla a propósito lo reciente con lo viejo.

**`app-eyebrow` se parte en dos.** Un estilo para la línea de contexto de la página y otro para el encabezado de sección. Hoy son el mismo y significan cosas distintas.

**Los prototipos alternan estados, no solo apariencias.** Cada variante tiene que poder mostrar: bandeja vacía y bandeja llena; una fila de hoy y una de hace tres semanas; sin responder, en automático y escalada; operación de Guatemala y de Colombia. Elegir contra el estado feliz es cómo se diseñan interfaces que se rompen en producción.

**Los prototipos son desechables.** Existen para producir un veredicto. Lo que sobrevive son las decisiones y los tokens, no el HTML.

## Testing Decisions

**Sin tests automatizados, y es deliberado.** Este spec produce decisiones de diseño. Lo que decide si una variante sirve es si el usuario se ubica sin que se lo expliquen, y eso no lo mide una aserción.

Lo que sí se verifica, con el usuario delante de los prototipos y sin narrar la variante:

- Señalar en qué operación está, en menos de dos segundos.
- Señalar en qué bandeja está, sin abrir el selector.
- Encontrar las conversaciones sin responder sin usar el filtro.
- Decir cuál de dos filas es de hoy y cuál de hace semanas.
- Decir qué fila tiene una escalada esperando.

Si una variante necesita explicación para entenderse, falló. Es el mismo listón del spec de pulido.

El arnés de pruebas de `apps/web` lo monta [La bandeja se actualiza sin recargarse](../bandeja-sin-recargas/spec.md). Este spec no lo necesita ni lo espera.

## Out of Scope

- Rendimiento. Los viajes a la base y el refresh por evento son de los otros tres specs.
- Los bugs de estado del Inbox: los tres `location.reload()`, la conversación que no vive en la URL, el hilo que salta. Son de [La bandeja se actualiza sin recargarse](../bandeja-sin-recargas/spec.md), y conviene que aterricen antes: rediseñar una fila que se recarga sola es diseñar contra un blanco móvil.
- Diseño móvil, salvo que una ronda lo levante como necesidad real del asesor.
- Accesibilidad más allá de lo que el sistema existente ya resuelve, con una excepción: ninguna variante puede codificar un estado solo con color.
- Las pantallas de configuración (Agente, Vendedor, Conexión, Plantillas). Ya están articuladas; heredan el sistema del nivel 1 y nada más.

## Further Notes

**Este spec se ejecuta con el usuario presente.** No es delegable a una sesión en segundo plano.

**Va después de los bugs de estado y antes de todo lo demás de UI.** Si el Inbox todavía se recarga solo al tocar un botón, el ejercicio de diseño se contamina con un síntoma que no es de diseño.

**El diagnóstico que lo originó** está en el reporte del 20-ago-2026, con la auditoría completa de los dieciséis hallazgos de navegación y sus rutas.
