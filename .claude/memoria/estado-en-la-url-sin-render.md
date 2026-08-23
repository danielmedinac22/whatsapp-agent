---
name: estado-en-la-url-sin-render
description: "En este panel, poner estado de pantalla en la URL con router.push cuesta un render de servidor entero; la History API no"
metadata: 
  node_type: memory
  type: project
  originSessionId: f8454bfb-9344-41c6-81af-7f852f10d4d3
  modified: 2026-08-20T18:43:30.623Z
---

Toda pantalla del panel es `force-dynamic` y un render del Inbox cuesta **23 idas
y vueltas a la base** (ver [[el-panel-y-la-base-en-costas-opuestas]] y
[[costo-de-encender-la-bandeja-de-ventas]]). Por eso, cuando hay que guardar
estado de pantalla en la URL —qué fila está abierta, qué filtra la lista—
**`router.push` / `router.replace` de Next es la opción cara**: cambia los
`searchParams`, y con `force-dynamic` eso vuelve a correr el componente de
servidor. Un clic en una fila pasaría a costar lo mismo que abrir la pantalla.

La barata es `window.history.pushState` / `replaceState`. Next las parchea
(`app-router.js`, desde 14.1) para sincronizar `usePathname` y `useSearchParams`,
así que la dirección, el botón Atrás y el aterrizaje tras recargar funcionan
igual, **sin ningún viaje al servidor y sin mover el scroll**.

**Why:** el reflejo es `router.push`, y ahí el costo no se ve en ninguna parte —
la pantalla sigue funcionando, solo que cada clic paga 23 consultas.

**How to apply:** estado de *dónde está parado el usuario dentro de la pantalla*
→ History API. Navegar a *otra* pantalla, o algo que el servidor tiene que
recalcular (la búsqueda, que se resuelve sobre todas las conversaciones y no
solo sobre las 200 cargadas) → el router. Está hecho así en
`apps/web/src/app/(app)/inbox/inbox-client.tsx` (`escribirEnLaDireccion`).
