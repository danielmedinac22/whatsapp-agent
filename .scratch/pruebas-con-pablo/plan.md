# Pruebas con Pablo — plan

Origen: pedido del 23-ago-2026. **Que Pablo pueda probar el camino de venta
entero dándose de alta desde el producto**: encender, vincular, y una guía que
le diga cómo.

Todo lo medido acá sale de lo registrado hasta el 20-ago-2026 y de leer el
código en esta rama. **La base de producción no es alcanzable desde una sesión
en la nube** —el proxy público de Railway está bloqueado por la política de red
del entorno—, así que los números de estado hay que reconfirmarlos desde la
máquina de Daniel antes de la ventana de prueba. Están marcados con ⚠︎.

## 1 · Dónde íbamos

El camino de venta está **construido de punta a punta y apagado a propósito**.
39 de 44 tickets, migraciones `0020`–`0030` aplicadas, worker en Railway y
dashboard en Vercel. El último lote (`ventas-bandeja-honesta`) cerró el
20-ago-2026 y dejó la bandeja de ventas en 0 y el contador rojo en 35.

Lo que hace falta para que Sebastián atienda ya no es código. Son cinco actos,
y **tres de los cinco los puede hacer Pablo solo desde el panel**:

| Acto | ¿Desde el producto? | Dónde |
| -- | -- | -- |
| Cargar el catálogo | **sí** | Ventas → Catálogo |
| Registrar el anuncio | **sí** | Ventas → Catálogo → Anuncios |
| Encender a Sebastián | **sí** | Ventas → Vendedor |
| Que la pauta apunte al número del panel | no — consola de Meta | Ads Manager |
| Escribir el pedido en la tienda de verdad | no — variable del worker | Railway |

## 2 · El hallazgo que ordena todo el plan

**La pauta de Vorare no apunta al número que escucha el panel, y por eso el
camino de venta nunca se ha ejecutado ni una vez.**

Verificado el 18-ago-2026 contra la Graph API: de 500 conjuntos de anuncios de
`act_2042265076620189`, diez tienen destino WhatsApp, y **cero** apuntan a
+502 3689 0343, que es el número conectado al panel. Los dos conjuntos activos
van a +502 4722 4176, que es otra WhatsApp Business y está en ON_PREMISE.

De ahí salen tres consecuencias que mandan sobre el orden de las pruebas:

1. **`ad_referral_at` está en `null` en las 1.759 conversaciones.** No es un
   fallo de captura: esos leads nunca pudieron llegar acá. Pero significa que
   **la captura de la referencia CTWA nunca corrió contra un payload real de
   Meta**. Es el único tramo del camino sin una sola ejecución de verdad.
2. **Sin anuncio no hay producto identificado, y sin producto no hay cierre.**
   La cascada de reconocimiento resuelve por id del anuncio o por el copy del
   anuncio; el mensaje del cliente no entra en ninguno de los dos niveles
   (`sales/recognition.ts`). Con `conversations.product_id` en `null`, la
   herramienta de cierre devuelve `no_product` y **escala a una persona**
   (`agent/sales-closing-tool.ts:183`). Una prueba sin anuncio no puede llegar
   al final por diseño, no por un defecto.
3. **La atribución no se recupera después.** No existe endpoint de Meta para
   pedir el `referral` o el `ctwa_clid` de un mensaje pasado. Toda pauta que
   corra hacia el número del panel antes de que la captura esté verificada es
   atribución perdida para siempre.

**Por eso la prueba de verdad empieza en Meta, no en el panel**: hace falta un
conjunto de anuncios de presupuesto mínimo apuntando a +502 3689 0343. Es la
acción más barata que existe —duplicar un conjunto y cambiarle el destino— y es
la única que enciende el tramo que nunca se ejecutó.

## 3 · La trampa del encendido, y es irreversible

Guardar un nombre visible en Ventas → Vendedor hace **dos** cosas, no una:
enciende al vendedor y **estampa `activated_at` con la hora de ese guardado**
(`apps/web/src/lib/vendedor.ts:95`). Esa fecha es la línea de corte: lo nacido
antes es de Katherine para siempre, lo nacido después sin pedido es de
Sebastián.

Y **no se vuelve a mover nunca**. El `coalesce` de la misma sentencia lo impide,
y el respaldo perezoso de `stampSalesAgentActivation` también. Apagar el
vendedor borrando el nombre no la borra.

La consecuencia práctica: **si Pablo enciende hoy para probar y apaga, la línea
queda clavada hoy.** El día que lo enciendan de verdad, todas las conversaciones
sin pedido nacidas entre medio caen de golpe en la bandeja de ventas. Es
exactamente la bandeja definida por resta que el lote de la semana pasada
apagó — el histórico de esos meses volvería a aparecerle a Sebastián como
trabajo suyo.

Dos salidas, y hay que elegir una antes de la prueba:

- **A · Encender una sola vez, el día que la pauta ya apunte al número.** Sin
  cambios de código. La prueba de conversación se hace ese mismo día.
- **B · Poder mover la línea de corte a mano**, como acto deliberado de admin
  en la pantalla del vendedor. Es un ticket chico y no toca el camino que
  factura, pero es cambiar una decisión de diseño que se tomó con motivo.

**Recomendado: A.** Alinear la prueba con el encendido real cuesta coordinación,
no código, y evita tocar la regla que acaba de arreglar la bandeja.

## 4 · Lo que Pablo va a ver, y lo que no

Con la escritura en la tienda en seco (`SHOPIFY_ORDER_WRITE_MODE` sin poner,
que es el estado de hoy), un cierre exitoso:

- **no crea el pedido** en Shopify — correcto, es el modo seco;
- **no le manda nada al cliente**, a propósito: decirle «tu pedido quedó
  registrado» cuando no quedó es el fallo silencioso al revés
  (`sales/closing.ts:216`);
- **no deja fila en la cola de cierres**, porque la cola solo guarda los que
  fallaron;
- deja **una línea de log en Railway** y nada más.

O sea: **un cierre en seco es invisible desde el panel.** Pablo va a ver la
conversación pedirle los datos y después quedarse callada, sin manera de
distinguir «cerró bien en seco» de «se rompió». Es la diferencia entre una
prueba que concluye y una que deja dudas.

Tres formas de resolverlo, de menor a mayor:

1. **Daniel mira los logs de Railway** durante la ventana de prueba y lo
   confirma por WhatsApp. Cero código, sirve para una prueba acompañada.
2. **Que el cierre en seco avise al admin** por el mismo camino que ya usa el
   escalamiento (`adminPhone` de la conexión, editable en Conexión → Dropi).
   Ticket chico, y le sirve a cualquier prueba futura.
3. **Encender la escritura de verdad** contra un pedido desechable y cancelarlo
   después. Es el riesgo R6 de la no-regresión, exige despliegue, y es la
   prueba que de todas formas hay que hacer alguna vez.

**Recomendado: 1 para la primera pasada, 3 como paso siguiente el mismo día si
la conversación sale limpia.**

## 5 · Lo que no se puede hacer desde el producto

Cinco cosas del alta no tienen pantalla. Las tres primeras son las que le pegan
a esta prueba:

| Qué | Hoy | ¿Vale un ticket? |
| -- | -- | -- |
| **Crear el usuario de Pablo** | `scripts/create-user.ts` con `USER_EMAIL`/`USER_PASSWORD`/`USER_ROLE` | Sí, pero no bloquea: se corre una vez |
| **Vincular el número de WhatsApp** | panel de Kapso + `POST /api/kapso/connect` | No para esta prueba: ya está vinculado |
| **Encender la escritura en la tienda** | `SHOPIFY_ORDER_WRITE_MODE=live` en Railway | **No.** Es deliberado: encender la escritura sobre la tienda de un cliente pide un despliegue, no un clic (`shopify/write-mode.ts`) |
| **Encender el reporte a Meta** | `META_CAPI_MODE` + dataset | No: sin dataset no habilita nada |
| **Crear el dataset de CAPI** | falta el permiso `whatsapp_business_management` | Sí, pero es de Vorare y va después |

Y un defecto chico, encontrado al revisar: **`scripts/create-user.ts` rechaza
los roles `sales` y `operations`** (línea 12), que existen en el esquema desde
la `0023`. Hoy no muerde porque Pablo va como `admin`, pero el día que quieran
darle acceso a un vendedor de Vorare, el script no lo deja.

## 6 · Antes de abrir la ventana de prueba

Cuatro comprobaciones, todas desde la máquina de Daniel:

1. ⚠︎ **Que Pablo tenga usuario.** `pnpm tsx scripts/list-users.ts`. Si no está,
   `USER_EMAIL=… USER_PASSWORD=… USER_ROLE=admin pnpm tsx scripts/create-user.ts`.
2. ⚠︎ **El saldo de OpenRouter.** `pnpm tsx scripts/prueba-openrouter.ts`. Es la
   causa de las 25 horas mudas del 21-ago: el tope de gasto de la llave se agota,
   OpenRouter responde 402 y en `agent_runs` queda escrito «Response validation
   failed». **Sigue sin haber aviso cuando `agent_runs` acumula errores**, así
   que durante la prueba la única alarma es mirar.
3. ⚠︎ **El estado de los tres frenos**: `sales_agent_settings.display_name`
   vacío y `activated_at` en `null`, `products` en 0 filas, `writeMode:
   dry_run` en Conexión → Shopify.
4. **La credencial de Shopify caduca a las 24 h** y se reacuña sola. Si la
   pantalla de la tienda dice algo raro, es lo primero a mirar.

## 7 · El orden de la prueba

**Fase 0 — Vorare, en Meta (lo único que bloquea).** Un conjunto de anuncios de
presupuesto mínimo, público acotado, **destino +502 3689 0343**. Puede quedar
pausado hasta el día de la prueba. Sin esto, las fases 2 y 3 no existen.

**Fase 1 — Pablo solo, en el panel.** Catálogo con al menos un producto con
precio, el id del anuncio de la fase 0 registrado contra ese producto, y el
vendedor encendido. Lo verifica la banda de señal del catálogo, que dice en
palabras si el mapa se está consultando o no.

**Fase 2 — el clic.** Pablo hace clic en el anuncio desde un número que nunca
le haya escrito a Vorare, y conversa hasta dar los datos de entrega. Es la
pasada que verifica de una sola vez: la captura de la referencia, el
reconocimiento del producto, el ruteo a la bandeja de ventas, la persona de
Sebastián y la herramienta de cierre.

**Fase 3 — la venta de verdad.** Solo si la fase 2 salió limpia:
`SHOPIFY_ORDER_WRITE_MODE=live`, un pedido desechable en la tienda real, y se
cancela. Es el R6 de la no-regresión y se hace mirando.

**Fase 4 — CAPI.** Falta el dataset y el permiso. Va aparte y va al final, con
el código de prueba de Meta (R7).

## 8 · Qué queda para después de la prueba

Sale de lo que este plan destapó, y ninguno bloquea:

- **Aviso cuando `agent_runs` acumula errores seguidos.** Es lo único que habría
  visto la caída del 21-ago a tiempo, y durante una prueba acompañada es la
  diferencia entre «Sebastián no contesta» y «Sebastián se cayó».
- **Que el cierre en seco deje rastro visible** — punto 4 de arriba.
- **Mover la línea de corte como acto deliberado** — opción B del punto 3.
- **`create-user.ts` acepta los cuatro roles.**
- **Alta de usuarios desde el panel**, el día que Vorare quiera dar accesos sin
  pedírselo a Daniel.
