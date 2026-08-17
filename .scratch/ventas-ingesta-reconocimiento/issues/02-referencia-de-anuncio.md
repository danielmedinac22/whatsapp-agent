# 02 — La referencia del anuncio llega al sistema

**What to build:** Cuando alguien hace clic en un anuncio Click-to-WhatsApp y escribe, el sistema conserva de qué anuncio vino: identificador, titular, cuerpo, URL de origen e identificador de clic. Hoy esa información se pierde.

**Blocked by:** None — can start immediately.

**Status:** esquema en curso — worktree `esquema-0022` deja las columnas de atribución; el parser sigue abierto

- [ ] El parser de mensajes entrantes expone la referencia del anuncio cuando el payload la trae.
- [ ] Un payload sin referencia se sigue parseando igual que hoy, sin romper ni inventar campos.
- [ ] La suite de tests del parser cubre payload con referencia y payload sin ella.
- [ ] Queda verificado contra un mensaje real originado en un anuncio activo si la ruta exacta del campo dentro del payload coincide con lo documentado.
- [ ] Si el proveedor recorta el campo, queda documentado qué se observó y cuál es la ruta alterna.
- [ ] **El identificador de clic queda disponible además del identificador de anuncio.** El de anuncio sirve para reconocer el producto; el de clic es lo que después permite reportar la venta a Meta. Se persisten juntos.

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
