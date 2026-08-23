---
name: fechar-el-desfase-antes-de-arreglarlo
description: Un conteo de filas malas sin fecha no dice si el bug está vivo — agrupá por mes antes de escribir el arreglo
metadata:
  type: feedback
---

Medí que `conversations.last_outbound_at` estaba mal en **855 de 1.759 filas** y escribí un ticket para arreglarla. Al agrupar esas 855 por mes resultaron **todas anteriores al 28-jul-2026**: agosto llevaba 569 conversaciones con 0 nulos. La columna ya se había arreglado sola. Media especificación del ticket sobraba.

**Why:** un conteo de filas malas es una foto sin fecha, y las tablas viejas acumulan errores viejos. El número se ve grande y urgente, y puede describir un bug que murió hace un mes. Lo encontró la sesión hija, no yo, porque el encargo le pedía contradecirme con números.

**How to apply:**

- Antes de escribir el arreglo, **agrupá las filas malas por mes** (`date_trunc('month', ...)`). Si el corte es limpio en una fecha, el bug ya no está vivo y lo que queda es histórico que casi nunca vale un backfill.
- Corolario que costó caro en el mismo lote: **arreglar la columna «rota» habría sido una regresión.** `last_outbound_at` alimenta el orden de la bandeja, así que recortarla a lo conversacional le cambiaba el orden a Katherine. Antes de estrechar el significado de una columna, buscá quién más la lee.
- Y la trampa gemela: **al distinguir «salió algo» de «alguien contestó», revisá todos los sitios donde usaste el primero queriendo decir el segundo.** A mí se me coló en la definición de «Sin responder», que contaba una notificación logística como respuesta. Corregido: 20 pasó a 39, y los 19 que entraron eran clientes a los que nadie contestó.

Ver [[la-bandeja-definida-por-resta]], [[ejecutar-encuentra-lo-que-leer-no]], [[lo-que-vacia-de-significado-no-lo-ve-el-tipado]].
