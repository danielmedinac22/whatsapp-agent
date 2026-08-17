# 02 — La referencia del anuncio llega al sistema

**What to build:** Cuando alguien hace clic en un anuncio Click-to-WhatsApp y escribe, el sistema conserva de qué anuncio vino: identificador, titular, cuerpo, URL de origen e identificador de clic. Hoy esa información se pierde.

**Blocked by:** None — can start immediately.

**Status:** resolved salvo la verificación contra un anuncio real — worktree `ingesta-atribucion`, rama `danielmedinac22/ingesta-atribucion`, sin merge ni deploy. La verificación queda fuera: depende de que Vorare tenga campaña corriendo. Tanda del 17-ago-2026

- [x] El parser de mensajes entrantes expone la referencia del anuncio cuando el payload la trae.
- [x] Un payload sin referencia se sigue parseando igual que hoy, sin romper ni inventar campos.
- [x] La suite de tests del parser cubre payload con referencia y payload sin ella.
- [ ] Queda verificado contra un mensaje real originado en un anuncio activo si la ruta exacta del campo dentro del payload coincide con lo documentado. — **fuera de alcance de este worktree**: exige un clic real en un anuncio activo. Los pasos exactos, abajo.
- [ ] Si el proveedor recorta el campo, queda documentado qué se observó y cuál es la ruta alterna. — la ruta alterna está documentada; *qué se observó* depende del mismo clic.
- [x] **El identificador de clic queda disponible además del identificador de anuncio.** El de anuncio sirve para reconocer el producto; el de clic es lo que después permite reportar la venta a Meta. Se persisten juntos.

## Salida alterna verificada el 16-ago-2026

El token de la app de Meta trae `whatsapp_business_management` y `whatsapp_business_messaging`. Eso abre la posibilidad de **recibir los webhooks directo de Meta**, con la referencia sin pasar por el serializador del proveedor — que es justo lo que comprobamos que recorta campos.

**Resuelto por investigación el 16-ago-2026: sí, dos apps pueden suscribirse a la misma cuenta de WhatsApp.** El endpoint suscribe «tu aplicación» y lista «todas las aplicaciones»; añade, no reemplaza, y los reintentos van a todas las suscritas. Se puede suscribir **solo al campo de mensajes** sin tocar la configuración del proveedor actual. El permiso que hace falta para eso es `whatsapp_business_messaging`, que el token ya tiene.

**Orden recomendado, de menor a mayor riesgo:**

1. **Probar primero el webhook en modo passthrough del proveedor.** Riesgo cero y ya está documentado que no recorta.
2. Si falla, suscribir la segunda app. Antes: averiguar si la cuenta de WhatsApp pertenece al portafolio de Vorare —en cuyo caso no consume cupo de socio— o al del proveedor, donde ocuparía el segundo y último de dos.
3. Levantar el callback **antes** de suscribir: el alta valida que responda y falla si no.
4. Verificar con una consulta antes y después que aparezcan **dos** entradas. Es la única prueba concluyente, porque la documentación no lo afirma literalmente.

## ⚠ Urgencia que reordena prioridades

**No existe ningún endpoint para recuperar la referencia después del hecho.** Si no se captura en el webhook, el identificador de clic se pierde para siempre.

**Cada peso de pauta que corra antes de que esto funcione es atribución perdida.** Este ticket va antes de invertir en anuncios, no en paralelo.

## Answer — esquema puesto por la `0022` (17-ago-2026), el parser sigue abierto

El worktree `esquema-0022` dejó las columnas de atribución aplicadas en producción, **en `conversations` y no en `messages`**, como decidió el spec: la referencia llega solo en el primer mensaje, se guarda asociada a la conversación en cuanto llega y el resto del sistema la lee de ahí. **Este ticket no genera migración.**

### Columnas nuevas en `conversations` (todas nullable — 1.692 filas existentes no tienen anuncio)

| columna | tipo | campo de Meta (`referral.*`) | para qué |
| -- | -- | -- | -- |
| `ad_id` | text | `source_id` | el identificador del anuncio; **clave del mapeo `product_ads`** (nivel 1 de la cascada) |
| `ad_headline` | text | `headline` | titular |
| `ad_body` | text | `body` | cuerpo |
| `ad_source_url` | text | `source_url` | URL de origen |
| `ctwa_clid` | text | `ctwa_clid` | **el identificador de clic**; distinto del de anuncio, es lo que después permite reportarle la venta a Meta (CAPI). Va con el nombre exacto de Meta porque así se llama el parámetro que CAPI recibe |
| `ad_referral_at` | timestamptz | — | cuándo llegó la referencia (timestamp del mensaje que la trajo). **Lo lee el ruteo**: «atribución más reciente que el último pedido» → ventas |
| `ad_referral_raw` | jsonb | el objeto completo | seguro contra recortes: no existe endpoint para recuperar la referencia después del hecho, y el serializador del proveedor ya recortó campos que Meta sí manda. Guarda el `referral` tal cual llegó, aunque la ruta exacta cambie |

En drizzle: `conversations.adId`, `adHeadline`, `adBody`, `adSourceUrl`, `ctwaClid`, `adReferralAt`, `adReferralRaw`.

### Semántica que hereda quien escriba

- **Un clic nuevo sobrescribe la referencia anterior.** Hay una conversación por contacto para siempre (índice único sobre `contact_id`), y el ruteo quiere «la más reciente»: el recomprador que hace clic en un anuncio nuevo vuelve a ventas. Si un día hace falta el historial de clics, es una tabla append-only aparte — no una columna más aquí.
- **`ad_referral_at` lo pone quien escribe**, no la base: no tiene default para que una fila sin referencia quede en `null` de verdad («una conversación sin referencia simplemente no tiene identificador, sin inventar uno», ticket CAPI 01).
- **`ctwa_clid` se escribe junto con `ad_id`, en la misma escritura.** Perderlo es irreversible.
- El **producto** que la cascada resuelva va en `conversations.product_id` (→ `products`, `set null`); ver el `## Answer` del ticket 03. No lo escribe este ticket: lo escribe el 04.
- `messages` no cambió: la referencia no se persiste por mensaje.

### Lo que sigue siendo de este ticket

Todo lo del checklist: exponer el `referral` en `parseKapsoInbound` (o donde viva el parser hoy), tests con y sin referencia, y la verificación contra un anuncio real de que Kapso no recorta el campo — con la salida alterna documentada arriba si lo recorta. El esquema no cambia en ninguno de los dos casos: `ad_referral_raw` absorbe la forma que llegue.

### Verificado en producción tras aplicar

Las siete columnas existen, son nullable y ninguna conversación tiene valor en ellas (`0` filas con `ad_id`, `product_id` o `assigned_user_id` no nulos). Conteo de conversaciones 1.692 → 1.693 durante la migración: producción siguió operando.

## Answer — el parser, construido el 17-ago-2026

**La referencia llega al sistema y se persiste.** `parseInboundMessage` la expone en
`ParsedInboundMessage.adReferral` y el pipeline de entrada la guarda en la conversación,
entera y de una sola vez. Sin migración: las columnas ya estaban.

### La forma

```ts
interface ParsedAdReferral {
  adId: string | null;       // referral.source_id  — el ANUNCIO, clave de product_ads
  headline: string | null;
  body: string | null;
  sourceUrl: string | null;  // referral.source_url
  sourceType: string | null; // "ad" | "post" | "organic" (este último, propio de Kapso)
  ctwaClid: string | null;   // referral.ctwa_clid — el CLIC, lo que CAPI recibe
  path: string;              // dónde apareció dentro del payload
  raw: Record<string, unknown>; // el objeto entero, tal cual llegó
}
```

`adReferral` es `null` en todos los mensajes que no vienen de un anuncio, que hoy son
todos. Un payload sin referencia se parsea **exactamente** igual que antes.

### Cómo se resuelve que la ruta sea un dato desconocido

La documentación de Kapso afirma que manda `referral` en `message.received` pero **no
dice dónde**, y su serializador ya recortó `from_user_id`, un campo que él mismo modela.
Adivinar mal la ruta es pérdida irreversible y silenciosa. Así que el parser no adivina
una, busca en tres capas:

1. **Cinco rutas conocidas, en orden de probabilidad**: `message.referral` (donde la pone
   Meta, hermana de `from` e `id`), `message.kapso.referral`, `referral` en la raíz,
   `conversation.referral` y `conversation.kapso.referral` — las dos últimas porque el
   dashboard de Kapso asocia los referrals a la *conversación* y les pone un badge CTWA.
2. **Búsqueda a ciegas por clave**: cualquier clave llamada `referral`, a cualquier
   profundidad.
3. **Búsqueda a ciegas por campos**: cualquier objeto con `source_id`, `ctwa_clid`,
   `source_type` o `source_url`.

Los marcadores del paso 3 son deliberadamente los cuatro nombres **propios** del referral
y no `headline`/`body`: `body` es también el campo del texto de un mensaje normal
(`message.text.body`), y buscar por él haría que todo mensaje escrito a mano pareciera
venir de un anuncio. Hay test de eso exacto.

La búsqueda está acotada (profundidad 6, 500 nodos) porque corre en **cada** mensaje
entrante, incluidos los que no vienen de ningún anuncio.

**`path` es la respuesta a la pregunta abierta del ticket.** El primer clic real deja la
ruta verdadera escrita en el log del worker (`ingesta: atribución de anuncio guardada`),
sin tener que ir a buscarla a los Logs del proveedor dentro de su ventana de 7 días.

### Lo que se guarda, y por qué entero

Los siete campos se escriben **en una sola sentencia**, `ad_id` y `ctwa_clid` incluidos:
perderlos por separado es perderlos. Y `ad_referral_raw` guarda el objeto tal cual, con
los campos que no parseamos (`media_type`, `image_url`, `welcome_message`, `ref`): si
mañana se descubre que la ruta o el nombre de un campo era otro, el dato sigue ahí y se
re-parsea. Hay test de que el crudo sobrevive intacto.

Una referencia que **no identifica nada** (por ejemplo solo `source_type: "organic"`)
cuenta como ausente: sin anuncio, sin clic, sin URL y sin copy no hubo clic en nada, y
guardarla marcaría la conversación como lead recién llegado de una pauta.

### Verificado hoy contra la cuenta real, en solo lectura

Se repitieron los pasos 1 y 2 de la investigación (`log_search`, `GET`): **cero eventos
con `referral` o `ctwa_clid` en la ventana de 7 días**, en `whatsapp_webhook_event` y en
`webhook_delivery`. Sigue sin haber tráfico CTWA que observar — la ausencia no prueba
nada sobre el reenvío, solo que nadie ha entrado por un anuncio.

### Qué habría que verificar en cuanto haya un clic real, y cómo

Requisito, y es lo único fuera de nuestro control: **un anuncio Click-to-WhatsApp activo
apuntando al número y un clic desde un teléfono de prueba** (~1–5 USD/día, se pausa
apenas llegue el mensaje).

1. **Mirar el log del worker.** Si aparece `ingesta: atribución de anuncio guardada`, ya
   está: el campo `ruta` dice la ruta exacta y `tieneClid` dice si vino el identificador
   de clic. Es la verificación completa, sin tocar nada.
2. **Confirmar en la base** (solo lectura):
   `select ad_id, ctwa_clid, ad_referral_at, ad_referral_raw from conversations where ad_id is not null;`
   La fila tiene que traer los dos identificadores y el crudo.
3. **Si el log no apareció**, comparar las dos mitades en los Logs de Kapso, dentro de las
   24 h del clic:
   - `GET /platform/v1/log_search?query=referral&period=24h&source=whatsapp_webhook_event`
     → `payload.raw_payload` es el sobre de Meta. Si ahí está `messages[0].referral`,
     Meta lo mandó. Anotar el `wamid`.
   - `GET /platform/v1/log_search?query=<wamid>&period=24h&source=webhook_delivery`
     → `payload.request_body` es el cuerpo exacto que Kapso nos POSTeó. Si el `referral`
     está en el primero y no en el segundo, **queda demostrado el recorte** y se pasa a
     la vía alterna.
4. **Vía alterna, si se demostró el recorte:** webhook `kind: "meta"` (passthrough
   textual, garantizado por la documentación de Kapso y comprobado contra sus Logs). Se
   **crea** uno nuevo apuntando primero a un bin público —`kind` no se puede cambiar
   después de crear, y así no se toca el webhook que hoy factura—, se repite el clic y se
   revisa si trae `X-Webhook-Signature`, que en ese modo no está documentado. La
   convivencia es el diseño recomendado: el webhook `kapso` se queda como está (de él
   dependen `transcript`, `media_url` y `contact_name`) y el `meta` alimenta solo la
   atribución, casando por `wamid`.
   **Nada de esto toca este parser**: la búsqueda a ciegas ya encuentra el `referral`
   dentro del sobre crudo de Meta, y el esquema no cambia en ninguno de los dos casos.

### Verificación

`pnpm -r typecheck` limpio en los 4 paquetes. `pnpm --filter @wa/worker test`: **180 tests
en 12 archivos** — los **135 existentes sin tocar** y 45 nuevos, de los cuales 15 son del
parser: referencia en la ruta de Meta, en el sub-objeto de Kapso, colgada de la
conversación, en una ruta que nadie previó, reconocida por sus campos sin clave
`referral`, con sobre `data`, en un mensaje que no es de texto; y payload sin referencia,
respuesta de botón, cuerpo de texto que no se confunde con un anuncio, referencia que no
identifica nada, campos en blanco, id sin comillas y anuncio sin identificador de clic.
