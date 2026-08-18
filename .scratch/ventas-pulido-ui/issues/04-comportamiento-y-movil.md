# 04 — Comportamiento: componentes que no se rompen, en móvil y en escritorio

**What to build:** Un rediseño **de comportamiento** del panel existente. No de colores, no de flujos: que ningún componente esté roto y que la experiencia sea la correcta tanto en móvil como en escritorio.

**Blocked by:** None — can start immediately.

**Status:** resolved — worktree `ui-comportamiento`, veredicto del usuario el 17-ago-2026 («la UI me parece bien por ahora»)

Pedido del usuario el 16-ago-2026, en paralelo con la migración multi-operación.

## Qué NO es este ticket

Es importante, porque el resto de este mapa dice otra cosa.

- **No es un cambio de colores ni de sistema visual.** La identidad del panel se respeta tal cual.
- **No es un rediseño de experiencia.** Los flujos y la información de cada pantalla se quedan donde están; no se mueven pasos ni se reordenan tareas.
- **No es el ejercicio de prototipos** de los tickets 01–03 de este mapa. Aquel produce *decisiones de forma* con cinco variantes y veredicto del usuario. Este arregla *comportamiento* sobre el código que ya existe. Son ejes distintos y no se estorban.
- **No es construir las pantallas nuevas del Panel de Ventas.** Eso es de `ventas-panel`.

**Sí levanta el móvil**, que el spec de este mapa dejó fuera «salvo que una ronda lo levante como necesidad real». El usuario lo levantó.

## Medido contra el código (16-ago-2026)

**4.665 líneas de TSX en 13 componentes**, cinco pantallas dentro de `(app)` más login.

| Componente | Líneas |
| -- | -- |
| `inbox/inbox-client.tsx` | 1.023 |
| `agent/prompt-card.tsx` | 544 |
| `agent/agent-form.tsx` | 533 |
| `connection/dropi-panel.tsx` | 510 |
| `orders/orders-table.tsx` | 507 |
| `templates/template-editor.tsx` | 344 |
| `connection/shopify-panel.tsx` | 288 |
| `inbox/voice-recorder.tsx` | 206 |

**El armazón sí es responsive, y está bien hecho.** En `globals.css`, `.app-shell` es `grid-cols-1` y pasa a `lg:grid-cols-[248px_1fr]`; la barra lateral se vuelve barra superior en móvil y su navegación es un carrusel de scroll horizontal (`overflow-x-auto` + `lg:flex-col`). Eso no hay que rehacerlo: **hay que respetarlo y extenderlo hacia adentro.**

**Lo de adentro no lo es.** En 4.665 líneas hay **veinte usos de breakpoint en total** — `md:` ×10, `lg:` ×4, `xl:` ×3, `sm:` ×3. Es decir: el armazón se adapta y el contenido no.

**Señales concretas para empezar a buscar, no conclusiones:**

- **Una sola `<table>`** (`orders-table.tsx`) y **solo dos `overflow-x` en toda la aplicación**. Una tabla ancha sin contenedor que desborde es la forma más común de romper el ancho del cuerpo en móvil.
- **Ocho anchos fijos en píxeles.** Cada uno es un candidato a desbordar una pantalla de 390 px.
- **`inbox-client.tsx`, 1.023 líneas, es el sospechoso número uno.** Es una interfaz de chat, y una bandeja de dos paneles —lista y conversación— es lo que peor se comporta en móvil: o se aprietan los dos, o el hilo queda inalcanzable.
- **Next 16 con App Router inyecta el meta de viewport por defecto**, así que la ausencia de un `export const viewport` en `app/layout.tsx` probablemente no es un defecto. **Verificarlo en el HTML servido antes de tocarlo** — no asumir en ninguna de las dos direcciones.

## Criterios

- [x] Existe un inventario de lo que está roto, **medido en el navegador**, no supuesto leyendo el código: qué componente, en qué ancho, y qué le pasa.
- [x] Ningún componente desborda horizontalmente el cuerpo de la página en 390 px.
- [x] Todo lo que sea ancho por naturaleza —tablas, bloques de código, diagramas— desborda **dentro de su propio contenedor**, no del documento.
- [x] La bandeja es usable en móvil: se puede llegar a una conversación, leerla y responder.
- [x] Los objetivos táctiles son alcanzables; nada queda debajo del teclado ni fuera de alcance del pulgar.
- [x] Ningún componente queda roto en escritorio por arreglar el móvil. **La regresión en la dirección contraria es el riesgo real de este ticket.**
- [x] `pnpm -r typecheck` limpio.
- [x] El usuario da el veredicto visual en los anchos reales. **No se cierra sin eso.**

## Cómo se verifica

**Con el navegador, no con el código.** El repo no tiene arnés de pruebas de interfaz y este ticket no lo va a construir. La verificación es: levantar el panel, recorrer las cinco pantallas en tres anchos —**390 px, 768 px y escritorio**— y anotar qué se rompe.

**Se corre con el usuario presente**, que es quien da el veredicto de «esto está bien». Un agente que decide solo si la experiencia es la ideal no está haciendo el ejercicio.

## Riesgo de colisión

El ticket 06 de `ventas-multi-operacion` —el contract— toca `apps/web/src/lib/queries.ts` y las llamadas de datos de `app/(app)/agent/page.tsx`. Este ticket no debe tocar la obtención de datos de esos dos archivos: solo su presentación.

## Answer

Medido en el navegador con Playwright (Chrome real), 5 pantallas × 3 anchos —390, 768, 1440—,
comparando `scrollWidth` contra `clientWidth` del documento y la geometría de cada elemento.
No es lectura de código: son los números del panel corriendo contra producción.

### Lo que estaba roto

**1. El Inbox no cabía a lo alto, y ese era el defecto grave — no estaba en la hipótesis.**

| | 390 px | 768 px | Escritorio |
| -- | -- | -- | -- |
| Alto de la página | **50.019 px** | **46.462 px** | 900 px (sano) |
| Alto de la lista | 20.691 px | 20.691 px | 744 px |
| El hilo empezaba en | **y = 21.354 px** | y = 21.253 px | y = 144 px |

La lista renderizaba las 200 conversaciones sin scroll propio. Para leer una conversación en
el móvil había que bajar veintiún mil píxeles, y el compositor quedaba al fondo de cincuenta
mil. Causa: en `inbox-client.tsx:300` la altura del viewport (`h-[calc(100vh-46px)]`) solo se
aplica en `xl:`. Debajo de ese breakpoint la cadena `min-h-0` / `h-full` / `overflow-y-auto`
no tiene contra qué resolver y todo crece a contenido.

**2. Desbordamiento horizontal a 390 px:** Inbox **138 px**, Plantillas **20 px**. A 768 y en
escritorio no había desbordamiento en ninguna pantalla.

- Inbox: el `<aside>` de la lista medía **516 px dentro de un viewport de 390**. Los items de
  grid traen `min-width: auto`, así que su mínimo lo fijaba el min-content — y un
  `<p class="truncate">` con `white-space: nowrap` lo infla sin límite. Lo mismo pasaba un
  nivel más arriba: `.app-main` es item del grid de `.app-shell` y tenía el mismo defecto.
- Plantillas: nombre + badge en una fila sin permiso para envolver, junto a un `shrink-0`.

**3. Objetivos táctiles bajo 36 px:** Pedidos 7 botones de 24×24 y 5 selects de 32 px; Agente
interruptores de 36×20 y botones de 24–26 px; Plantillas 11 botones de 26 px; Inbox select de
28 px y campo de búsqueda de 32 px.

### Tres hipótesis del ticket que la medición refutó

- **La tabla de Pedidos ya estaba bien.** `orders-table.tsx:290` tiene `overflow-x-auto` en su
  tarjeta: la tabla sobresale 532 px **dentro de su contenedor**, que es exactamente el
  criterio pedido. No se tocó.
- **El carrusel de navegación no estaba roto.** Los `min-w-[156px]` sobresalen, pero dentro del
  `nav.overflow-x-auto`. Es el diseño intencional del armazón. No se tocó.
- **El viewport meta estaba presente.** Confirmado en el HTML servido:
  `width=device-width, initial-scale=1`. Next 16 lo inyecta. No se tocó.

### Lo que se arregló

Todo cambio de móvil se anula en `lg:`/`xl:`, así que escritorio queda byte por byte como estaba.

- `globals.css` — `min-w-0` en `.app-main`.
- `inbox-client.tsx` — altura del viewport para lista (`h-[55vh]`) e hilo (`h-[80vh]`) debajo
  de `xl`, con `xl:h-auto` para devolver el comportamiento de escritorio; `min-w-0` en ambos
  items de grid; las 5 tarjetas de resumen a 2 columnas en vez de 1 a 390 px.
- `template-editor.tsx` — `min-w-0` y `flex-wrap` en la fila de nombre + badge.
- `orders-table.tsx`, `agent-form.tsx`, `prompt-card.tsx`, `template-editor.tsx` — objetivos
  táctiles a 36 px debajo de `lg`. El interruptor del Agente conserva su aspecto exacto: el
  área de toque crece con un pseudo-elemento invisible (36×20 visible, **52×36 tocable**,
  verificado con `elementFromPoint`).

### Resultado medido

- **Desbordamiento horizontal: 0 px en las 15 combinaciones** (antes 138 y 20).
- **Inbox a 390: la página pasó de 50.019 px a 1.765 px.** El hilo empieza en y=1.078 en vez
  de y=21.354. A 768: de 46.462 a 1.960 px.
- **Objetivos táctiles bajo 36 px a 390 y 768: cero** en las cinco pantallas (los 3
  interruptores del Agente miden 36×20 de rect pero 52×36 de área real).
- **Escritorio sin regresión:** desbordamiento 0, geometría idéntica (lista 336 / hilo 812,
  página 900 px = viewport) y el conteo de objetivos pequeños en 1440 quedó igual que en la
  medición inicial — 4/14/10/14/0.
- `pnpm -r typecheck` limpio en los 4 paquetes. `apps/worker`: 70 tests en verde (el ticket
  decía 81; son 70 en esta rama, y no se tocó nada del worker).

### Lo que se decidió NO arreglar

- **La bandeja no se convirtió en maestro-detalle.** El patrón correcto en móvil sería que
  tocar una conversación reemplace la lista, con botón de volver. Eso es rediseño de flujo y
  este ticket lo prohíbe explícitamente. Queda dicho, no hecho: **lista y hilo siguen
  apilados**, ahora con scroll propio cada uno.
- **La densidad de escritorio no se tocó** en ningún control. Los objetivos pequeños siguen
  pequeños en 1440 a propósito: ahí hay ratón, y es donde el panel se usa a diario.
- **`inbox/page.tsx`, `queries.ts` y `agent/page.tsx` quedaron intactos** — son del ticket 06.

### Pendiente

El veredicto visual de Daniel en los tres anchos. El ticket no se cierra sin eso.
