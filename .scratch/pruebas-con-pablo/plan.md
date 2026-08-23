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

## 3 · Encender y apagar, que hasta hoy no eran actos

Hasta el 23-ago el interruptor del vendedor era **un campo de texto vacío**:
`display_name` con algo escrito significaba encendido. La deducción era
correcta —sin nombre no se puede presentar— pero convertía un campo en el
interruptor de un módulo entero, y eso costaba tres cosas:

1. **No se podía ver.** La pantalla mostraba un formulario y en ninguna parte
   decía si Sebastián estaba atendiendo.
2. **Apagar era destruir.** La única forma era borrar el nombre, y con él la
   configuración que costó escribir.
3. **Encender no se anunciaba.** Guardar un nombre además estampa
   `activated_at` —la línea de corte, que **no se vuelve a mover nunca**— y eso
   pasaba al teclear en un campo de texto, sin que nada lo dijera.

**Migración `0033`: el interruptor es una columna.** `sales_agent_settings
.enabled`, con backfill que enciende donde ya había nombre — o sea, nada en
Guatemala, que está apagada. El listón sigue siendo **una sola función**
(`salesAgentIsConfigured`), y lo que cambió es su cuerpo: ahora pide interruptor
**y** nombre. Los ocho sitios que preguntan no cambiaron una línea.

El nombre sigue pesando porque la tabla se escribe también por SQL, por un seed
y por una restauración, y un vendedor encendido sin nombre se le presenta al
cliente como nadie. La dirección segura del error es que no atienda.

### Lo que gana Pablo

- **Ve el estado**: la pantalla abre diciendo «Sebastián está apagado» o «está
  atendiendo», con su botón.
- **Apaga sin perder nada.** La configuración se queda escrita.
- **Se le avisa lo irreversible, y una sola vez.** La primera vez que enciende,
  el aviso dice que ese guardado fija la línea de corte para siempre. Después
  desaparece, porque después ya no es cierto.
- **Puede dejar todo listo sin encender**: nombre, tono y límite guardados con
  el interruptor abajo. Es lo que hace posible la fase 0.

### Lo que sigue siendo irreversible, y no cambió

`activated_at` se estampa la primera vez que se enciende y **no se mueve nunca
más**, ni apagando. Así que el primer encendido sigue siendo la decisión a
tomar en serio — lo que cambió es que ahora se decide a propósito y con aviso,
en vez de deducirse de que alguien escribió en un campo.

## 4 · El banco de pruebas — construido el 23-ago-2026

**Pablo ya puede conversar con Sebastián desde el celular sin encenderlo.**
`Ventas → Vendedor → Probar`: manda la configuración del formulario **sin
guardar**, corre el mismo constructor de prompt que el runner y contesta. No
manda WhatsApp, no escribe en `agent_runs`, no escala, no crea pedidos, y sobre
todo **no estampa la línea de corte** — que es lo que volvía irreversible la
decisión del punto 3.

Deja elegir de qué producto viene el lead, que en producción lo decide el clic
del anuncio, y los otros dos estados reales de la cascada: no reconoció nada, y
dudó entre varios. El cierre corre entero menos el último paso: valida, arma el
pedido con su total y su descuento clampeado, y lo muestra — sin crearlo.

### Y al construirlo se cayó una afirmación de este mismo plan

La versión anterior decía que en modo seco **el cliente no recibe nada**. Es
falso, y la fuente del error fue leer `sales/closing.ts` sin seguir el turno
hasta el final: ahí el cierre efectivamente no anuncia nada, pero el turno sí.
`resolveSalesTurnText` reemplaza el texto del modelo por `closingPendingMessage()`
— *«¡Listo! Ya tengo todos tus datos ✅ / Un asesor te confirma el pedido por
este mismo chat en un ratito»*.

Lo que de verdad pasa en un cierre en seco:

| | |
| -- | -- |
| El cliente recibe | el texto fijo de «tengo tus datos», **no** que el pedido exista |
| El pedido en la tienda | no se crea |
| La cola de cierres | no recibe fila: solo guarda los que fallaron |
| El texto que redactó el modelo | **no sale** — se descarta a propósito |

Así que **el cierre no es invisible**: Pablo lo va a ver en el hilo, y ese
mensaje fijo es la señal de que la herramienta corrió. Lo que sigue sin poder
distinguir desde el panel es *por qué* calló: modo seco y cierre encolado por
tienda desconectada mandan el mismo texto, porque para el cliente significan lo
mismo. Es una ambigüedad menor y no bloquea nada.

**La corrección más útil que trajo esto es de diseño del banco**: mostrar el
texto del modelo como si fuera lo que el cliente lee habría enseñado un mensaje
que producción descarta, justo en el turno que más importa. El banco muestra lo
que sale, y guarda aparte lo que el vendedor redactó y no salió.

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
3. ⚠︎ **El estado de los tres frenos**: `sales_agent_settings.enabled` en
   `false` y `activated_at` en `null`, `products` en 0 filas, `writeMode:
   dry_run` en Conexión → Shopify.
4. **Aplicar la migración `0033` ANTES de desplegar el worker.** La columna la
   lee el camino de entrada de todo mensaje: desplegar primero deja a Guatemala
   muda contra una columna que no existe. Al revés no muerde.
5. **La credencial de Shopify caduca a las 24 h** y se reacuña sola. Si la
   pantalla de la tienda dice algo raro, es lo primero a mirar.

## 7 · El orden de la prueba

**Fase 0 — Pablo, en el panel, hoy y sin depender de nadie.** Cargar un producto
en el catálogo y conversar con Sebastián en `Ventas → Vendedor → Probar` hasta
que el tono convenza. Se puede guardar todo **menos el nombre visible**: guardar
con el nombre vacío no enciende nada ni estampa la línea. Es la fase que no
necesita ni anuncio ni permiso, y la que más veces se va a repetir.

**Fase 1 — Vorare, en Meta (lo único que bloquea el resto).** Un conjunto de anuncios de
presupuesto mínimo, público acotado, **destino +502 3689 0343**. Puede quedar
pausado hasta el día de la prueba. Sin esto, las fases 3 y 4 no existen.

**Fase 2 — Encender.** El id del anuncio de la fase 1 registrado contra el
producto, y el interruptor de `Ventas → Vendedor` arriba. La banda de señal del
catálogo dice en palabras si el mapa se está consultando o no.

**Fase 3 — el clic.** Pablo hace clic en el anuncio desde un número que nunca
le haya escrito a Vorare, y conversa hasta dar los datos de entrega. Es la
pasada que verifica de una sola vez: la captura de la referencia, el
reconocimiento del producto, el ruteo a la bandeja de ventas, la persona de
Sebastián y la herramienta de cierre.

**Fase 4 — la venta de verdad.** Solo si la fase 3 salió limpia:
`SHOPIFY_ORDER_WRITE_MODE=live`, un pedido desechable en la tienda real, y se
cancela. Es el R6 de la no-regresión y se hace mirando.

**Fase 5 — CAPI.** Falta el dataset y el permiso. Va aparte y va al final, con
el código de prueba de Meta (R7).

## 8 · Qué queda para después de la prueba

Sale de lo que este plan destapó, y ninguno bloquea:

- **Aviso cuando `agent_runs` acumula errores seguidos.** Es lo único que habría
  visto la caída del 21-ago a tiempo, y durante una prueba acompañada es la
  diferencia entre «Sebastián no contesta» y «Sebastián se cayó».
- **Distinguir en el panel un cierre en seco de uno encolado.** Hoy los dos le
  mandan el mismo texto al cliente, que está bien, pero desde adentro tampoco se
  diferencian. Menor.
- **Mover la línea de corte como acto deliberado** — opción B del punto 3.
- **`create-user.ts` acepta los cuatro roles.**
- **Alta de usuarios desde el panel**, el día que Vorare quiera dar accesos sin
  pedírselo a Daniel.
