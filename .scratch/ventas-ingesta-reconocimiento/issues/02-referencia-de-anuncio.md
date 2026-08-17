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
