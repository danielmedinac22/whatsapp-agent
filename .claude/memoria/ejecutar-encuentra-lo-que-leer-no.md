---
name: ejecutar-encuentra-lo-que-leer-no
description: "Los errores que ni el tipado ni los tests puros ven están en QUÉ FILAS llegan a la decisión, no en la decisión — solo aparecen ejecutando contra una base desechable"
metadata:
  type: feedback
---

En este repo los tests van sobre **funciones puras con fixtures**, y eso deja una
clase entera de error invisible: la que está en **qué datos llegan a la
decisión**, no en qué se decide con ellos. Tres casos reales del worktree
`capi-envio` (19-ago-2026), ninguno detectable por `pnpm -r typecheck` ni por la
suite:

1. **Un reintento que no reintentaba.** El envío reusaba la consulta del barrido,
   que excluye todo pedido con fila en el libro — incluida la que su propio
   primer intento acababa de escribir. Se completaba contento sin hacer nada.
2. **Un tablero que mentía sobre lo que había mirado.** El filtro en SQL
   descartaba filas *antes* de contarlas, así que el estado decía «no hubo
   pedidos» sobre una operación que factura 470 al mes.
3. **Un `Date` en un `sql` crudo de drizzle** que revienta en tiempo de
   ejecución: hay que usar `gte(columna, fecha)`, no `` sql`${col} >= ${fecha}` ``.

Se levanta con Docker (ver [[base-de-ensayo-con-docker]]), se aplican TODAS las
migraciones en orden y se corre el camino real. Para lo que sale hacia afuera, se
reemplaza `globalThis.fetch` por uno que **cuenta llamadas**: contar cero es la
única forma de probar una ausencia — «apagado no sale ni una llamada».

**Why:** «verde no significa correcto» ya estaba escrito en el proyecto; esto dice
*dónde* mirar cuando verde no alcanza. Los tres errores habrían llegado a
producción y dos de ellos habrían fallado en silencio.

**How to apply:** ante cualquier ticket con consulta nueva, cola nueva o llamada
a un sistema externo, ensayar el camino entero antes de darlo por terminado — y
**dejar el ensayo como script en `scripts/`** con el guardia que se niega contra
producción, para que el siguiente lo pueda repetir. Precedentes:
`scripts/ensayo-capi.ts`, `seed-bandejas-ensayo.ts`, `seed-catalogo-ensayo.ts`.
