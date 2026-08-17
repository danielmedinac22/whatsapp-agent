# 01 — Existe Operación y Guatemala queda registrada

**What to build:** El sistema reconoce el concepto de operación —un país donde el negocio opera, con su moneda y su nombre— y la operación de Guatemala existe con los datos que hoy están sueltos.

Es el paso **expand**: se agrega lo nuevo al lado de lo viejo. Nada cambia de comportamiento y ningún llamador existente se entera.

**Blocked by:** None — can start immediately.

**Status:** claimed — worktree `op-01-entidad-operacion`, tanda del 16-ago-2026

- [ ] Existe la entidad operación, con país, moneda, nombre visible y estado.
- [ ] La operación de Guatemala queda creada con quetzales como moneda.
- [ ] Las cuatro tablas de conexión y configuración admiten referencia a operación, sin exigirla todavía.
- [ ] Los registros existentes quedan asociados a Guatemala.
- [ ] **Todos los accesores actuales siguen devolviendo exactamente lo mismo que antes.** La suite existente pasa sin cambios.
- [ ] El comportamiento observable del sistema en producción no cambia en nada.

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
