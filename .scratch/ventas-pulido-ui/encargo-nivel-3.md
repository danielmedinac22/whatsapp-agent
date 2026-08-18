# Encargo — Nivel 3 del árbol de diseño: los componentes individuales

Para una sesión nueva. Rama: `danielmedinac22/grill-nivel-1`. Dependencias y `.env` puestos.

## 0 · Esto no es un encargo autónomo. Léelo primero.

**Daniel trabaja contigo en la sesión y él da los veredictos.** El spec lo dice con todas las letras: *«un agente que responde sus propias preguntas de diseño no está haciendo el ejercicio»*.

Tu trabajo es **producir las variantes y hacerle las preguntas**, no elegir. Si te encuentras razonando cuál te gusta más para cerrar el ticket, párate.

**El método es el skill `grill-design`** (`~/.claude-personal/skills/grill-design/SKILL.md`), que a su vez corre `/grilling` usando `/prototype`. Ojo: **`grilling-frontend-prototyping` tiene `disable-model-invocation`** — no lo puedes invocar tú. Si Daniel lo pide por ese nombre, pídele que escriba `/grilling-frontend-prototyping` él mismo; redirige a `grill-design`.

## 1 · Qué falta

El ticket: `.scratch/ventas-pulido-ui/issues/03-nivel-3-componentes.md`
El spec: `.scratch/ventas-pulido-ui/spec.md`
La restricción permanente: `.scratch/panel-de-ventas/no-regresion.md`

**Antes de prototipar nada, lee los `## Answer` de los tickets 01 y 02 de este mapa.** Están largos a propósito: son seis grupos de decisiones con su razón, y varias de las piezas del nivel 3 ya quedaron resueltas de hecho al construir el nivel 2. Prototipar de nuevo lo ya decidido es la forma más rápida de que Daniel rechace la ronda entera.

**Lo que probablemente ya está resuelto y solo hay que verificar con él:**

| Criterio del ticket 03 | Dónde se resolvió |
|---|---|
| Producto conectado vs nativo sin leer | Nivel 2 · catálogo — origen como columna + aviso de solo lectura en la ficha |
| Archivos enviables de un vistazo | Nivel 2 · catálogo — interruptor por archivo, conteo «2 de 4 enviables» |
| Estado de reconocimiento sin abrir | Nivel 2 · conversaciones — la fila marca solo lo que **no** es limpio |
| Tomar y devolver el chat | **Se descartó el concepto.** Es `Agente: ON/OFF`, que ya existe en producción |

**Lo que queda de verdad:** el campo de identificador de anuncio —«registrar un anuncio se siente de segundos», que el spec señala como lo que determina el soporte recurrente no cotizado— y el nivel de detalle de la tarjeta de producto.

Si al leer los Answer concluyes que el nivel 3 es más corto que su ticket, **dilo**: es un hallazgo, no una desviación.

## 2 · Lo que ya está decidido y no se re-abre

En una frase: **riel de operaciones a la izquierda que tiñe la barra con el color del país activo, módulo anidado dentro, colapsable a 46px; las conversaciones son vistas dentro del Inbox que ya existe; el catálogo es una tabla densa; la configuración del vendedor son secciones apiladas.**

Los prototipos de referencia, ya publicados:

- Encuadre · https://claude.ai/code/artifact/49aaa256-1d0e-4e36-a9eb-f6ef6a2bcfd0
- Conversaciones y ficha · https://claude.ai/code/artifact/72e9c18e-c420-4461-aaab-76fff296cf9a
- Catálogo · https://claude.ai/code/artifact/47f1fe73-bec0-4792-adb3-b8e65897b33c
- Vendedor · https://claude.ai/code/artifact/5ee4637d-3d44-4386-bfc2-2a1cdc480384
- Tablero · https://claude.ai/code/artifact/301e8f71-dcad-4b50-b3fd-f54214531562

Los archivos están en `.scratch/ventas-pulido-ui/prototipos/`. **Reutiliza su armazón** en vez de reconstruirlo: el riel, la columna, el plegado y la paleta ya están resueltos y copiarlos cuesta menos que rehacerlos.

## 3 · Cómo se trabaja acá — esto es lo que más te ahorra

Tres prácticas salieron de errores concretos de la sesión anterior. No son estilo:

**Investiga antes de proponer, no después.** La primera ronda del nivel 2 la rechazó entera («ninguna me convence») porque las cinco variantes le pusieron vocabulario nuevo a actos que el panel ya nombra en producción. Antes de diseñar una pieza:

1. **Mira el código existente.** `apps/web/src/app/(app)/` — sobre todo `inbox/inbox-client.tsx` (1.023 líneas), `agent/agent-form.tsx` y `agent/prompt-card.tsx`. Si la pieza ya existe con otro nombre, se usa ese nombre.
2. **Mira Mobbin.** El MCP está instalado (`mcp__mobbin__search_screens`). Daniel lo pidió explícitamente y las rondas que nacieron con referencias fueron las que funcionaron.

**Verifica que renderiza.** No hay extensión de Chrome conectada, pero sí Chrome headless:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --hide-scrollbars --window-size=1680,1000 --screenshot=out.png \
  --virtual-time-budget=1300 "file:///ruta/al/prototipo.html"
```

Y `node --check` sobre el `<script>` extraído. Varios defectos reales —etiquetas truncadas, texto pegado, una variante sin navegación— solo aparecieron mirando el PNG.

**Registra el veredicto con su razón, textual.** El ticket lo exige y la razón vale más que la elección: es lo que lee quien construye. Si Daniel elige sin dar razón, pregúntasela — no la inventes.

## 4 · Los datos reales, para que los mocks no sean de laboratorio

- **Guatemala**: `GT`, GTQ, +502 3689 0343, 1.678 pedidos, 88,4% de confirmación. **Es la que factura.**
- **Colombia**: `CO`, COP, +57 304 5430173 — existe y **no opera todavía**.
- **Los cuatro SKUs REVITALHAIR de nombre casi idéntico** —*DHT ANTICALVICIE* (77% del volumen, 1.263 pedidos), *DHT BLOCKER ANTICALVICIE*, *COMBO DHT + SERUM 360*, *Hair Recovery 3X*— son el problema real, no un detalle. Con nombres genéricos el mock miente.
- Paleta decidida: **violeta `#a78bfa` Guatemala, cian `#38bdf8` Colombia**. La menta `#6ee7b7` quedó liberada y significa solo «correcto».

## 5 · Qué NO hacer

- **No implementes nada en `apps/web`.** Los prototipos son desechables: *«se archivan como referencia visual, no se integran»*.
- **No rediseñes** confirmaciones, pedidos ni plantillas.
- **No reintroduzcas vocabulario nuevo** para actos que ya tienen nombre. Está descartado explícitamente en el Answer del ticket 02.
- **El `.env` es producción.** Si levantas el panel, míralo y no lo modifiques; **jamás mandes un mensaje desde el Inbox** — le escribe a un cliente real. **No arranques el worker.**
- No deployes, no mergees, no borres el worktree.

## 6 · Suelto, con dueño nuevo

`ventas-multi-operacion/issues/10-consultas-del-panel-por-operacion.md` — levantado el 18-ago-2026 desde esta sesión: ninguna de las doce consultas de `queries.ts` filtra por operación. **No es del nivel 3** y no lo tomes; está anotado para que no se pierda.

---

**El ticket es una hipótesis, no una orden.** Si al prototipar descubres que la pregunta está mal planteada, dilo. En la sesión anterior pasó dos veces y las dos veces mejoró el resultado.
