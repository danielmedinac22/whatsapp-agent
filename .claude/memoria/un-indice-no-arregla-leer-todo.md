---
name: un-indice-no-arregla-leer-todo
description: "Con una sola operación, filtrar por operation_id selecciona el 100% de la tabla y ningún índice gana; el Seq Scan es correcto"
metadata: 
  node_type: memory
  type: project
  originSessionId: 28193747-3b5e-4fd0-9274-8ca0b2a51707
  modified: 2026-08-20T18:36:12.376Z
---

Con **una sola operación activa** (Guatemala, hoy), `where operation_id = X`
selecciona el **100 %** de `conversations`. Ningún índice puede ganarle a un
`Seq Scan` ahí: leer todas las filas por índice es más caro, no menos. Medido en
PRO-17 forzando el índice con `enable_seqscan=off` sobre la consulta sin `LIMIT`
de la bandeja, a 17.620 filas: **35.792 bloques contra 619**, 16,2 ms contra 7,0.
El planificador elige bien.

Los índices que la `0031` puso sí cambian los planes de las consultas que leen un
**subconjunto**: la lista con su corte de 200 (329 → 34 bloques en el nodo de
`conversations`) y el rango de «sin responder» (329 → 47). De doce consultas del
Inbox que tocan `conversations`, el escaneo completo desapareció de cinco.

**Why:** el reflejo es leer «hay un Seq Scan» como «falta un índice», y acá es
falso siete veces de doce. Un ticket que se mida por «que desaparezca el Seq
Scan» se declara fallido cuando hizo lo correcto, o peor, agrega índices que solo
cuestan escrituras — los dos de la `0031` ya cuestan **+17,4 % de WAL** en el
`UPDATE` de `last_inbound_at` que corre por cada mensaje entrante.

**How to apply:** antes de proponer un índice, preguntar qué **fracción** de la
tabla devuelve el filtro. Si es casi todo, el arreglo es leer menos filas
(acotar antes de derivar, que es PRO-18), no llegar a las mismas por otro
camino. Y el mismo cálculo se da vuelta el día que abra la segunda operación
colombiana: ahí `operation_id` deja de seleccionar todo y el índice empieza a
elegirse solo — medido con la tabla partida en dos, el contador de la barra
lateral pasa de 481 bloques a 47. Ver [[costo-de-encender-la-bandeja-de-ventas]]
y [[vorare-opera-en-guatemala]].
