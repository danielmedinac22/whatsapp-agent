---
name: el-or-que-enciende-el-jit
description: Un `not exists` dentro de un `or` no se convierte en anti-join; Postgres lo cotiza en millones, cruza jit_above_cost y compila 131 ms sobre un trabajo de 5
metadata:
  type: project
---

Postgres solo convierte un `NOT EXISTS` en **anti-join** cuando es un conjunto
de **primer nivel** del `WHERE`. Colgado de un `or` lo resuelve como subplan —y
lo ejecuta bien: lo *hashea*, cuesta 5 ms— pero lo **cotiza** como si lo
repitiera por fila. Medido en PRO-18 sobre la criba de la bandeja de ventas a
17.620 conversaciones:

```
Nested Loop  (cost=0.57..12213856.70 rows=4410) (actual time=126.589..136.022 rows=1110)
  Filter: ((ad_referral_at IS NOT NULL) OR ((created_at > …) AND (NOT (hashed SubPlan 2)) …))
  JIT: Functions 37 · Generation 0,897 · Inlining 20,409 · Optimization 55,644 · Emission 54,805 · Total 131,755 ms
Execution Time: 136,918 ms
```

**131,7 de los 136,9 ms eran compilar.** El costo de 12.212.184 cruza
`jit_above_cost` (100.000 por defecto) y enciende el compilador.

Escrito como `union` de dos ramas —una por motivo— cada rama se cotiza sola, la
segunda sale como `Hash Anti Join` de verdad y la consulta baja a ~5 ms sin JIT.
`union` y no `union all` cuando una fila puede cumplir los dos motivos; `union`
y no dos consultas porque son dos viajes, y el panel se mide en viajes.

**Why:** el síntoma es «la consulta tarda 137 ms» y la causa no está en ningún
nodo del plan: está en el renglón `JIT:`, que es fácil de saltear leyendo un
`EXPLAIN ANALYZE`. Y el reflejo —bajar `jit_above_cost` o apagar el JIT— tapa el
síntoma dejando la estimación absurda, que va a volver a morder en la próxima
consulta.

**How to apply:** si una consulta tarda mucho más de lo que suman sus nodos,
buscar `JIT:` en el plan antes que nada. Si el costo estimado es de millones
sobre una tabla chica, el problema es un subplan mal cotizado: sacarlo del `or`,
normalmente partiendo la consulta en ramas de `union`. Vale para toda consulta
del panel — ver [[un-indice-no-arregla-leer-todo]] y
[[reproducir-la-linea-base-antes-de-tocar]].
