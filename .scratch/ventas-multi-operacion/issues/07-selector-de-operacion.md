# 07 — Selector de operación en el panel

**What to build:** El admin elige sobre qué operación está trabajando, y qué operación está activa se ve sin buscarla. Todo lo que muestra y edita el panel —catálogo, anuncios, configuración, conversaciones— corresponde a esa operación.

**Blocked by:** 06

**Status:** resolved — ola del 18-ago-2026, mergeado y desplegado. Migración `0024` aplicada a producción

- [x] Hay un selector de operación accesible desde toda la sección.
- [x] **La operación activa es evidente en pantalla sin abrir el selector.** El error que esto previene —editar el país equivocado— es silencioso, así que la señal tiene que ser pasiva.
- [x] Cambiar de operación cambia todo el contenido de la sección.
- [x] La selección persiste entre pantallas dentro de la sesión del admin.
- [x] No hay pantalla que muestre datos de dos operaciones mezclados.

## Answer — el mecanismo (18-ago-2026, sesión coordinadora)

**La forma visual ya estaba decidida y no se re-litiga.** El nivel 1 del árbol de
diseño (`ventas-pulido-ui/01`) la cerró con el usuario en tres rondas de
prototipos: riel de operaciones a la izquierda que **tiñe la barra** con el color
del país activo, módulo anidado dentro, **número de teléfono junto al color**, y
colapso a **46px** que conserva el país y la navegación. Violeta Guatemala, cian
Colombia. El tinte **muere en el borde del marco**: el contenido conserva la
paleta neutra, para que el verde siga significando «confirmado». Referencia:
`ventas-pulido-ui/prototipos/nivel-1-encuadre.PROTOTIPO.html`.

Lo que ese nivel **no** decidió es cómo viaja la selección. Eso se decidió hoy.

### Cookie httpOnly en el panel, header hacia el worker

Elegido por el usuario sobre el segmento en la URL (`/gt/inbox`) y sobre meterlo
en la sesión de next-auth.

- **`apps/web`** resuelve la operación con una función propia — sugerido
  `apps/web/src/lib/operation.ts`, `resolvePanelOperation()`: si hay cookie,
  `requireOperationById(id)`; si no, `requireSoleActiveOperation()`. **El
  fallback es lo que mantiene a Guatemala funcionando sin que nadie elija nada.**
- **`workerFetch`** (`apps/web/src/lib/worker.ts`) reenvía la operación como
  header `x-operation-id`. Las seis rutas del worker que hoy llaman
  `panelOperation()` la toman de ahí, con el mismo fallback.
- **Ninguna URL existente cambia.** Ese fue el criterio: el segmento en la URL
  obligaba a mudar las ocho pantallas a una ruta dinámica y tocar todos los
  `href`, y la señal en pantalla ya la da el riel teñido — la barra de
  direcciones no tenía que cargarla.

**Por qué la cookie no se lee desde `@wa/db`:** `panelOperation()` vive en un
paquete que también importa el worker, que no tiene contexto de request de
Next.js. `requireSoleActiveOperation()` se queda donde está y el que sabe de
cookies es `apps/web`. `panelOperation()` queda como lo que siempre fue —el
puente— y este ticket es el que lo retira del panel.

### Recursos repartidos desde la sesión coordinadora

Para que tres worktrees en paralelo no se pisen:

- **Este worktree es el único dueño de `apps/web/src/app/(app)/layout.tsx`.**
  Además del riel, agrega las dos entradas de menú de las pantallas que se
  construyen en paralelo, con estas rutas ya fijadas: **`/catalogo`** (Catálogo)
  y **`/vendedor`** (Vendedor). Van dentro del módulo de Ventas, anidadas en la
  operación. Las páginas las crean los otros worktrees; si al mergear este
  primero el enlace apunta a una pantalla que aún no existe, es temporal y se
  cierra en la misma ola.
- **Ningún otro worktree de esta ola toca `layout.tsx`.**

### Medido en producción (18-ago-2026, solo lectura)

`operations` = **1 fila**: `GT`, `active`, id `63937b3d-6312-446d-8bb8-1b9468afdd87`.
Con una sola operación activa el fallback cubre todo y **el comportamiento
observable de Guatemala no cambia en ningún paso**: sin cookie, `panelOperation()`
y `resolvePanelOperation()` devuelven la misma fila.


## Answer — lo construido (18-ago-2026, worktree `selector-operacion`)

El panel ya no pregunta «cuál es la única operación»: pregunta **sobre cuál
eligió trabajar el admin**. `panelOperation()` no existe más — no quedó
desaconsejado, se borró, y el compilador demostró que no quedaba ningún llamador.

### Lo que el admin ve

A la izquierda hay un **riel con todas las operaciones**, la que atiende y la que
todavía no. La activa tiñe el riel y la columna de navegación con el color de su
país —violeta Guatemala, cian Colombia— y junto al color va **el número de
teléfono que le sale al cliente**, que es el dato que hace el error
irreversible. El módulo (Ventas, Confirmación) va anidado dentro del país, nunca
al lado.

**El color muere en el borde del marco.** El contenido conserva la paleta de
siempre, así que el verde sigue queriendo decir «confirmado» y nada más. Es la
decisión que más se defendió: si el acento siguiera al país, cada botón
principal cambiaría de color y Guatemala —que es la que factura— perdería la
señal que más usa.

Las barras se pliegan a un riel angosto que conserva las tres cosas que
importan: en qué país estás, que existe el otro, y cómo moverte por la pantalla
en la que estás. Lo que se pierde son los nombres de las pantallas y el teléfono.
El plegado se recuerda entre pantallas y entre sesiones, y **cambiar de país lo
deshace**: es el único momento en que el contexto cambió de verdad y vale
interrumpir. Volver a plegar es siempre acto del usuario.

### Cómo viaja la elección

Cookie en el panel, header hacia el worker, como se había decidido. La cookie es
`httpOnly` —el navegador no la puede escribir— y la escriben dos acciones de
servidor que **solo aceptan una operación que exista**. Ninguna dirección de
ninguna pantalla cambió.

Sin elección, el panel resuelve **la única que atiende**. Ese fallback es lo que
hace que hoy no cambie absolutamente nada: hay una sola operación, así que un
admin que nunca toque el riel ve exactamente lo que veía. Verificado con las
cinco pantallas contra una base de ensayo.

### Lo que hubo que corregir sobre el mecanismo decidido

**El mecanismo escrito acá dejaba el panel sin salida el día de la apertura de
Colombia, y se descubrió probándolo, no leyéndolo.**

La regla decía: con cookie, esa operación; sin cookie, la única activa. No decía
qué pasa **con dos operaciones atendiendo y sin cookie**, que es exactamente el
estado del primer día de Colombia y el primer día de cada admin. Y ahí la regla
fallaba en el marco — que es justamente el que dibuja el riel con el que se
elige. Para elegir hacía falta un riel que no se podía dibujar hasta haber
elegido.

Se corrigió sin ablandar la regla, que era la tentación fácil: elegir un país por
el admin habría sido el error que toda esta migración existe para hacer
imposible. En vez de eso, **el marco se dibuja siempre** y, mientras no haya
elección, muestra en lugar de la pantalla un texto que dice cuántas operaciones
atienden y que hay que elegir una en el riel. Ninguna pantalla se renderiza
mientras tanto: no es un aviso encima del contenido, es en vez del contenido —
mostrar el Inbox de un país que nadie eligió, con una advertencia arriba que se
deja de leer a los tres días, es la forma silenciosa del mismo error.

### Las dos entradas de menú de la ola

`/catalogo` (Catálogo) y `/vendedor` (Vendedor) están en el menú, dentro del
módulo de Ventas, y **con su regla de acceso**, que era la mitad fácil de
olvidar: sin esa línea el menú no las ofrece a nadie con rol de módulo y la
pantalla existiría sin que nadie la viera. Las páginas las construyen los otros
dos worktrees; hasta que mergeen, los dos enlaces llevan a una pantalla que no
existe.

### Lo que se descartó

- **Elegir un país por defecto cuando hay ambigüedad.** Ver arriba.
- **Traducir la elección a fila antes de mandarla al worker.** El worker la
  valida con la misma regla; hacerlo dos veces es una consulta por llamada para
  tirar el resultado.
- **Que el riel muestre solo las operaciones que atienden.** Que exista el otro
  país es la mitad de lo que el riel comunica, y configurar Colombia antes de
  activarla es el trabajo que este ticket destraba. Se puede elegir una
  operación dormida; lo que no se puede es *caer* en una sin elegirla.
- **Recordar el plegado por pantalla.** Un marco que se pliega y se despliega
  solo al navegar es peor que no poder plegarlo.
