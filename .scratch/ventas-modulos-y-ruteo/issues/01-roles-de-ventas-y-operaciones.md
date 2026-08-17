# 01 — Roles de ventas y operaciones

**What to build:** El sistema distingue a quién vende de quién confirma. Hoy no puede: los roles son `admin` y `operator`, y la pregunta «¿esto lo toma ventas u operaciones?» no tiene dónde escribirse.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

Verificado: `user_role` tiene **solo dos referencias en el código**, así que el cambio es barato.

- [ ] Existen los roles de **ventas** y **operaciones**, además de admin.
- [ ] Ventas alcanza el módulo del vendedor; operaciones el de confirmación; **admin ambos**.
- [ ] Un usuario con rol de ventas **no puede llegar** a las pantallas de confirmación, ni por URL directa.
- [ ] Los usuarios existentes conservan exactamente el acceso que tienen hoy — nadie pierde permisos por esta migración.
- [ ] **La separación la impone el rol, no el módulo**, para que quien legítimamente hace las dos cosas no quede atrapado en una.
