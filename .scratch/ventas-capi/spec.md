# Spec · CAPI — devolverle las ventas a Meta

Status: ready-for-agent

Origen: conversación del 16-ago-2026 · verificado contra la Graph API v21.0 con credenciales reales

## Problem Statement

Vorare paga por cada clic. Todo lo demás que construimos mejora **qué tan bien se le vende a quien llega**; nada mejora **quién llega**.

Hoy Meta no sabe qué pasa después del clic. Ve que alguien abrió una conversación de WhatsApp y ahí se le acaba la información: no sabe si esa persona compró, si compró caro, ni si el anuncio que la trajo produce compradores o curiosos. Sin ese dato, su algoritmo optimiza hacia lo único que puede medir —conversaciones iniciadas— y una conversación iniciada no paga la pauta.

El resultado es que Vorare paga por tráfico que Meta eligió con información incompleta, y no hay forma de que mejore con el tiempo.

## Solution

Cuando Sebastián cierra una venta, el sistema le devuelve a Meta el evento de compra, **atado al clic que la originó**. Meta aprende qué anuncio produce compradores y empieza a buscar más gente parecida.

El dato que lo hace posible **ya llega**: el identificador de clic viene junto con la referencia del anuncio en el primer mensaje. Se persiste en el primer contacto —igual que la atribución de producto— y se usa al cerrar.

Cada operación reporta a su propio píxel: Guatemala al suyo, Colombia al que se cree.

## User Stories

1. Como dueño de Vorare, quiero que Meta sepa qué pauta produjo ventas, para que me traiga más compradores y menos curiosos.
2. Como dueño de Vorare, quiero que Meta sepa **cuánto** vendió cada pauta, no solo que vendió, para que optimice hacia el ticket alto.
3. Como dueño de Vorare, quiero ver en el administrador de anuncios qué campaña genera ventas reales, para decidir dónde subo presupuesto.
4. Como dueño de Vorare, quiero que cada país reporte a su propio píxel, para no mezclar el aprendizaje de dos mercados distintos.
5. Como dueño de Vorare, quiero que una venta no se reporte dos veces, para no inflar mis propias métricas y tomar malas decisiones.
6. Como dueño de Vorare, quiero que si el reporte a Meta falla, mi venta siga estando bien creada, porque lo primero es el pedido.
7. Como admin, quiero saber si el reporte a Meta está funcionando, para no descubrir en un mes que no se envió nada.
8. Como operador del sistema, quiero que reportar a Meta nunca demore ni bloquee la conversación con el cliente.

## Implementation Decisions

**El identificador de clic se persiste en el primer contacto.** Viaja en el mismo objeto que la referencia del anuncio, y como esa referencia solo llega en el primer mensaje, guardarlo ahí es la única oportunidad. Se guarda junto a la atribución de producto, en la misma operación.

**El evento se envía al cerrar, no antes.** El evento que importa es la compra. Reportar la conversación iniciada no agrega nada: Meta ya la ve.

**El envío es asíncrono y no bloquea nada.** Reportar a Meta ocurre después de que el pedido está creado y confirmado al cliente. Un fallo de la API de Meta **no puede** afectar la venta ni la conversación.

**Deduplicación por identificador de evento.** Se deriva del pedido, no del momento, de modo que un reintento no cuente dos veces. Es el mismo criterio que la idempotencia de la orden, por la misma razón.

**Un píxel por operación.** Guatemala ya tiene el suyo, verificado como disponible y con uso publicitario habilitado. Colombia necesitará el propio. El píxel se resuelve desde la operación, nunca desde una constante.

**El evento lleva el valor y la moneda de la operación** — quetzales en Guatemala, pesos en Colombia. Sin esto Meta optimiza hacia cantidad de ventas en vez de hacia ingreso, que no es lo mismo cuando el catálogo tiene combos.

**Token de sistema para CAPI, no el de usuario.** Advertido explícitamente por quien administra la cuenta: el token de usuario de sistema sirve para CAPI y lectura, pero **no** para crear anuncios; el de usuario sí crea anuncios. Se usa el de sistema para esto, que además es el que corresponde a un proceso automático sin persona detrás.

**Cola de reintentos propia.** Un evento que no se pudo enviar se reintenta; agotados los reintentos se registra y se sigue. Nunca escala a un humano: es telemetría, no una venta.

## Testing Decisions

Un buen test aquí verifica **qué evento se construye**, no que Meta lo haya recibido. Llamar a la API de Meta en un test lo vuelve lento y frágil.

**Módulo probado:** el constructor del evento de conversión — función pura que recibe el pedido, la atribución persistida y la operación, y devuelve el evento listo para enviar.

**Casos que deben quedar cubiertos:** pedido con identificador de clic presente; pedido sin identificador, que **no debe generar evento** en vez de generar uno anónimo; moneda y valor tomados de la operación; identificador de evento estable entre dos construcciones del mismo pedido; y píxel resuelto desde la operación y no desde una constante.

**Verificación manual, una vez:** enviar un evento de prueba con el código de prueba de Meta y confirmarlo en el administrador de eventos, antes de habilitar el envío real.

**Prior art:** el constructor de orden del spec de cierre resuelve un problema idéntico —función pura que arma un payload externo con llave de idempotencia— y este debe parecerse a él.

## Out of Scope

- **Crear o modificar campañas y anuncios** desde el sistema. El token lo permite; este spec no lo usa.
- Reportar eventos distintos de la compra.
- Atribución de ventas que no vinieron de un anuncio. Sin identificador de clic no hay nada que reportar.
- Reportería propia de rendimiento de pauta. Los datos quedan en Meta y se leen ahí.
- Conectar la app a cuentas publicitarias de terceros — ver notas.

## Further Notes

**Verificado con credenciales reales el 16-ago-2026.** El píxel de Guatemala existe, está disponible y tiene uso publicitario habilitado. La cuenta publicitaria está activa.

**Pero falta un permiso, y es bloqueante.** El token trae `ads_management`, `ads_read`, `business_management`, `whatsapp_business_management` y `whatsapp_business_messaging` — **no trae `whatsapp_business_manage_events`**, que es el que Meta exige específicamente para reportar conversiones de anuncios de clic a WhatsApp. Hay que solicitarlo antes de que este spec sea implementable.

**Y hay una urgencia que reordena el proyecto:** no existe ningún endpoint para recuperar el identificador de clic después del hecho. Si no se captura en el webhook, se pierde para siempre. **Cada peso de pauta que corra antes de que la captura funcione es atribución que no se recupera** — así que la captura va antes que la inversión en anuncios, no en paralelo.

**Detalle contable que conviene mirar aparte:** la cuenta publicitaria opera en **pesos colombianos con zona horaria de Bogotá**, mientras los pedidos se cobran en **quetzales**. Se pauta en una moneda y se factura en otra. No afecta a CAPI —el evento lleva la moneda de la operación— pero sí afecta cualquier cálculo de retorno sobre la pauta.

**La forma exacta del evento hay que confirmarla contra la documentación vigente de Meta** antes de implementar: el flujo de conversiones para anuncios de clic a WhatsApp tiene su propio origen de acción y su propia forma de pasar el identificador de clic, y cambia entre versiones de la API.

**Decisión comercial tomada:** entra al alcance y **no se cotiza aparte**. Queda registrado que se señaló que era la única pieza cuya naturaleza —eficiencia de pauta, no automatización de conversación— justificaba revisar el precio, y que el usuario decidió incluirla.
