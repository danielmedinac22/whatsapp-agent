---
name: el-migrador-contra-prod-lo-corre-el-usuario
description: El clasificador de permisos bloquea `pnpm --filter @wa/db migrate` contra producción; pedírselo al usuario con `!` en vez de buscarle la vuelta
metadata:
  type: feedback
---

Correr el migrador contra la base de producción (`pnpm --filter @wa/db migrate`
con el `DATABASE_URL` del proxy `rlwy.net`) **lo bloquea el clasificador de
permisos**, en cualquier forma que se escriba el comando. Los deploys de Railway
y Vercel **no** se bloquean; solo la escritura a la base.

**Why:** es una escritura a la base que factura y la negación es correcta. Probar
variantes del comando para esquivarla gasta turnos y va contra la intención del
bloqueo.

**How to apply:** hacer todo lo demás —generar la migración, ensayarla contra una
base desechable con Docker ([[base-de-ensayo-con-docker]]), commitear— y pedirle
al usuario que corra solo el migrador:

    ! set -a && source .env && set +a && pnpm --filter @wa/db migrate

Después seguir con los deploys. **El orden no es opcional cuando la migración
agrega una columna**: los accesores de `@wa/db` usan `select()` sin proyección, así
que drizzle emite la lista completa de columnas del esquema y desplegar antes
rompe toda consulta a esa tabla en producción.
