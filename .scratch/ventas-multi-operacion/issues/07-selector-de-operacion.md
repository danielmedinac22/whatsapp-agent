# 07 — Selector de operación en el panel

**What to build:** El admin elige sobre qué operación está trabajando, y qué operación está activa se ve sin buscarla. Todo lo que muestra y edita el panel —catálogo, anuncios, configuración, conversaciones— corresponde a esa operación.

**Blocked by:** 06

**Status:** claimed — worktree `selector-operacion`, ola del 18-ago-2026

- [ ] Hay un selector de operación accesible desde toda la sección.
- [ ] **La operación activa es evidente en pantalla sin abrir el selector.** El error que esto previene —editar el país equivocado— es silencioso, así que la señal tiene que ser pasiva.
- [ ] Cambiar de operación cambia todo el contenido de la sección.
- [ ] La selección persiste entre pantallas dentro de la sesión del admin.
- [ ] No hay pantalla que muestre datos de dos operaciones mezclados.

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
