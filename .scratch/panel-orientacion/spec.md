# Spec · Orientación visual del panel

Status: ready-for-agent

Método: **`grill-design`** — cinco prototipos radicalmente distintos por pregunta, en un solo archivo HTML vivo, y el veredicto del usuario baja un nivel del árbol. Es el mismo método de [Pulido de interfaz](../ventas-pulido-ui/spec.md), y por la misma razón: son decisiones de diseño, y un agente que responde sus propias preguntas de diseño no está haciendo el ejercicio.

Origen: diagnóstico de rendimiento del 20-ago-2026 · retoma lo que [Pulido de interfaz](../ventas-pulido-ui/spec.md) declaró fuera de alcance

## Estado · 20-ago-2026 — **el árbol de diseño está cerrado**

Las tres rondas corrieron con el dueño del producto delante y cada nivel tiene
veredicto. **Lo que sigue es implementación.** Estas decisiones están acá y no
solo en Linear a propósito: una sesión hija abre en un worktree sin el MCP de
Linear, así que lo que no viaje en el diff no lo hereda.

### Nivel 1 · El sistema — veredicto: **Claro**

El panel **cambia de fondo oscuro a fondo claro**, incluidos el riel y el menú.
No es una variante de contenido sobre el marco de hoy.

| token | valor |
| -- | -- |
| fondo de la aplicación | `#f4f6f5` |
| riel | `#e8edeb` · menú `#eef1f0` |
| superficie de pantalla | `#f9fbfa` · tarjeta `#ffffff` |
| texto | `#12201b` · fuerte `#08120e` · tenue `#5b6f66` · suave `#84978d` |
| líneas | `#d8e0dc` · suave `#e5ebe8` · hover `#e9efec` |
| **tinta** | `#0f766e` · suave `#dbe8e4` · lavado `#eef5f3` |

**El acento menta `#6ee7b7` se retira.** Sobre fondo claro no llega al contraste
que hace falta para marcar nada. Los estados se rederivan igual:

| estado | fondo | texto |
| -- | -- | -- |
| sin responder | `#fdf0d8` | `#8a5a08` |
| en automático | `#d8f0e8` | `#0b5f52` |
| escalada | `#fde0e0` | `#a52020` |
| novedad | `#eae4fd` | `#5a41a8` |
| sin producto | `#e6ecf0` | `#41586a` |

**Tipografía: Figtree para todo.** Y esto contradice lo que el ticket suponía:
el problema no era que faltara una segunda familia, era que no había escala.
`--font-display` y `--font-body` pueden seguir siendo el mismo valor.

**Tres niveles de encabezado, con significado propio:**

1. **Línea de contexto** — 10,5 px, 700, `letter-spacing: .11em`, versalitas,
   color tinta. Dice de qué operación y de qué pantalla se trata. Va **sobre**
   el `h1`, siempre.
2. **Título de pantalla** — 34 px, 700, `letter-spacing: -.03em`.
3. **Encabezado de sección** — 16 px, 600. Divide una pantalla por dentro. Es lo
   que hoy no existe ni en el Inbox ni en Pedidos.

**`app-eyebrow` se parte en dos estilos.** Hoy hace de línea de contexto de
página y de encabezado de sección dentro del Catálogo. Son dos cosas.

**Las superficies se separan por aire y una sombra suave**, no por opacidad de
casi el mismo color: `0 1px 2px rgba(18,32,27,.05), 0 6px 18px -12px rgba(18,32,27,.22)`.

### Nivel 2 · Las pantallas — veredicto: **Tres columnas**

**La planta no cambia.** Riel, menú, y debajo del encabezado global la lista y
el hilo lado a lado. La lista mide **336 px**.

El contexto vive **una sola vez por pantalla**, en la línea sobre el `h1`:
`🇬🇹 Vorare Store Guatemala · confirmación`. No se repite por zona.

Lo que separa la lista del hilo es **la superficie**: la lista comparte el fondo
de la pantalla, el hilo va sobre blanco. No un borde grueso ni un espacio.

**Pedidos hereda la planta.** No necesita una propia.

Descartadas y por qué: la franja de operación de ancho completo (resolvía el país
sin lugar a dudas y costaba una tira en las ocho pantallas), el contexto repetido
por zona (duplicaba), la lista a pantalla completa con el hilo encima (**el
veredicto dice que el Inbox es un chat, no una bandeja que se despacha**), y el
menú plegado.

### Nivel 3 · La fila — veredicto: **Etiquetas**

**Cada estado es una etiqueta con su nombre escrito**, debajo del preview:
`SIN RESPONDER`, `EN AUTOMÁTICO`, `ESCALADA`, `NOVEDAD`, `SIN PRODUCTO`.
9,5 px, 800, `letter-spacing: .06em`, versalitas, `border-radius: 5px`.

**Ningún estado se codifica solo con color.** La etiqueta lleva el nombre; el
color acompaña. Era criterio de aceptación y esta variante lo cumple sin
esfuerzo.

**El tiempo se dice en relativo**: hora si es de hoy (`14:32`), día si es de esta
semana (`ayer`, `mar`), fecha si es más viejo (`12 ago`). Hoy la lista mezcla a
propósito las 200 recientes con **todas** las sin responder, que son mucho más
viejas, y las pinta todas igual.

**Las secciones llevan nombre y cuenta**: «Esperando respuesta · 6»,
«El resto · 3».

**Lo que cuesta, aceptado a sabiendas:** es la fila más alta de las cinco. Con
dos estados ocupa tres líneas. Se eligió legibilidad sobre densidad, coherente
con los otros dos veredictos.

### Las cuatro decisiones del 20-ago-2026, por la tarde

Las tomó el dueño del producto sobre medidas, no sobre opiniones. Cierran lo que
quedaba abierto y corrigen dos valores del nivel 1 que no sobrevivieron al
contraste.

**1. El panel se compromete con el claro. No hay modo oscuro** (PRO-25). Un juego
de tokens, cada color elegido y verificado una vez. Pesó la medida: `apps/web`
tiene 381 colores escritos a mano, 259 clases de Tailwind y 122 `rgba()`. Con dos
modos son 762 decisiones de contraste en vez de 381, y la sombra suave que separa
superficies en claro no se ve sobre fondo oscuro, así que el segundo modo pedía
un mecanismo propio.

Si algún día hace falta el oscuro, lo que hay que hacer está acotado y es esto:
darle pareja a cada token de este contrato, e inventar qué separa dos superficies
cuando la sombra no sirve. Ningún componente debería necesitar cambios si nadie
escribe colores fuera de los tokens, que es justo lo que PRO-26 viene a garantizar.

**2. Los dos tintes de operación se oscurecen.** Medido contra las superficies de
este spec, el violeta `#a78bfa` de Guatemala da 2,51:1 sobre el fondo y 2,30:1
sobre el riel; el azul `#38bdf8` de Colombia da 1,97:1 y 1,81:1. AA pide 4,5:1
para texto y 3:1 para componentes, así que fallaban las dos cosas. Los valores
nuevos están en el contrato de abajo y conservan violeta y azul, que es lo que
hace que las dos operaciones se distingan de un vistazo.

**3. El tono «suave» (`#84978d`) deja de ser color de texto.** Da 2,85:1 sobre el
fondo y 3,09:1 sobre tarjeta. Queda para líneas, iconos y separadores. Los 79
textos que hoy lo usan pasan a «tenue» (`#5b6f66`), que sí llega a AA con 4,95:1
sobre el fondo y 4,54:1 sobre el riel.

**4. Los cinco pares de estado del nivel 1 pasan AA sin tocarlos**, entre 5,25:1
y 6,33:1. No hay nada que rederivar ahí. Está medido para que nadie lo vuelva a
dudar.

### Los prototipos, como referencia visual

No se integran. Están archivados en los comentarios de PRO-19, PRO-21 y PRO-22.

## El contrato de nombres

Los tres tickets de implementación corren **a la vez**, en worktrees separados, y
solo PRO-26 escribe `globals.css`. Para que eso no reviente al mergear, los
nombres de tokens, de clases y del componente compartido están fijados acá antes
de que exista una línea de código. Es el mismo recurso global que el número de
migración: lo reparte la sesión que coordina, no lo inventa cada worktree.

**Si algo de este contrato le queda mal a un ticket, se avisa. No se cambia por
cuenta propia:** los otros dos worktrees ya están escribiendo contra él.

### Tokens

Los nombres de mucho tráfico se conservan y solo cambia el valor. Los que cambian
de nombre lo hacen porque cambió su significado, y así ningún uso viejo sobrevive
por descuido.

| token | valor | notas |
| -- | -- | -- |
| `--color-bg` | `#f4f6f5` | fondo de la aplicación |
| `--color-surface` | `#f9fbfa` | superficie de pantalla. Antes `--color-bg-soft` |
| `--color-card` | `#ffffff` | tarjeta. Antes `--color-panel` |
| `--color-rail` | `#e8edeb` | riel de operaciones. Nuevo |
| `--color-menu` | `#eef1f0` | columna de módulos. Nuevo |
| `--color-hover` | `#e9efec` | realce al pasar por encima. Nuevo |
| `--color-text` | `#12201b` | 252 usos, no se renombra |
| `--color-text-strong` | `#08120e` | nuevo |
| `--color-text-dim` | `#5b6f66` | «tenue». Sus 109 usos más los 79 que emigran de `text-soft` |
| `--color-text-soft` | `#84978d` | «suave». **No es color de texto** (2,85:1). Líneas, iconos, separadores |
| `--color-border` | `#e5ebe8` | línea suave, la de por defecto. 74 usos |
| `--color-border-strong` | `#d8e0dc` | línea, para énfasis. 9 usos |
| `--color-ink` | `#0f766e` | tinta. **Reemplaza `--color-accent`**, que se retira con el menta |
| `--color-ink-soft` | `#dbe8e4` | |
| `--color-ink-wash` | `#eef5f3` | |
| `--color-danger` | `#a52020` | el texto de «escalada». Conserva el nombre, 15 usos |
| `--color-warn` | `#8a5a08` | el texto de «sin responder». Antes `--color-highlight` |
| `--color-bubble-out` | `#dbe8e4` | la burbuja nuestra. Deja de ser degradado |
| `--color-bubble-in` | `#ffffff` | la burbuja del cliente, con `--color-border` |
| `--shadow-panel` | `0 1px 2px rgba(18,32,27,.05), 0 6px 18px -12px rgba(18,32,27,.22)` | la sombra que separa superficies |

Los cinco pares de estado, como tokens propios porque los usan dos tickets:

| token | fondo | texto | contraste |
| -- | -- | -- | -- |
| `--state-espera-*` | `#fdf0d8` | `#8a5a08` | 5,25:1 |
| `--state-auto-*` | `#d8f0e8` | `#0b5f52` | 6,33:1 |
| `--state-escalada-*` | `#fde0e0` | `#a52020` | 5,98:1 |
| `--state-novedad-*` | `#eae4fd` | `#5a41a8` | 6,17:1 |
| `--state-sinprod-*` | `#e6ecf0` | `#41586a` | 6,23:1 |

Cada uno con sufijo `-bg` y `-fg`, por ejemplo `--state-espera-bg`.

**Se retiran** `--color-accent`, `--color-accent-strong`, `--color-accent-hover`,
`--color-highlight`, `--color-bg-soft`, `--color-panel`, `--color-panel-2` y
`--color-panel-3`. Ninguno debe quedar en el árbol.

`--font-body` y `--font-display` se quedan con el mismo valor y no se toca la
familia. El veredicto del nivel 1 fue que faltaba escala, no una segunda familia.

### Los tintes de operación

En `packages/shared/src/operation-framing.ts`, que **también lo importa el
worker**, así que el cambio es de valores y no de firma.

| | hoy | nuevo | contraste sobre el riel |
| -- | -- | -- | -- |
| `GT` | `#a78bfa` | `#6d28d9` | 6,00:1 |
| `CO` | `#38bdf8` | `#0369a1` | 5,01:1 |

Los cuatro de repuesto pasan a `#be185d`, `#92400e`, `#166534` y `#334155`. Los
cuatro llegan a AA sobre el riel, que es la superficie más oscura y por eso la
que manda. `line`, `soft` y `faint` siguen saliendo del mismo `withAlpha`.

### Clases

| clase | qué es | valores |
| -- | -- | -- |
| `.app-context` | línea de contexto de página, sobre el `h1` | 10,5px · 700 · `letter-spacing: .11em` · versalitas · `--color-ink` |
| `.app-title` | título de pantalla | 34px · 700 · `letter-spacing: -.03em` |
| `.app-section` | encabezado de sección dentro de una pantalla | 16px · 600 · `--color-text-strong` |
| `.app-label` | etiqueta de campo, para `dt` y `legend` | igual que `.app-context` pero en `--color-text-dim` |
| `.state-chip` | base de las etiquetas de estado de la fila | 9,5px · 800 · `letter-spacing: .06em` · versalitas · `border-radius: 5px` |

Los cinco modificadores: `.state-chip--espera`, `--auto`, `--escalada`,
`--novedad`, `--sin-producto`.

**`.app-eyebrow` desaparece.** Es la clase que hacía dos trabajos, y este es el
reparto de sus ocho usos actuales:

| dónde | pasa a |
| -- | -- |
| `catalogo/page.tsx:19` y `reporte-meta/page.tsx:36` | `.app-context` |
| `catalogo-client.tsx:711, 924, 1125` (son `h3`) | `.app-section` |
| `reporte-client.tsx:121, 136, 164` (son `dt` y `span`) | `.app-label` |

### El componente compartido

`apps/web/src/app/(app)/context-line.tsx`, **lo crea PRO-27 y lo importa PRO-28**:

```tsx
export function ContextLine({
  op,
  pantalla,
}: {
  op: { name: string; countryCode: string };
  pantalla: string;
}): React.ReactElement
```

Dibuja `<p className="app-context">` con la bandera del país, el nombre de la
operación y la pantalla, separados por `·`. La bandera sale del mismo mecanismo
del riel (`.op-flag` en `operation-rail.tsx`), no de un emoji nuevo.

### Quién es dueño de qué archivo

Un archivo tiene un solo dueño en esta tanda. Es la regla que hace posible correr
los tres a la vez.

| PRO-26 · el sistema y la configuración | PRO-27 · siete pantallas y Pedidos | PRO-28 · el Inbox entero |
| -- | -- | -- |
| `app/globals.css` | `context-line.tsx` (lo crea) | `inbox/page.tsx` |
| `(app)/layout.tsx` | `agent/page.tsx` | `inbox/inbox-client.tsx` |
| `(app)/operation-rail.tsx` | `catalogo/page.tsx` | `inbox/loading.tsx` |
| `(app)/choose-operation.tsx` | `connection/page.tsx` | `inbox/voice-recorder.tsx` |
| `(app)/connection-indicator.tsx` | `reporte-meta/page.tsx` | los 4 `inbox/*.test.tsx` |
| `shared/operation-framing.ts` | `templates/page.tsx` | |
| `agent/`, `connection/`, `templates/`, `vendedor/`, `catalogo/`, `reporte-meta/` salvo sus `page.tsx` | `vendedor/page.tsx` | |
| `login/page.tsx` | `orders/` completo | |

El `h1` del Inbox vive en `inbox-client.tsx:760` y no en su `page.tsx`, así que
la línea de contexto del Inbox la pone PRO-28 y no PRO-27. Por eso PRO-28 es
dueño también de `inbox/page.tsx`: ahí es donde hay que pasarle el nombre y el
país de la operación al cliente, que hoy solo recibe `operationId`.

Este `spec.md` lo edita **solo la sesión que coordina**. Tres worktrees tocándolo
es un conflicto de merge garantizado.

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

**La identidad se conserva.** ~~Fondo oscuro, familia de azules profundos, acento menta.~~ **El nivel 1 decidió lo contrario y esta viñeta quedó vieja.** El panel pasa a fondo claro y el acento menta se retira. Lo que sigue en pie es el resto de la frase: lo que se agrega es jerarquía. La variante Claro se lo ganó contra las demás, que es exactamente lo que esta viñeta dejaba abierto.

**Segunda tipografía para títulos.** ~~La ronda del nivel 1 decide qué familia entra.~~ **Decidió que ninguna.** El problema no era que faltara una familia, era que no había escala. `--font-display` y `--font-body` se quedan con el mismo valor.

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
