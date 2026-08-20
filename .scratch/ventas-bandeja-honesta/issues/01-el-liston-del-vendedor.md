# 01 — El listón del vendedor, y la línea de corte

**What to build:** Que sin vendedor configurado la bandeja de ventas **no exista**,
y que el día que se encienda arranque vacía en vez de heredar el historial de
Katherine.

**Blocked by:** nada. **Es el primero y sale solo.**

**Status:** claimed — worktree `liston-del-vendedor`, tanda del 19-ago-2026

Es el único ticket del lote que se despliega por su cuenta y que **ya apaga todo
el ruido de hoy**. Los otros dos son mejoras; este es la corrección.

## Qué está mal hoy, medido

Guatemala, 19-ago-2026, contra producción:

- **110 conversaciones** en la bandeja de ventas, las 110 por la regla
  `no_order`. **Ninguna llegó por un anuncio** — `ad_referral_at` es `null` en
  las 1.759 conversaciones de la operación.
- **`sales_agent_settings` tiene 1 fila con `display_name` vacío** y `products`
  tiene 0 filas. El vendedor está apagado según el worker
  (`salesAgentIsConfigured` → `false` → regla `no_sales_agent`).
- Y sin embargo el menú muestra el módulo con sus tres vistas, porque el panel
  usa otro listón.

Las dos definiciones de «hay vendedor»:

| Quién | Dónde | Listón |
| -- | -- | -- |
| Worker | `apps/worker/src/sales/settings.ts:38` | `display_name` no vacío |
| Panel | `apps/web/src/app/(app)/layout.tsx:100` | **existe la fila** |

El `upsert` de `/vendedor` (`apps/web/src/lib/vendedor.ts:83`) crea la fila con
todos los textos en `''`. **Abrir la pantalla de configuración encendió el
módulo.**

## Por qué el listón del worker es el correcto, y no es decisión nueva

Ya estaba fijado en tres tickets resueltos, con el mismo razonamiento cada vez:

- `ventas-conversacion/issues/01-sebastian-responde-con-su-persona.md:73` — *«el
  listón es `display_name` no vacío, no la existencia de la fila: los textos son
  `NOT NULL default ''`, así que tomar la fila como "hay vendedor" convertiría un
  `INSERT` a medio llenar en el momento en que Guatemala deja de ser atendida por
  Katherine.»*
- `ventas-panel/issues/01-configuracion-del-vendedor.md:33`
- `ventas-ingesta-reconocimiento/issues/01-lead-nuevo-vs-cliente-existente.md:97`

El panel simplemente no lo aplicó. Esto no re-litiga nada: lo termina.

## Qué hay que construir

### 1. Un solo predicado, compartido

`salesAgentIsConfigured` se muda de `apps/worker/src/sales/settings.ts` a
**`@wa/db`**, junto a la tabla que describe. Ya es estructural —recibe
`{ displayName: string }`— así que la mudanza no arrastra dependencias. El worker
lo re-exporta o lo importa; el panel lo usa en lugar de `seller !== null`.

Los dos sitios del panel que hoy preguntan mal:

- `apps/web/src/app/(app)/layout.tsx:100` — decide si hay `SalesNav`.
- `apps/web/src/app/(app)/inbox/page.tsx:56` — decide `conVendedor` para
  `bandejaPedida`.

### 2. La línea de corte — migración `0030`

`sales_agent_settings.activated_at timestamptz null`.

Se estampa **al pasar `display_name` de vacío a no vacío**, en el guardado del
panel. Y lleva un **respaldo perezoso**: si `display_name` no está vacío y
`activated_at` es `null`, se estampa **en la primera lectura**
(`getSalesAgentSettings`, que ya está cacheado por operación).

El respaldo no es adorno: sin él, llenar la columna por SQL o por un seed deja
`activated_at` en `null` para siempre, la bandeja de ventas queda vacía y **nadie
entiende por qué**. Escribir desde una lectura tiene precedente explícito en este
repo — `releaseStaleAssignments` lo hace y su comentario dice que es a propósito.

Se escribe **una sola vez** y no se vuelve a mover, ni siquiera si el vendedor se
apaga y se vuelve a encender. Re-estampar arrastraría conversaciones vivas de
vuelta a Katherine, y eso es exactamente lo que `no-regresion.md` prohíbe.

### 3. La regla `no_order`, acotada

`resolveInbox` (`packages/db/src/inbox.ts:241`) hoy manda a ventas todo contacto
sin pedido. Pasa a mandar a ventas **solo si el contacto nació después de
`activated_at`**. Sin fecha, `no_order` va a `operaciones`.

Las otras tres reglas **no se tocan**. En particular la del recomprador
(`ad_click_after_last_order`) sigue igual: es la que va a traer a los
recompradores el día que haya anuncios, y por eso la línea de corte puede mirar
solo el nacimiento sin perder ese caso.

Hay exactamente **una conversación por contacto** en producción (1.759 y 1.759),
así que «nació el contacto» y «nació la conversación» son la misma fecha. Elegí
la que quede más limpia de leer y dejalo dicho en el test.

### 4. El nombre del agente en la barra

`apps/web/src/app/(app)/nav.ts` tiene el nombre **escrito a mano**
(`agent: "Sebastián"`, y `"Katherine"` en Confirmación), y `module-nav.tsx:102`
lo pinta siempre. Con esto arreglado la barra seguiría diciendo «VENTAS ·
Sebastián» sin vendedor configurado — la misma clase de mentira que este ticket
existe para sacar.

Que ese nombre salga de `display_name` y **no se pinte si no hay**. El de
Katherine puede quedarse como está: su agente sí existe.

## Superficie y dueño

Este ticket es **dueño de estos archivos** durante la tanda. Nadie más los toca:

- `packages/db/src/inbox.ts`, `packages/db/src/schema.ts`, `packages/db/src/sales-agent-settings.ts`
- `packages/db/migrations/0030_*` — **la `0030` es tuya y de nadie más**
- `apps/worker/src/sales/settings.ts` (la mudanza del predicado)
- `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/app/(app)/nav.ts`,
  `apps/web/src/app/(app)/module-nav.tsx`, `apps/web/src/lib/vendedor.ts`
- `apps/web/src/app/(app)/inbox/page.tsx` — **solo la línea de `conVendedor`**

**No toques** `apps/web/src/lib/queries.ts` ni
`apps/web/src/app/(app)/inbox/inbox-client.tsx`: son del ticket 03, que arranca
cuando este mergee.

El ticket 02 corre **en paralelo** contigo, en `apps/worker/src/jobs/outbound.ts`.
No comparten un solo archivo.

## Lo que hay que respetar

- **No romper Guatemala.** Leé `.scratch/panel-de-ventas/no-regresion.md` antes
  de empezar. Este ticket es de bajo riesgo *porque* el vendedor está apagado:
  con `salesAgentIsConfigured` en `false`, la bandeja de ventas no rutea a ningún
  agente y el cambio es de pintura. Pero el mismo código decide el ruteo el día
  que se encienda.
- **El efecto correcto es que el Inbox de Katherine vuelva a ser el de antes del
  módulo.** `bandejaPedida(b, false)` devuelve `undefined`, `listConversations`
  no filtra ni deriva, y no se paga ni una consulta de más — que es exactamente
  lo que el comentario de `queries.ts:526` decidió.
- **`.scratch/` está commiteado.** Este archivo viaja en tu diff.
- La migración se genera, **se lee y se edita a mano si hace falta**, y se aplica
  con `pnpm --filter @wa/db migrate`. Nunca `pnpm db:push`.

## Criterios

- [ ] Existe **un solo** predicado de «hay vendedor» en el monorepo, y tanto el
      worker como el panel lo usan.
- [ ] Con `display_name` vacío: el enlace de **Conversaciones no aparece** en la
      barra, y `/inbox?b=ventas` a mano se comporta como `/inbox` — no como una
      bandeja vacía.
- [ ] Con `display_name` vacío, la barra **no dice «Sebastián»**.
- [ ] Catálogo, Reporte a Meta y Vendedor **siguen accesibles** con el vendedor
      apagado: si no, no habría forma de configurarlo.
- [ ] Migración `0030` aplicada, additiva, con `activated_at` nullable.
- [ ] El respaldo perezoso estampa `activated_at` cuando encuentra `display_name`
      lleno y la fecha nula, y **no la re-escribe** en lecturas posteriores.
- [ ] `resolveInbox` con `activated_at` en `null` no manda **nada** a ventas por
      `no_order`. Con fecha, manda solo lo nacido después.
- [ ] Contra producción (solo lectura): la bandeja de ventas da **0** donde hoy
      da 110.
- [ ] `pnpm -r typecheck` limpio y `pnpm --filter @wa/worker test` en verde.

## No-regresión

El cambio de mayor radio es `resolveInbox`, que es una función pura con tests. Lo
que hay que cuidar es el **orden de despliegue de la migración**: `activated_at`
nullable es additiva y el worker viejo la ignora, así que aplicar y después
desplegar es seguro en cualquier orden.

Lo que **no** puede pasar: que alguna conversación que hoy ve Katherine deje de
verla. Verificalo con una consulta antes y después — el total de la bandeja sin
parámetro tiene que subir de 1.649 a 1.759, no bajar de ningún lado.
