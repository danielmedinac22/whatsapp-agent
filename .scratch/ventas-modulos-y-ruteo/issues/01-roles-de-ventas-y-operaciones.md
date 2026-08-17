# 01 — Roles de ventas y operaciones

**What to build:** El sistema distingue a quién vende de quién confirma. Hoy no puede: los roles son `admin` y `operator`, y la pregunta «¿esto lo toma ventas u operaciones?» no tiene dónde escribirse.

**Blocked by:** None — can start immediately.

**Status:** esquema en curso — worktree `esquema-0022` deja los roles; la funcionalidad sigue abierta

Verificado: `user_role` tiene **solo dos referencias en el código**, así que el cambio es barato.

- [ ] Existen los roles de **ventas** y **operaciones**, además de admin.
- [ ] Ventas alcanza el módulo del vendedor; operaciones el de confirmación; **admin ambos**.
- [ ] Un usuario con rol de ventas **no puede llegar** a las pantallas de confirmación, ni por URL directa.
- [ ] Los usuarios existentes conservan exactamente el acceso que tienen hoy — nadie pierde permisos por esta migración.
- [ ] **La separación la impone el rol, no el módulo**, para que quien legítimamente hace las dos cosas no quede atrapado en una.

## Answer — esquema puesto por la `0022` (17-ago-2026), la funcionalidad sigue abierta

El worktree `esquema-0022` amplió el enum en producción. **Este ticket no genera migración.**

### `user_role` = `admin` · `operator` · `sales` · `operations`

Dos valores nuevos, **agregados al final** con `ALTER TYPE ... ADD VALUE`. `sales` es ventas, `operations` es el equipo que confirma. En inglés como los que ya había; `operations` colisiona en nombre con la tabla `operations` (el país) — la colisión es del lenguaje del negocio, «ventas» y «operaciones», y se prefirió respetarlo a inventar un sinónimo. El comentario en `schema.ts` lo deja dicho.

`operator` es el valor heredado: **nadie lo tiene en producción**, y se conserva porque un valor de enum no se quita sin recrear el tipo. Sigue siendo el `default` de `users.role` — cambiar el default no era de este expand.

### Nadie perdió acceso — verificado, no supuesto

Medido antes y después de aplicar: **3 usuarios, los 3 `admin`** (`danielmedina2205@gmail.com`, `inversionescspguatemala@gmail.com`, `admin@example.com`). Agregar valores no toca ninguna fila; el criterio «los usuarios existentes conservan exactamente el acceso que tienen hoy» se cumple por construcción y quedó comprobado en lectura.

### Trampas que quedan avisadas

- **Los valores nuevos no se usaron en la migración que los agregó** — Postgres rechaza usar un valor de enum dentro de la misma transacción que lo crea, y el migrator corre en una. Ya está commiteado, así que desde aquí se pueden usar libremente: `insert ... role = 'sales'` funciona.
- **`apps/web/src/auth.ts` sigue tipando el rol como `"admin" | "operator"`** con casts (líneas 12, 67, 74). Compila hoy porque son casts, pero un usuario `sales` va a pasar por ahí con un tipo mentiroso. Ensancharlo —idealmente a `(typeof userRole.enumValues)[number]` en vez de otra unión a mano— es de este ticket, junto con la separación por rol en las pantallas. `apps/web` no se tocó desde el esquema, a propósito.
- Solo hay **dos referencias** a `user_role` en el código (`schema.ts` y `auth.ts`), como decía el ticket. Sigue siendo barato.

### Lo que sigue siendo de este ticket

Todo lo del checklist: qué módulo abre cada rol, que ventas no llegue a confirmación ni por URL, que admin llegue a ambos, y la separación impuesta por el rol y no por el módulo.
