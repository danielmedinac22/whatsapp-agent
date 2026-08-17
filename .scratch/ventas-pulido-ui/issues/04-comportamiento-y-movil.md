# 04 — Comportamiento: componentes que no se rompen, en móvil y en escritorio

**What to build:** Un rediseño **de comportamiento** del panel existente. No de colores, no de flujos: que ningún componente esté roto y que la experiencia sea la correcta tanto en móvil como en escritorio.

**Blocked by:** None — can start immediately.

**Status:** claimed — worktree `ui-comportamiento`, tanda del 16-ago-2026

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

- [ ] Existe un inventario de lo que está roto, **medido en el navegador**, no supuesto leyendo el código: qué componente, en qué ancho, y qué le pasa.
- [ ] Ningún componente desborda horizontalmente el cuerpo de la página en 390 px.
- [ ] Todo lo que sea ancho por naturaleza —tablas, bloques de código, diagramas— desborda **dentro de su propio contenedor**, no del documento.
- [ ] La bandeja es usable en móvil: se puede llegar a una conversación, leerla y responder.
- [ ] Los objetivos táctiles son alcanzables; nada queda debajo del teclado ni fuera de alcance del pulgar.
- [ ] Ningún componente queda roto en escritorio por arreglar el móvil. **La regresión en la dirección contraria es el riesgo real de este ticket.**
- [ ] `pnpm -r typecheck` limpio.
- [ ] El usuario da el veredicto visual en los anchos reales. **No se cierra sin eso.**

## Cómo se verifica

**Con el navegador, no con el código.** El repo no tiene arnés de pruebas de interfaz y este ticket no lo va a construir. La verificación es: levantar el panel, recorrer las cinco pantallas en tres anchos —**390 px, 768 px y escritorio**— y anotar qué se rompe.

**Se corre con el usuario presente**, que es quien da el veredicto de «esto está bien». Un agente que decide solo si la experiencia es la ideal no está haciendo el ejercicio.

## Riesgo de colisión

El ticket 06 de `ventas-multi-operacion` —el contract— toca `apps/web/src/lib/queries.ts` y las llamadas de datos de `app/(app)/agent/page.tsx`. Este ticket no debe tocar la obtención de datos de esos dos archivos: solo su presentación.
