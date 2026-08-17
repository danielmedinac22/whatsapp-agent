# 06 — Contract: se elimina el acceso global

**What to build:** Deja de existir la posibilidad de preguntar por "la conexión" o "la configuración" sin decir de qué operación. Mientras esa puerta exista, alguien la va a usar — y el resultado es un pedido colombiano creado en la tienda guatemalteca, que nadie detecta hasta que sale el envío al país equivocado.

Paso **contract**: se borra la forma vieja ahora que nadie la usa.

**Blocked by:** 02 · 03 · 04 · 05

**Status:** ready-for-agent

- [ ] Ningún accesor devuelve una conexión o configuración sin recibir la operación.
- [ ] La referencia a operación pasa a ser obligatoria en las cuatro tablas.
- [ ] No queda ningún valor por defecto que resuelva a Guatemala implícitamente.
- [ ] La suite completa pasa en verde.
- [ ] El comportamiento observable de la operación de Guatemala sigue idéntico.

## Medido contra el código (16-ago-2026)

**Migración `0021`**, reservada para este ticket — la `0020` es del ticket 01. Vuelve `operation_id` obligatoria en las cuatro tablas. Sobre `shopify_connection` es trivial: **tiene cero filas**. Sobre las otras tres hay exactamente una fila cada una, ya asociada a Guatemala por el backfill del ticket 01. Verifica que no quede ninguna en `NULL` **antes** de aplicar el `SET NOT NULL`, o la migración falla a medias sobre producción.

**Lo que tiene que dejar de existir**, en concreto:

- `getKapsoConnection()`, `getShopifyConnection()`, `getDropiConnection()` y `requirePhoneNumberId()` sin parámetro de operación.
- `upsertDropiConnection()` sin operación.
- Cualquier `eq(<tabla>.id, 1)` que quede en el código — es el mecanismo exacto por el que un pedido colombiano termina en la tienda guatemalteca. Búscalo literalmente antes de cerrar: hoy hay quince en `agent_settings` y nueve en las tres conexiones.
- Las cachés de 30 segundos en variable de módulo de los tres accesores, si quedaron con una sola entrada en vez de indexadas por operación. Una caché global sobrevive al contract sin que el compilador diga nada, y devuelve la conexión del país equivocado.

**El tipado estricto es la red.** `strict: true` y `noUncheckedIndexedAccess: true` están activos en toda la base: al volver obligatorio el parámetro, el compilador encuentra los call sites que falten. Este paso no puede fallar en silencio — por eso se hace, y por eso el criterio de terminado es `pnpm -r typecheck` limpio, no una revisión a ojo.

**Ojo con `apps/worker/src/_tmp_templates.ts`**, si para entonces alguien lo commiteó: llama `getKapsoConnection()` y está marcado «TEMP — borrar después de usar». Bórralo en vez de migrarlo.
