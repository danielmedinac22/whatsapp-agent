# 02 — La conexión de WhatsApp cuelga de la operación

**What to build:** Un mensaje entrante resuelve a qué operación pertenece según el número por el que llegó, y esa operación queda guardada en la conversación. Todo lo que ocurra después la recibe, en vez de preguntar por "la conexión" como si hubiera una sola.

Primer lote de la migración: es el de menor radio, diez referencias.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] La conexión de WhatsApp declara a qué operación pertenece.
- [ ] Un mensaje entrante resuelve su operación por la conexión que lo recibió.
- [ ] La conversación guarda su operación y la conserva de principio a fin.
- [ ] **Una conexión desconocida no resuelve a ninguna operación**, en vez de caer en una por defecto.
- [ ] Los diez llamadores existentes pasan a resolver por operación.
- [ ] El comportamiento de la operación de Guatemala no cambia.
- [ ] Los tests cubren resolución correcta por conexión y el caso de conexión desconocida.

## Medido contra el código (16-ago-2026)

**«Diez referencias» son diez call sites reales**, y el número es correcto. `getKapsoConnection()` se llama desde seis archivos:

`kapso/connection.ts` (donde vive) · `jobs/outbound.ts` · `kapso/provisioning.ts` · `routes/events.ts` · `routes/kapso.ts` · `routes/wa.ts`

El accesor está en `apps/worker/src/kapso/connection.ts:21`, hace `where(eq(kapsoConnection.id, 1))` y **cachea 30 segundos en una variable de módulo**. Al pasar a resolver por operación, la caché de una sola entrada se vuelve incorrecta: tiene que quedar indexada por operación, o desaparecer. Es el error silencioso más probable de este lote — devolvería la conexión de otro país sin fallar.

`requirePhoneNumberId()` (línea 36) es el otro punto de entrada y hoy no recibe operación: también hay que parametrizarlo.

**La fila de producción**: +502 3689 0343, WABA `1676368750161510`, `kind: production`, webhook registrado el 29-jul-2026. Coincide con el fixture `from: "50236890343"` de `kapso/inbound.test.ts`, así que los tests nuevos pueden reutilizarlo.

**Nota:** existe un `apps/worker/src/_tmp_templates.ts` **sin commitear** que también llama `getKapsoConnection()`. No está en `main`, así que no viaja al worktree y no cuenta. Es del checkout principal y lo resuelve la sesión que mergea.
