---
name: costo-de-encender-la-bandeja-de-ventas
description: "Configurar al vendedor casi duplica el costo del Inbox, y el techo está entre 36.000 y 45.000 conversaciones"
metadata: 
  node_type: memory
  type: project
  originSessionId: da231b67-e54c-4976-99d7-5690fda8678e
  modified: 2026-08-20T17:55:53.516Z
---

Medido el 20-ago-2026 (PRO-10), contra base de ensayo sembrada a escala de producción. El código existe pero **no corre**: sin vendedor configurado, `bandejaPedida` devuelve `undefined` y toda la derivación queda dormida.

Lo que cambia el día que se configure a Sebastián:

| | idas y vueltas | filas leídas |
| -- | --: | --: |
| hoy, bandeja apagada | 23 | 1.256 |
| encendida, la URL de Katherine | **45** | **8.606** |

**PRO-15+PRO-16 bajó las dos**, en la rama `danielmedinac22/viajes-cortos` (sin mergear al 20-ago-2026): apagada **23 → 8**, encendida **45 → 28**. El salto por encender al vendedor sigue siendo casi el triple, así que la conclusión de abajo no cambia: PRO-17, PRO-18 y PRO-20 siguen siendo bloqueantes.

Casi la mitad del salto es `countSalesInboxViews`, el contador de la barra lateral, que se dibuja en **las siete pantallas** del panel.

**El techo: entre 36.000 y 45.000 conversaciones**, donde el `ORDER BY GREATEST(...)` se cae a disco. Es un borde nítido, no una pendiente: antes cuesta 9 ms, después cuesta otra cosa. Hoy la operación Guatemala tiene 1.764.

**Why:** encender al vendedor parece una decisión de producto sin costo técnico, y no lo es. Degrada el panel de Katherine, que no lo pidió. PRO-17, PRO-18 y PRO-20 existen para bajar eso y son bloqueantes.

**How to apply:** antes de configurar al vendedor, correr `scripts/ensayo-bandeja-a-escala.ts` contra Docker sembrado y comparar. Nunca medir con la tabla vacía: da cero y no dice nada. Y apagar la bandeja **en la base** (`display_name = ''`), no por parámetro: el layout lee al vendedor, no lo recibe, y simularlo sobreestima la línea base en seis consultas. Ver [[el-panel-y-la-base-en-costas-opuestas]] para por qué las idas y vueltas son la unidad que importa.
