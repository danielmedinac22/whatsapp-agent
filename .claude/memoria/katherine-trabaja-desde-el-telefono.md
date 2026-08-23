---
name: katherine-trabaja-desde-el-telefono
description: La asesora principal responde clientes desde el móvil, así que ninguna decisión de diseño se valida solo en escritorio
metadata:
  type: project
---

**Katherine responde clientes desde el teléfono**, no solo mira. Lo confirmó
Daniel el 20-ago-2026, al revisar el panel claro recién deployado.

**Why:** el panel se diseñó entero mirando pantallas de escritorio. Los tres
veredictos del mapa `panel-orientacion` (sistema, pantallas, fila) se votaron
así, y uno de ellos eligió a sabiendas la fila **más alta** de cinco variantes,
cambiando densidad por legibilidad. En 390 px de ancho ese cambio puede dejar
tres o cuatro conversaciones visibles y devolver el problema original: que la
bandeja no se recorre con la vista. El supuesto cambió, así que el compromiso se
vuelve a mirar.

**How to apply:** cualquier trabajo sobre el Inbox o el marco se verifica también
en ancho de teléfono, no solo en escritorio. Y al proponer densidad, altura de
fila o navegación, la pregunta no es «¿se ve bien?» sino «¿cuántas conversaciones
entran en un teléfono?». Ver [[la-bandeja-definida-por-resta]] y
[[contar-sobre-lo-cargado-miente]] para lo que esa lista ya tiene de frágil.

El estado de hoy y la ronda pendiente están en PRO-31 y en la sección «Nivel 4»
de `.scratch/panel-orientacion/spec.md`.
