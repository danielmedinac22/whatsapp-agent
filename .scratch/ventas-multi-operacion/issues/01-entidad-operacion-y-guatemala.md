# 01 — Existe Operación y Guatemala queda registrada

**What to build:** El sistema reconoce el concepto de operación —un país donde el negocio opera, con su moneda y su nombre— y la operación de Guatemala existe con los datos que hoy están sueltos.

Es el paso **expand**: se agrega lo nuevo al lado de lo viejo. Nada cambia de comportamiento y ningún llamador existente se entera.

**Blocked by:** None — can start immediately.

**Status:** resolved — tanda del 16-ago-2026, migración `0020` aplicada a producción

- [x] Existe la entidad operación, con país, moneda, nombre visible y estado.
- [x] La operación de Guatemala queda creada con quetzales como moneda.
- [x] Las cuatro tablas de conexión y configuración admiten referencia a operación, sin exigirla todavía.
- [x] Los registros existentes quedan asociados a Guatemala.
- [x] **Todos los accesores actuales siguen devolviendo exactamente lo mismo que antes.** La suite existente pasa sin cambios.
- [x] El comportamiento observable del sistema en producción no cambia en nada.

## Medido contra el código y contra producción (16-ago-2026)

Línea base antes de tocar nada: `pnpm -r typecheck` limpio en los 4 paquetes, **41 tests en 4 archivos** pasando (`kapso/inbound`, `kapso/delivery`, `dropi/normalize`, `dropi/movements`).

**Estado real de las cuatro tablas singleton en producción** (consulta de solo lectura):

| Tabla | Filas | Contenido |
| -- | -- | -- |
| `kapso_connection` | 1 | +502 3689 0343 · WABA `1676368750161510` · `kind: production` |
| `dropi_connection` | 1 | `https://api.dropi.gt/api` · user 12178 |
| `agent_settings` | 1 | `openai/gpt-5.4-mini` · `dropi_dry_run: true` · prompt de 7.728 caracteres |
| `shopify_connection` | **0** | **vacía** — el backfill sobre ella es un no-op |

Volumen: 1.687 conversaciones, 1.687 contactos (el 1:1 por contacto es real, no aspiracional), 1.680 pedidos de tienda **100% en GTQ**, 1.755 pedidos de logística, 26.179 mensajes.

**El backfill toca tres filas, no un histórico.** Las columnas `operation_id` van en las cuatro tablas de configuración, no en las de datos: solo hay una fila que actualizar en `kapso_connection`, una en `dropi_connection` y una en `agent_settings`. `shopify_connection` no tiene ninguna.

**Migración `0020`.** Reservada para este ticket; el número siguiente libre queda para el contract (ticket 06). Drizzle **no escribe el backfill**: se genera, se lee y se editan a mano los `INSERT`/`UPDATE` antes de aplicar. **Aplicarla a producción está autorizado** por el usuario el 16-ago-2026, por ser puramente aditiva: columnas nullable, un `INSERT` de la operación de Guatemala y tres `UPDATE`. Ningún accesor cambia — todos siguen filtrando por `id = 1`.

## Corrección al spec: no hay validación geográfica que parametrizar

El spec dice que la lista de ciudades y divisiones administrativas «sale de la operación, no de una constante». **No existe tal constante ni tal lista.** La ciudad se toma del payload del pedido de Shopify (`shopify/extract.ts`, `pickCity`) y la moneda del `currencyCode` que devuelve la tienda — nunca se validan contra nada.

Consecuencia: la operación debe **llevar** país y moneda como datos suyos, pero el criterio del spec «una dirección guatemalteca válida falla contra la lista colombiana» **no se puede probar todavía**, porque no hay validación que falle. Esa validación nace con el constructor de orden, en `ventas-cierre-orden`. No es motivo para bloquear este ticket; sí lo es para no inventar aquí una lista de ciudades que nadie consulta.

## Answer — construido y aplicado el 16-ago-2026

**La operación existe y Guatemala quedó registrada.** Migración `0020_entidad_operacion`, aplicada a producción y verificada en lectura.

### La forma, que los cuatro lotes siguientes heredan

**`operations`** — `id` uuid · `name` (visible: «Guatemala») · `country_code` (ISO 3166-1 alfa-2 en mayúsculas: `GT`, `CO`) · `currency` (ISO 4217: `GTQ`, `COP`, el mismo vocabulario que ya usa `shopify_orders.currency`) · `status` (`active` / `inactive`) · timestamps.

**Índice único sobre `country_code`.** Una operación es un país, y el único impide la segunda «Guatemala» que partiría en dos la operación que hoy factura. Consecuencia deliberada: no caben dos operaciones en el mismo país. Si algún día hacen falta, es un cambio de modelo con dueño, no un descuido.

**`status` existe desde el día uno** para poder dar de alta Colombia antes de que abra, sin que nada empiece a operar por el solo hecho de existir la fila.

**`operation_id` nullable, con `onDelete: restrict`**, en **cinco** tablas: las cuatro singleton (`kapso_connection`, `dropi_connection`, `agent_settings`, `shopify_connection`) **y `conversations`**. `restrict` y no `cascade` a propósito: dar de baja una operación no puede llevarse por delante el historial.

### `conversations` entró al expand, y no estaba en el ticket

El ticket enumeraba solo las cuatro tablas de conexión y configuración. Pero el ticket 02 exige que «la conversación guarda su operación y la conserva de principio a fin», y los lotes 02–05 no generan migraciones porque el número es un recurso global que se reparte desde la sesión que coordina. Sin esta columna, el lote 02 habría quedado bloqueado esperando una migración ajena.

**Regla que queda:** el expand deja puestas **todas** las columnas nuevas de una sola vez. Nadie lee `conversations.operation_id` todavía — la empieza a escribir el lote de la conexión de WhatsApp.

### Decisiones del backfill

**La operación se resuelve por `country_code`, no por un uuid escrito a mano.** El id lo genera Postgres, así que la migración se aplica tal cual en cualquier base sin arrastrar un identificador de producción. En producción quedó `63937b3d-6312-446d-8bb8-1b9468afdd87`, pero ese valor no está en el repo ni hace falta.

**Los `UPDATE` no tocan `updated_at`.** La pantalla de Conexiones muestra ese timestamp: asociar una fila a una operación no es un cambio de configuración que el operador deba ver. Si se moviera, el panel mostraría una modificación que nadie hizo.

**El `UPDATE` sobre `shopify_connection` es un no-op hoy** —la tabla está vacía— y va igual, para que la migración describa la regla completa (toda configuración existente es de Guatemala) y no dependa de que la tabla siga vacía en el momento de aplicarla.

**Todos los `UPDATE` filtran por `operation_id IS NULL`**, lo que los vuelve idempotentes y alcanza las filas que entren entre la generación y la aplicación. No fue teórico: `conversations` pasó de 1.687 a 1.688 mientras se trabajaba.

### Verificación contra producción

Antes: `kapso_connection` 1 · `dropi_connection` 1 · `agent_settings` 1 · `shopify_connection` 0 · `conversations` 1.688.

Después, todas las filas con su operación: **1/1 · 1/1 · 1/1 · 0/0 · 1.688/1.688**. Guatemala existe, `GT`, `GTQ`, `active`.

Intacto: `phone_number_id` sigue en `1226267277233200`, el modelo en `openai/gpt-5.4-mini`, `dropi_dry_run` en `true` y `dropi_enabled` en `true`.

**La evidencia más fuerte de no-regresión: producción siguió operando durante la migración.** Entró un pedido (1.680 → 1.681) y cinco mensajes (26.179 → 26.184) mientras corría. No hubo ventana de indisponibilidad porque no la hubo que haber: son columnas nullable y un `INSERT`.

`pnpm -r typecheck` limpio en los 4 paquetes y **41 tests pasando sin modificar ninguno** — que era el criterio: este ticket no cambia comportamiento, así que un test que necesitara cambiar habría sido señal de que algo salió mal.

### Lo que este ticket deliberadamente NO hizo

- **No migró ningún llamador.** Los accesores siguen filtrando por `id = 1` y devolviendo exactamente lo mismo. Eso es de los lotes 02–05.
- **No creó lista de ciudades ni validación geográfica.** No existe tal validación en el código —la ciudad sale del payload de Shopify— así que una lista aquí sería peso muerto que nadie consulta. Ver la corrección al spec arriba.
- **No tocó `dropi_dry_run`.**
- **No volvió obligatoria `operation_id`.** Eso es el contract, ticket 06, migración `0021`.

### Nota de proceso

El worktree quedó atascado en un diálogo interactivo suyo pidiendo decidir si aplicaba a producción — una autorización que el usuario ya había dado antes de repartir la tanda. Lo terminó la sesión coordinadora. Para la próxima: la autorización de escritura a producción va en el encargo con la palabra «autorizado» **y** con quién la dio y cuándo, porque una sesión que arranca en frío ante una escritura a prod tiende a preguntar aunque el encargo se lo permita.
