---
name: el-porcentaje-de-wal-depende-del-checkpoint
description: Un porcentaje de WAL no se puede comparar entre sesiones — el denominador lo fija el checkpoint, no el índice; lo que transfiere son los bytes
metadata:
  type: project
---

Al medir cuánto WAL aporta un índice en `conversations` (PRO-24, 20-ago-2026),
la línea base de PRO-17 —2.670.624 bytes para el `UPDATE` de 1.725 filas— **no
se pudo reproducir**: la misma medición dio 1.897.288 en frío y 1.274.744 en
régimen. El método era el mismo.

**La causa es el `checkpoint`, no el índice.** El primer `UPDATE` después de un
checkpoint paga la *imagen entera* de cada página que toca (8 kB por página),
así que el total en frío depende de cuántas páginas tenga la tabla — y una
tabla más inflada por `UPDATE`s previos infla el total sin que eso tenga nada
que ver con ningún índice.

Consecuencia práctica: **el porcentaje no transfiere entre sesiones; el delta en
bytes sí.** PRO-17 midió 172.152 bytes / 8,2 %; PRO-24 midió 159.480 / 8,4 % en
frío y 157.400 / 12,3 % en régimen. Mismo ahorro, tres porcentajes distintos.

**Cómo medir para que sea comparable:** `checkpoint` → un `UPDATE` de
calentamiento (que paga las imágenes de página) → recién ahí `pg_current_wal_lsn()`
antes y después del `UPDATE` medido, y `pg_wal_lsn_diff`. Cinco pasadas, mediana,
y alternar poner/quitar el índice al menos dos veces: sin ese control la deriva
de datos entre corridas pasa por ahorro real. Régimen es además el estado en el
que la base vive casi todo el tiempo, así que es el número honesto.

**Y decir siempre cuál de los dos se reportó.** Un «8,2 % de WAL» sin decir
«en frío» es un número que nadie puede volver a obtener.

Relacionado: [[reproducir-la-linea-base-antes-de-tocar]],
[[un-indice-no-arregla-leer-todo]], [[base-de-ensayo-con-docker]].
