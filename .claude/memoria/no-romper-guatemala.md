---
name: no-romper-guatemala
description: Restricción permanente — ningún ticket del Panel de Ventas puede alterar la operación viva de Guatemala
metadata: 
  node_type: memory
  type: project
  originSessionId: 0e63369c-d42d-466b-b2b6-a251a847109c
  modified: 2026-08-17T00:54:25.638Z
---

**La operación de Guatemala factura hoy y no puede cambiar de comportamiento.** Ningún ticket del Panel de Ventas puede alterarla. Si un ticket obliga a elegir entre avanzar y no tocarla, no se toca.

**Why:** son ~470 pedidos/mes con 88,4% de confirmación sobre un número en calidad verde. El costo de retrasar un ticket es un día; el de romper la confirmación es la operación entera.

**How to apply:** el detalle completo está en `.scratch/panel-de-ventas/no-regresion.md` — **leerlo antes de empezar cualquier ticket**. Lo esencial:

- El repo tiene `strict: true` y `noUncheckedIndexedAccess: true`, así que al volver obligatorio el parámetro de operación **el compilador encuentra los call sites que falten**. Correr `pnpm typecheck` y `pnpm --filter @wa/worker test` **después de cada lote**, no al final.
- **Fallo esperando a ocurrir:** `jobs/followup.ts` marca un pedido como `confirmed` si hay cualquier mensaje entrante posterior a su llegada. Correcto para pedidos web; **falso para pedidos de ventas**, donde la conversación es el origen — dejaría todo pedido de ventas auto-confirmado sin verificar la dirección.
- **`dropi_dry_run` está en `true` a propósito.** Quien migre lo va a ver y le va a parecer un error. No cambiarlo de paso: dispararía confirmaciones reales sobre 1.755 pedidos.
- Escrituras externas —tienda y píxel de Meta— se prueban en modo prueba antes de operar de verdad. Un evento de conversión mal formado envenena la optimización de la pauta y eso no se revierte.

Ver [[panel-de-ventas-estado]], [[vorare-opera-en-guatemala]].
