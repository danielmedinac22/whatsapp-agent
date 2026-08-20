# 04 — Verificar el evento en el administrador de Meta

**What to build:** Prueba de que el circuito completo funciona: un evento de prueba sale del sistema y **se ve llegar** en el administrador de eventos de Meta, con su valor, su moneda y su atribución al anuncio correcto.

Sin este paso, lo único que sabemos es que enviamos algo.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Se envía un evento con el código de prueba de Meta y se confirma su llegada en el administrador de eventos.
- [ ] El evento aparece **atribuido al anuncio correcto**, no como tráfico anónimo. Es lo único que demuestra que el identificador de clic sirvió.
- [ ] El valor y la moneda se ven correctos en Meta.
- [ ] Queda registrado qué calidad de coincidencia reporta Meta, como línea base.
- [ ] Solo después de esto se habilita el envío real.
- [ ] Queda documentado el procedimiento, para repetirlo tal cual cuando se abra el píxel de Colombia.

---

## Answer — el token llegó, y aun así este ticket sigue bloqueado (19-ago-2026)

**Status: abierto, con el bloqueo por fin identificado con precisión.**

El token de usuario de sistema llegó y **sí trae `whatsapp_business_manage_events`**
— verificado contra `debug_token`: es `SYSTEM_USER`, no caduca
(`expires_at: 0`), y sus permisos son `ads_read` + `whatsapp_business_manage_events`.
Eso era lo que este ticket decía que faltaba, y ya no falta.

### Lo que falta de verdad, y no es lo que el ticket decía

**El dataset de Guatemala no existe, y con este token no se puede ni leer ni
crear.** Medido:

```
GET /v21.0/1676368750161510/dataset
→ (#200) You do not have permission to access this field
```

La WABA tampoco se lee (`GraphMethodException`, subcódigo 33). Confirmado contra
la documentación de *Conversions API for Business Messaging*: el edge `dataset`
de una cuenta de WhatsApp exige **dos** permisos —`whatsapp_business_management`
**y** `whatsapp_business_manage_events`— y el token solo tiene el segundo.

Es un permiso distinto y hay que pedirlo aparte. **No alcanza con el que ya
mandaron.**

### Lo que destraba esto, en orden de menor a mayor fricción

1. **Leer el dataset a mano en el Administrador de Eventos** y pegarlo en el
   panel: Conexión → Meta → «Dataset de conversiones». Con eso
   `operations.capi_dataset_id` queda puesto sin tocar la API. Es el camino
   corto, y funciona **si el dataset ya existe**.
2. **Agregar `whatsapp_business_management` al mismo usuario de sistema** y
   volver a emitir el token. Con eso `GET /{waba}/dataset` devuelve el que haya y
   `POST` crea el que falte.

### El resto del criterio sigue esperando algo que no es una credencial

Aunque mañana aparezca el dataset, este ticket **no se puede cerrar todavía**: su
criterio central es que el evento se vea **atribuido al anuncio correcto**, y para
eso hace falta un `ctwa_clid` real. Hoy `conversations` tiene 1.759 filas y
**cero** con `ad_id` — porque ningún anuncio de la cuenta apunta al número que
escucha el panel, que es una decisión y no un defecto. Hasta que los dos números
se unan, no hay conversión que verificar.

### Estado medido del reporte, en producción

```
GET /api/capi/estado
→ modo: "off" · motivo: "el reporte a Meta está apagado (META_CAPI_MODE sin poner)"
   datasetId: null
```

**`META_CAPI_SYSTEM_USER_TOKEN` se dejó deliberadamente sin cargar.** Con el
dataset ausente, cargarlo no habilita nada y sí quita el segundo freno de los
tres que `send-mode.ts` documenta («sin credencial no hay envío, diga lo que diga
el interruptor»). Se carga el día que exista el dataset y alguien decida
encender, no antes.
