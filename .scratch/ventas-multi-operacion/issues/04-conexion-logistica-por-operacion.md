# 04 — La conexión de logística cuelga de la operación

**What to build:** Cada operación tiene su propia conexión de logística, y el seguimiento de guías, novedades y entregas ocurre dentro de su operación.

Tercer lote: diecinueve referencias.

**Blocked by:** 01

**Status:** claimed — worktree `op-04-dropi`, tanda del 16-ago-2026

- [ ] La conexión de logística declara a qué operación pertenece.
- [ ] El sondeo, la sincronización y las notificaciones se ejecutan por operación.
- [ ] Los pedidos de logística se cruzan solo contra pedidos de su misma operación.
- [ ] Los diecinueve llamadores existentes pasan a resolver por operación.
- [ ] El comportamiento de la operación de Guatemala no cambia.

**Nota para revisar antes de replicar en Colombia:** el modo simulación está activo — las confirmaciones a logística no se envían de verdad. Confirmar si es intencional.

## Medido contra el código (16-ago-2026)

**«Diecinueve referencias» eran menciones del símbolo.** Los call sites reales de `getDropiConnection()` son **once**, en nueve archivos:

`dropi/config.ts` (donde vive, línea 9) · `dropi/auth.ts` · `dropi/notify.ts` · `dropi/2fa-inbound.ts` · `agent/escalation.ts` · `jobs/dropi-auth-refresh.ts` · `jobs/dropi-novedad-handoff.ts` · `jobs/dropi-novedad-reminder.ts` · `routes/dropi.ts`

`upsertDropiConnection()` (`dropi/config.ts:28`) escribe con `where(eq(dropiConnection.id, 1))` y también hay que parametrizarlo. El accesor cachea 30 segundos en variable de módulo: esa caché tiene que quedar indexada por operación o desaparecer, o devolverá la conexión de otro país sin fallar.

**Este worktree es el dueño único de `apps/worker/src/dropi/notify.ts`.** El ticket 05 corre en paralelo y ese archivo es el único que ambos rozan — pero el 05 solo lo usa como *anotación de tipo* (`typeof agentSettings.$inferSelect` en las líneas 41 y 194: recibe la configuración por parámetro, no la lee). Su tipo no cambia, así que el 05 no tiene por qué editarlo. Tú sí: la línea 139 llama `getDropiConnection()`.

**`dropi_dry_run` está en `true` y no se toca.** Es el único freno del sistema y cubre solo las confirmaciones a logística. Cambiarlo dispararía confirmaciones reales sobre 1.755 pedidos; es una decisión con dueño, no un efecto colateral de un refactor.

**Producción:** 1 fila, `https://api.dropi.gt/api`, user 12178, con auto-login y 2FA por WhatsApp. `dropi/auth.ts` son 585 líneas — el archivo más grande que toca este lote.
