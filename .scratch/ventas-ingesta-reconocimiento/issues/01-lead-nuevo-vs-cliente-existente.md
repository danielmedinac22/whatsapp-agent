# 01 — Distinguir un lead nuevo de un cliente existente

**What to build:** Con venta y confirmación compartiendo número, cuando llega un mensaje el sistema tiene que saber **a quién atiende**: alguien que acaba de hacer clic en un anuncio y quiere comprar, o alguien que ya compró y pregunta por su pedido.

Este problema no existía cuando los números eran dos. Ahora es la primera decisión de cada mensaje entrante, y equivocarla significa venderle a quien solo quería saber dónde está su guía.

**Blocked by:** ventas-multi-operacion 02 · La conexión de WhatsApp cuelga de la operación

**Status:** resolved — worktree `ingesta-atribucion`, rama `danielmedinac22/ingesta-atribucion`, sin merge ni deploy. Tanda del 17-ago-2026

- [x] Un mensaje que trae referencia de anuncio se trata como lead de venta, siempre.
- [x] Un mensaje de alguien con pedido en curso se trata como consulta de postventa, aunque venga sin referencia.
- [x] **Un cliente que ya compró y hace clic en un anuncio nuevo es un lead de venta otra vez**, sin perder su historial de postventa.
- [x] Un mensaje sin referencia y sin pedido en curso entra como lead de venta.
- [x] La conversación registra qué agente es dueño en cada momento. — **derivado, no guardado**; ver abajo.
- [x] La operación de Guatemala en producción no cambia de comportamiento mientras exista un solo agente.
- [x] Los tests cubren las cuatro combinaciones de referencia presente o ausente y pedido en curso o no.

**Reemplaza al ticket original de segunda conexión de ventas**, cuyo trabajo se movió al spec de Operaciones.

## Answer — construido el 17-ago-2026

**A quién se atiende se decide encadenando tres funciones puras, todas probadas, ninguna
con estado propio.** No se inventó una segunda regla: la que decide es la del ruteo, que
ya estaba en `main`.

```
mensaje entrante
  → decideAdAttribution   (sales/attribution.ts)  ¿qué atribución tiene la conversación ahora?
  → resolveInbox          (inbox/resolve.ts)      ¿ventas u operaciones?   [ya existía]
  → resolveConversationOwner (sales/owner.ts)     ¿qué agente es dueño?
```

Las cuatro reglas del ticket **son** las cuatro reglas de `resolveInbox`, alimentadas con
la atribución recién persistida:

| mensaje | pedido | bandeja / regla | dueño |
| -- | -- | -- | -- |
| con referencia | sin pedido | `ventas` / `no_order` | vendedor |
| con referencia | en curso | `ventas` / `ad_click_after_last_order` | vendedor |
| sin referencia | en curso | `operaciones` / `order_in_progress` | confirmación |
| sin referencia | sin pedido | `ventas` / `no_order` | vendedor |

La fila 2 es el recomprador: el clic acaba de llegar, así que es estrictamente posterior
al último pedido y gana por precedencia. **No pierde su historial**: no se borra ni se
mueve nada, y las notificaciones logísticas del pedido en curso siguen saliendo por su
cuenta porque no dependen de la bandeja. Y en cuanto la venta cierra, el pedido nuevo se
crea *después* del clic y la conversación pasa a operaciones sola — hay test de eso
también.

### «La conversación registra qué agente es dueño»: derivado y anotado, sin columna

**No se agregó columna y no hizo falta migración.** El dueño se calcula en cada mensaje
entrante y queda en el log del worker (`ingesta: agente dueño de la conversación`, con el
agente, la regla que lo decidió, la bandeja y la regla de la bandeja).

Por qué así, y no un campo:

- El sistema ya tiene **tres máquinas de estado** —el pipeline del pedido de tienda, la
  confirmación de la conversación y los quince estados de logística—. Una cuarta
  *guardada* tendría que mantenerse de acuerdo con las tres, y la que miente siempre es la
  que alguien olvidó actualizar. Es literalmente la decisión que el spec de ruteo tomó y
  que su ticket 02 repite.
- Hay **una conversación por contacto para siempre** (único sobre `contact_id`): un campo
  escrito en julio le quedaría encima al recomprador de agosto.
- La `0022` puso columnas para la atribución y para la asignación a un asesor, y **ninguna
  para esto**. Coherente: lo que se guarda es lo que el sistema no puede deducir.

Coordinado con la sesión que reparte la tanda: `sales/owner.ts` es de este worktree y el
worktree de Sebastián lo consume en vez de escribir el suyo. Se descartaron dos capas que
se propusieron y no se sostienen: `assigned_user_id` **no** pausa a ningún agente (lo dice
el `## Answer` ya mergeado de *ruteo 04*), y `contacts.agent_mode` **no** significa «un
humano lo tomó» — su default es `false` y solo pasa a `true` cuando la confirmación
empieza a hablar, así que derivar «humano» de ahí marcaría como humanos justo a los leads
nuevos que el vendedor tiene que atender. Cuando *ruteo 04* implemente la asignación y
decida si suspende, entra como una rama más de `ConversationOwnerFacts`.

### Guatemala no cambia, y el tipo es lo que lo garantiza

```ts
type ConversationOwnerFacts =
  | { salesAgentConfigured: false }                      // ← sin bandeja que mirar
  | { salesAgentConfigured: true; inbox: Inbox };
```

La rama sin vendedor **no acepta bandeja**, así que no existe forma de escribir el `if`
que rutee a postventa hacia un vendedor que no existe. Es el riesgo R8 hecho tipo y no
comentario. Consecuencias medidas:

- Un mensaje **sin referencia** —todos los de Guatemala— no dispara ni una escritura ni
  una consulta nueva, salvo una lectura cacheada (30 s) de `sales_agent_settings`.
- Sin vendedor configurado **no se consultan los pedidos del contacto**: la derivación de
  bandeja ni siquiera ocurre.
- El log de producción no gana volumen: la línea del dueño sale en `debug` (que en
  producción no se emite) salvo cuando el dueño es el vendedor, que hoy no puede pasar.

El listón de «vendedor configurado» es `sales_agent_settings.display_name` no vacío: la
`0022` crea la fila con todos los textos en `''`, así que existir no basta. Vive en una
sola función (`sales/settings.ts`), con test.

### Verificado contra producción, en solo lectura

- **1.693 conversaciones, 0 con atribución de anuncio** — el estado real de hoy.
- Guatemala **no tiene fila** en `sales_agent_settings` → `salesAgentIsConfigured = false`
  → de una muestra de **300 conversaciones reales, las 300 dan `confirmacion` /
  `no_sales_agent`**. Ninguna cambia de dueño.
- La carga de pedidos se probó contra datos reales: **279 de esas 300 conversaciones
  tienen pedidos** y la consulta los devuelve (tienda + logística, incluidos los que solo
  existen en logística).
- Simulación sobre un contacto real con un pedido en curso: sin clic →
  `operaciones/order_in_progress`; con un clic simulado → `ventas/ad_click_after_last_order`.
  El recomprador funciona sobre datos de producción.

### Verificación

`pnpm -r typecheck` limpio en los 4 paquetes. `pnpm --filter @wa/worker test`: **180 tests
en 12 archivos**, los 135 existentes sin tocar. Las cuatro combinaciones están probadas
dos veces: con vendedor configurado (bandejas distintas) y sin él (las cuatro dan el
agente de confirmación, que es la no-regresión escrita como test y no como intención).
