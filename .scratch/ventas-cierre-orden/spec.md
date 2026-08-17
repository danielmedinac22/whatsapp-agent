# Spec · Cierre, orden en Shopify y handoff a confirmación

Status: ready-for-agent

Origen: [PRD Panel de Ventas §6, §7, §8](../panel-de-ventas/prd.html) · decisiones en [el mapa](../panel-de-ventas/map.md)

## Problem Statement

Una venta que se cierra en la conversación pero no aterriza en Shopify no es una venta: es un chat. Hoy no existe ningún camino automático de conversación a pedido — el sistema solo **lee** de Shopify, nunca escribe.

Tres cosas hacen esto delicado en contraentrega:

- **Los datos mal capturados se pagan en devoluciones.** Una dirección incompleta o una ciudad que no existe se convierte en un envío fallido semanas después, con el costo ya incurrido.
- **Una orden duplicada es plata perdida.** Si el cierre se dispara dos veces, salen dos envíos contraentrega del mismo producto al mismo cliente.
- **Una orden que falla en silencio es peor que no vender.** El cliente ya se despidió creyendo que compró; si Shopify rechaza la creación y nadie se entera, el pedido no existe y nadie lo reclama hasta que el cliente escribe molesto.

Y al final del cierre hay una costura: el cliente acaba de comprarle a Sebastián, y minutos después alguien le pide que confirme el pedido que acaba de hacer. **Desde el 16-ago-2026 eso ocurre en el mismo hilo y el mismo número**, lo que lo hace menos extraño para el cliente pero exige que el sistema sepa quién de los dos agentes está hablando.

## Solution

Cuando la conversación llega al cierre, Sebastián **captura los datos y los valida en el momento**, no después. Con los datos válidos, construye y crea la orden en Shopify con pago contraentrega.

La creación es **idempotente**: dos disparos del mismo cierre producen una sola orden. Si Shopify falla, el pedido entra a una **cola de reintentos** y el equipo recibe una alerta — una venta cerrada nunca se pierde en silencio.

El **descuento se valida aquí**, en el mismo punto donde se construye la orden. Fuera del límite configurado, la orden se crea al precio válido y el caso escala a un asesor.

El **handoff no necesita camino nuevo**: la orden creada dispara el webhook de la tienda que el pipeline de confirmación ya consume. Los pedidos originados en ventas salen a los **diez minutos** en vez de cinco, con un mensaje que reconoce la compra y se enfoca en verificar la dirección.

**Ese mensaje no es plantilla, cuando puede no serlo.** Como venta y confirmación comparten número y el cliente acaba de escribir, la ventana de veinticuatro horas suele estar abierta y el mensaje sale como texto libre. No hace falta aprobar ninguna plantilla nueva.

**Los pedidos que no vienen de Sebastián conservan el flujo de hoy, intacto.** Alguien que compra directo en la tienda puede no haber escrito nunca al número, así que su ventana está cerrada y su primer toque **es plantilla**, con la demora actual — exactamente como funciona hoy. Y el seguimiento posterior de guía, recolección, tránsito, mensajero y entrega **sigue siendo plantilla para ambos orígenes**, porque cae fuera de ventana. Todas esas ya existen y no cambian.

## User Stories

1. Como lead que decide comprar, quiero dar mis datos en la misma conversación, sin llenar formularios ni salir de WhatsApp.
2. Como lead, quiero que me avisen en el momento si mi teléfono o mi ciudad quedaron mal, para corregirlo ahí mismo.
3. Como lead que prefiere recoger, quiero poder decir que reclamo en oficina en vez de dar dirección.
4. Como lead, quiero que me confirmen que mi pedido quedó registrado, para quedarme tranquilo.
5. Como lead, quiero saber que me van a contactar de confirmaciones, para no sorprenderme cuando me escriba otro número.
6. Como lead que ya compró, quiero que el mensaje de confirmación reconozca que acabo de comprar, en vez de preguntarme si quiero comprar, para no sentir que nadie se enteró.
7. Como lead, quiero que mi pedido no se duplique si el sistema se confunde, para no recibir dos envíos que tendría que pagar.
8. Como dueño de Vorare, quiero que las ventas del agente lleguen a Shopify como cualquier otro pedido, para no cambiar mi operación.
9. Como dueño de Vorare, quiero que los pedidos del agente estén etiquetados, para distinguirlos en mis reportes.
10. Como dueño de Vorare, quiero que un pedido nunca se pierda porque Shopify falló, porque esa venta ya está pagada en publicidad.
11. Como dueño de Vorare, quiero que ningún pedido se cree con un descuento mayor al que autoricé, para proteger mi margen.
12. Como dueño de Vorare, quiero que la dirección se verifique antes del despacho, para reducir devoluciones.
13. Como asesor, quiero recibir alerta cuando un pedido no se pudo crear, para resolverlo antes de que el cliente reclame.
14. Como asesor, quiero recibir el caso cuando se pactó un descuento fuera de rango, para decidir si lo honramos.
15. Como equipo de confirmaciones, quiero que los pedidos de ventas entren a mi flujo igual que los demás, para no aprender un proceso nuevo.
16. Como operador del sistema, quiero que el pedido llegue con los datos completos, para que la guía se genere sin intervención.

## Implementation Decisions

**Un único constructor de orden.** Validación de datos, mapeo al payload de Shopify, clamp del descuento y derivación de la llave de idempotencia viven en **una sola función pura** que recibe los datos crudos del cierre más la configuración vigente, y devuelve o un payload listo, o el conjunto de errores de validación. Partirlo en varias funciones daría varios seams para una sola decisión.

**Datos de cierre.** Requeridos: nombre, apellido, teléfono, ciudad, departamento, y dirección **o** reclamo en oficina. Opcional: correo. Derivados de la conversación: producto y variante, cantidad, valor y método de pago, siempre contraentrega.

**Validaciones, parametrizadas por operación.** Teléfono en formato válido para el país de la operación. Ciudad y división administrativa **contra la lista del país de la operación** — no contra una lista fija. Corregido el 16-ago-2026: el PRD original decía Colombia, pero la operación viva es Guatemala y la lista tiene que salir de la operación. Dirección y reclamo en oficina son **mutuamente excluyentes**: que coexistan es un error de validación, no una preferencia.

**Moneda por operación.** El pedido se crea en la moneda de su operación: quetzales en Guatemala, pesos en Colombia. No hay moneda por defecto.

**La tienda destino es la de la operación.** Un pedido de una operación nunca se crea en la tienda de otra. Es el error más caro que este módulo puede cometer, porque produce un despacho al país equivocado.

**Forma de la orden.** Líneas con producto, variante y cantidad. Cliente con nombre, apellido, teléfono y correo si existe. Dirección de envío, o la etiqueta de reclamo en oficina cuando aplique. Estado financiero pendiente, por contraentrega. Etiquetas que identifican el origen de ventas y el nombre del vendedor.

**Idempotencia por referencia del lead.** La llave se deriva del lead, no del momento ni de un aleatorio, de modo que dos disparos del mismo cierre colisionen y produzcan una sola orden.

**Clamp del descuento.** El límite configurado se aplica al construir el payload. Si el valor pactado lo excede, el payload sale al precio válido y el resultado señala que hubo clamp, para que el orquestador escale. Es el punto donde la regla se vuelve real.

**Cola de reintentos y alerta.** Un fallo de Shopify no descarta la venta: el cierre entra a una cola con reintentos y se emite alerta al equipo. Esto es alcance, no mejor esfuerzo — sin ello una venta cerrada se pierde en silencio, y eso es defecto.

**El handoff reutiliza el pipeline existente.** El receptor del webhook de Shopify ya valida firma, hace inserción idempotente por identificador de orden y agenda seguimiento y remarketing. La orden creada por Sebastián entra por ahí sin código nuevo.

**Plan de seguimiento: el origen decide el contenido, la ventana decide el mecanismo.** Una **función pura** recibe el pedido y el estado de la ventana de conversación, y devuelve qué mensaje, con qué mecanismo y con qué demora.

- **Origen ventas** → contenido que reconoce la compra, demora de diez minutos.
- **Origen directo** → contenido y demora actuales, sin cambio alguno.
- **Ventana abierta** → texto libre. **Ventana cerrada** → plantilla.

Separar las dos dimensiones importa por un borde real: si un pedido de ventas se atrasa en la cola de reintentos más de veinticuatro horas, su ventana también se cierra. Atar el mecanismo al origen haría que ese mensaje se intentara enviar como texto libre y **fallara en silencio**, justo en el caso donde ya hubo un problema. **La plantilla es el camino seguro y siempre debe existir como respaldo**, incluso para pedidos de ventas.

Hoy la demora es un campo único en la configuración; deja de serlo o se resuelve por origen.

**Mensaje de confirmación en sesión, no plantilla.** Al compartir número, el primer toque cae **dentro** de la ventana de veinticuatro horas y es texto libre. No se salta la confirmación: es donde se valida la dirección, y en contraentrega ahí es donde se caen las entregas.

## Testing Decisions

Un buen test aquí verifica **qué payload sale y qué errores salen**, dada una entrada. No se prueba que se haya llamado a Shopify — eso es implementación y además requiere red.

**Módulos probados:**

- El constructor de orden, que concentra toda la decisión.
- El resolutor del plan de seguimiento.

**Casos que deben quedar cubiertos en el constructor de orden:** datos completos con dirección; datos completos con reclamo en oficina; dirección y reclamo en oficina coexistiendo, que debe fallar; teléfono inválido para el país de la operación; ciudad o división administrativa fuera de la lista **del país de la operación**; una dirección válida en un país que debe fallar contra la lista del otro; moneda tomada de la operación; campo requerido faltante; descuento dentro del límite; **descuento por encima del límite, que debe salir clampeado y señalado**; límite en cero con descuento pactado; y dos construcciones del mismo cierre produciendo la misma llave de idempotencia.

**Casos del plan de seguimiento:** orden con etiqueta de ventas, que debe dar la plantilla nueva y diez minutos; orden sin la etiqueta, que debe conservar el comportamiento actual.

**Prior art:** `dropi/normalize.test.ts` y `dropi/movements.test.ts` prueban transformaciones puras con entradas construidas a mano; `kapso/inbound.test.ts` hace lo mismo con payloads. Mismo estilo: vitest, fixtures inline, nombres en español.

La creación real contra Shopify y el comportamiento de la cola de reintentos no se prueban con tests unitarios, en línea con la convención del repo de no probar orquestación con efectos.

## Out of Scope

- **Creación automática de la guía en Dropi.** El worker hoy solo lista y confirma pedidos de Dropi, nunca los crea. La guía nace de una integración Shopify↔Dropi ajena a este sistema y sigue igual.
- Pagos en línea. El modelo es contraentrega.
- Unificar ventas y confirmación en un mismo número visible.
- La conversación que lleva al cierre — spec de conversación.
- Cambios al flujo de confirmación más allá de la plantilla y la demora.

## Further Notes

**Ya no hay aprobación de Meta en camino crítico.** Al decidirse un número por operación, el mensaje de confirmación cae en sesión abierta y deja de ser plantilla. Era el único elemento del proyecto con espera externa que no controlábamos.

**Prerequisito que sigue sin dueño:** la conexión a la API de administración de la tienda **está vacía**. Los pedidos entran por webhook con un secreto de entorno, pero crearlos necesita esa conexión configurada, y hace falta una por operación.

La tasa de confirmación actual del flujo de Katherine es del 88,4% sobre 1.640 pedidos. Es la línea base contra la cual se puede comparar el comportamiento de los pedidos originados en ventas, si alguna vez se quiere medir si la plantilla nueva funciona mejor o peor.
