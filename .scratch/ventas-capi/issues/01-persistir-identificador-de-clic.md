# 01 — Persistir el identificador de clic

**What to build:** El identificador de clic del anuncio queda guardado en el primer contacto, junto a la atribución de producto. Es el dato que después permite decirle a Meta qué pauta produjo la venta, y **solo llega en el primer mensaje** — si no se guarda ahí, se pierde para siempre.

**Blocked by:** ventas-ingesta-reconocimiento 04 · Reconocimiento por ID de anuncio

**Status:** resolved — worktree `ingesta-atribucion`, rama `danielmedinac22/ingesta-atribucion`, sin merge ni deploy. Tanda del 17-ago-2026

- [x] El identificador de clic se extrae junto con la referencia del anuncio y se persiste en el primer contacto.
- [x] Se guarda asociado a la conversación y a su operación, no globalmente.
- [x] Un mensaje posterior de la misma conversación —incluida respuesta de botón— sigue teniendo el identificador disponible.
- [x] Una conversación sin referencia de anuncio simplemente no tiene identificador, sin inventar uno.
- [x] Los tests cubren presencia y ausencia del campo.

## Answer — construido el 17-ago-2026

**El identificador de clic queda guardado.** `conversations.ctwa_clid`, escrito en la
misma sentencia que `ad_id` y los demás campos de la referencia. Sin migración: la `0022`
ya había puesto la columna.

### Dónde y con qué garantías

- **Se extrae junto con la referencia**, no aparte: sale del mismo objeto `referral` que
  el identificador de anuncio (`ParsedAdReferral.ctwaClid` ← `referral.ctwa_clid`), y por
  eso no hay ningún camino en el que uno se guarde y el otro no. El tipo de la escritura
  (`AdAttributionWrite`) exige los siete campos a la vez, así que **no se puede escribir
  media atribución** — no compila.
- **Va en la conversación, y la conversación tiene su operación**
  (`conversations.operation_id`, resuelta en la ingesta por el número que recibió el
  mensaje y conservada de principio a fin). No hay ningún almacén global de clics.
- **Se escribe lo antes posible**, antes incluso de guardar el mensaje: es el único dato
  del sistema que no se puede recuperar. Si esa escritura fallara, el mensaje del cliente
  se procesa igual y el error sale en el log **con la referencia entera dentro**, que es
  lo que permitiría recuperarla a mano (los Logs del proveedor solo guardan el cuerpo
  exacto 7 días).
- **Un mensaje posterior no lo borra.** Un mensaje sin referencia —toda respuesta de botón
  o de lista, que Meta nunca acompaña de `referral`— no escribe nada, y la conversación
  conserva anuncio, clic y producto. Es la primera de las dos reglas del módulo de
  atribución y tiene test propio.
- **Sin referencia no se inventa nada.** Una conversación sin anuncio queda con
  `ctwa_clid` y `ad_referral_at` en `null` de verdad; `ad_referral_at` no tiene default en
  el esquema justamente para eso. Y un anuncio que llega sin `ctwa_clid` —Meta lo omite en
  los anuncios de Estados— se guarda igual, con el clic en `null`: el anuncio sirve para
  reconocer el producto aunque no haya nada que reportarle a Meta después.

### La pérdida que sí existe, y que está decidida

Un clic nuevo **pisa la referencia anterior entera**, identificador de clic incluido, y no
hay endpoint de Meta para recuperarla. Es la semántica que el ticket 02 fijó y que el
ruteo necesita («la atribución más reciente»). Lo que **no** se hace es mezclar: no se
conserva el `ctwa_clid` viejo junto al `ad_id` nuevo, porque eso le reportaría a Meta la
venta de una pauta que no la produjo —peor que no reportarla, por el riesgo R7— y porque
un evento mal atribuido envenena el aprendizaje del algoritmo y eso no se revierte. Si un
día hace falta el historial de clics, es una tabla append-only aparte. Hay test de que
ningún campo del clic viejo sobrevive.

### Lo que este ticket NO hizo, y sigue siendo de CAPI

- No construye el evento de conversión ni lo envía: eso es *ventas-capi 02/03*, y sigue
  **bloqueado por el permiso `whatsapp_business_manage_events`**, que el token todavía no
  trae.
- No decide nada sobre el píxel ni sobre la moneda.
- El dato que esos tickets van a leer es `conversations.ctwa_clid`, con
  `conversations.operation_id` al lado para resolver el píxel de la operación.

### Verificación

`pnpm -r typecheck` limpio en los 4 paquetes. `pnpm --filter @wa/worker test`: **180 tests
en 12 archivos**, los 135 existentes sin tocar. Cubren presencia y ausencia del campo en
el parser (anuncio con y sin `ctwa_clid`, campo en blanco, payload sin referencia) y en la
persistencia (se guarda junto al anuncio, no se inventa, no se borra con una respuesta de
botón, no revive el viejo cuando el nuevo no lo trae).

Contra producción, solo lectura: la columna existe, es nullable y **0 de 1.693
conversaciones tienen valor** — no hay ningún clic que se haya perdido todavía porque no
ha corrido pauta. Y sigue sin haber tráfico CTWA en la ventana de 7 días de los Logs de
Kapso, así que la captura está lista **antes** del primer peso de pauta, que era el punto.
