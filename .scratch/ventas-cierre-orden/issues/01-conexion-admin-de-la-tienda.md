# 01 — Conexión de administración de la tienda, por operación

**What to build:** El sistema puede **crear** pedidos en la tienda de cada operación. Hoy no puede: los pedidos entran por webhook con un secreto de entorno, pero la conexión a la API de administración —la que hace falta para escribir— **está vacía**, cero filas.

Sin esto, el cierre de ventas no tiene dónde aterrizar.

**Blocked by:** ventas-multi-operacion 03 · La conexión de la tienda cuelga de la operación

**Status:** abierto — todo lo que rodea a la credencial está construido y desplegable; falta la credencial, que trae Vorare

- [ ] La operación de Guatemala tiene su conexión de administración configurada y verificada contra la tienda real.
- [ ] La verificación es de solo lectura primero: se comprueba que se puede consultar un producto antes de intentar escribir nada.
- [ ] Los permisos incluyen creación de pedidos y lectura de productos, y **no más de lo necesario**.
- [ ] Las credenciales viven donde ya viven las demás, no en el código.
- [ ] Queda documentado qué permisos se pidieron, para replicarlo en Colombia sin adivinar.

**Reemplaza al ticket original de plantilla de Meta**, que dejó de existir: al compartir número venta y confirmación, el mensaje de confirmación cae en sesión abierta y ya no es plantilla.

## Answer

**Status: open.** La conexión sigue sin poder configurarse porque **no hay
credenciales**, y ningún agente las consigue: las trae Vorare. Medido hoy en
producción, `shopify_connection` sigue con **0 filas**, como debe ser.

Lo que sí quedó construido es **todo lo que rodea a esa credencial**, para que el
día que llegue sea pegarla y verla funcionar en vez de descubrir a las tres
semanas que estaba corta.

### Lo que se construyó

**La verificación al conectar ahora lee de verdad, y solo lee.** Antes, guardar la
conexión solo comprobaba que la tienda contestara su nombre. Ahora, al guardar, el
sistema pregunta además **qué permisos concede el token** y **lee un producto**.
Ninguna de las tres cosas escribe nada. Si el token está corto, se ve en el
momento, en la misma pantalla, en vez de fallar semanas después en medio de una
venta con el cliente ya despedido creyendo que compró.

**La pantalla dice qué habilita el token, permiso por permiso**, y qué se pierde
por cada uno que falte. No dice «faltan permisos»: dice «sin este, una venta
cerrada no aterriza en la tienda».

**También muestra los permisos de más.** No bloquean nada, pero verlos es lo que
hace comprobable el «no más de lo necesario»: sirve para descubrir que se pegó el
token de otra app o que se marcó de más en la pantalla de Shopify.

**La pantalla de «tienda no conectada» dejó de ser un formulario vacío.** Es el
estado que el usuario va a ver primero y por bastante tiempo, así que ahora
explica qué sigue funcionando (los pedidos que entran por la tienda, que van por
otro camino) y qué no (el vendedor conversa sin la ficha del producto, y una
venta cerrada no se convierte en pedido — queda guardada y el equipo recibe
alerta).

**Los permisos quedaron documentados** en `permisos-de-la-tienda.md`: los tres que
se piden, para qué sirve cada uno, los cinco que **no** se piden y por qué, y el
orden en que se enciende la escritura sin saltarse pasos. Es lo que se replica en
Colombia sin adivinar.

### Un hallazgo que hubiera mordido después

La lectura de productos **no traía el identificador de las variantes**, y la
tienda crea las líneas de un pedido por variante, no por producto. Es decir: con
lo que había, ninguna venta habría podido armar ni una línea de pedido, y no se
habría notado hasta tener las credenciales. Ya está corregido.

### Qué falta, y de quién depende

Todo lo que falta depende de **Vorare, no del código**:

- [ ] El token de administración de la tienda de Guatemala.
- [ ] Guardarlo en el panel (Conexión → Shopify) y revisar el informe de permisos
      que sale al guardar.
- [ ] Con el modo seco puesto, cerrar una venta de prueba y revisar el log.
- [ ] Encender la escritura y crear **un pedido desechable**; revisarlo en la
      tienda; borrarlo.

Los cuatro pasos, con su detalle, están en `permisos-de-la-tienda.md`.
