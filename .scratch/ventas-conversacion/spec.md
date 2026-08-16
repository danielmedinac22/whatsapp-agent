# Spec · Sebastián, la conversación de venta

Status: ready-for-agent

Origen: [PRD Panel de Ventas §9, §10](../panel-de-ventas/prd.html) · decisiones en [el mapa](../panel-de-ventas/map.md)

## Problem Statement

Una vez que el sistema sabe de qué producto le escriben, alguien tiene que **vender**. Hoy el único agente del sistema es Katherine, y su trabajo es lo contrario: confirmar un pedido que ya existe, con un tono de servicio y un objetivo de verificación.

El agente actual además está construido como si fuera el único: su configuración vive en una fila única con un solo prompt y un solo modelo. No hay forma de tener un segundo agente con otra personalidad, otro objetivo y otras reglas.

Y hay una parte que no es de tono sino de plata: un vendedor tiene que poder negociar, pero un modelo de lenguaje al que se le dice "puedes dar hasta 10%" termina dando 20% ante un cliente insistente. Sin un mecanismo real, cada descuento es una fuga.

## Solution

**Sebastián**: un segundo agente, con su propia configuración, que atiende el número de ventas.

Su persona se configura de forma **híbrida** — estructurado lo que tiene consecuencia, libre lo que es tono:

- **Estructurado**: nombre visible, mensajes base (saludo, empuje al cierre, mensaje de embudo) y límite de descuento.
- **Libre**: un campo de instrucciones de personalidad y tono.

Conversa con el contexto del producto identificado cargado —descripción, especificaciones y los archivos que el admin marcó como enviables— y puede mandar esas imágenes y videos durante la charla.

El **límite de descuento se aplica en código**, no en el prompt. El prompt propone; la validación decide. El valor sale del panel, incluido cero, pero la validación siempre corre.

Escala a un asesor ante descuento fuera de rango, dos intentos sin identificar producto, petición fuera de reglas, objeción repetida o palabra clave.

## User Stories

1. Como lead, quiero que quien me atienda sepa del producto que vi, para resolver mis dudas sin esperas.
2. Como lead, quiero ver fotos y videos del producto en el chat, para decidir con más confianza.
3. Como lead, quiero que me respondan rápido, para no perder el interés mientras espero.
4. Como lead, quiero que quien me atiende tenga un nombre y un trato consistente, para sentir que hablo con alguien.
5. Como lead con una objeción, quiero que me la resuelvan en vez de repetirme el argumento de venta, para sentirme escuchado.
6. Como lead que pide hablar con una persona, quiero que me pasen con una, sin insistencia.
7. Como admin, quiero ponerle nombre y personalidad al vendedor, para que hable como mi marca.
8. Como admin, quiero editar el saludo, el empuje al cierre y el mensaje de embudo, para controlar los momentos que más importan.
9. Como admin, quiero definir hasta qué descuento puede llegar el vendedor, para no perder margen sin darme cuenta.
10. Como admin, quiero poder poner el límite en cero, para prohibir descuentos del todo.
11. Como admin, quiero que el límite se cumpla de verdad y no dependa de que el modelo obedezca, para que sea un límite y no una sugerencia.
12. Como admin, quiero elegir qué archivos de cada producto puede enviar el vendedor, para que no mande material interno o desactualizado.
13. Como admin, quiero que mis cambios de configuración apliquen en la siguiente conversación, sin desplegar nada.
14. Como asesor, quiero que me escalen los chats donde el cliente pidió algo fuera de las reglas, para atenderlos yo.
15. Como asesor, quiero que me escalen cuando el vendedor pactó un descuento fuera de rango, para decidir qué hacer con ese cliente.
16. Como operador del sistema, quiero que Katherine siga funcionando exactamente igual mientras Sebastián existe, para no arriesgar la postventa.
17. Como dueño de Vorare, quiero que el vendedor no prometa tiempos de entrega ni garantías que yo no ofrezco, para no generar reclamos.

## Implementation Decisions

**Un solo vendedor, no varios.** Tres productos concentran el 96% del volumen; varias personas serían UI, tablas y confusión para un problema que el cliente no tiene. Si hiciera falta, es trabajo posterior.

**Configuración propia del vendedor, en una tabla hermana. No se generaliza la existente.**

Medido antes de decidir: la tabla de configuración del agente tiene **65 referencias en 15 archivos**, y la mayoría son campos de Katherine — plantillas de Dropi, demoras de seguimiento, acuse de confirmación. No es "configuración de agente": es la configuración de Katherine con un nombre genérico.

Generalizarla a multi-fila obligaría a un expand–contract sobre esos 65 call sites para que el vendedor use una fracción de las columnas. En su lugar, el vendedor recibe **su propio registro de configuración**, con solo los campos que le importan: nombre visible, mensajes base, límite de descuento, instrucciones de tono, modelo y esfuerzo de razonamiento. Radio de impacto sobre lo existente: cero.

El punto donde ambos agentes se encuentran es el **constructor de prompt efectivo**, que recibe la identidad y resuelve de dónde leer. Ese es el único lugar que aprende que hay más de un agente.

**El constructor de prompt efectivo recibe la identidad del agente.** La función que hoy arma el system prompt efectivo se extiende para saber qué agente está armando. Katherine y Sebastián salen del mismo punto; no se duplica el camino. Es el seam más alto disponible y evita un segundo runner.

**Contexto de producto inyectado como bloque.** El contexto del producto identificado se arma como bloque de texto y se compone en el prompt efectivo, igual que ya se hace con el contexto de Shopify y el de Dropi. Incluye descripción, especificaciones y la lista de archivos enviables.

**El descuento es regla dura con valor configurable.** El límite se valida en código en el momento de construir la orden, no en la conversación. El prompt puede mencionar el límite para que Sebastián negocie con criterio, pero la decisión final no depende de él. Fuera de rango, la orden se crea al precio válido y el caso escala. La validación no se puede desactivar; solo se puede cambiar su valor, incluido cero.

**Modelo y esfuerzo de razonamiento.** Sebastián corre con un modelo de gama media y esfuerzo de razonamiento bajo. La razón del esfuerzo bajo es doble: persuadir no es una tarea de razonamiento, y el esfuerzo alto agrega segundos de latencia que en una conversación de WhatsApp cuestan más ventas que cualquier mejora de redacción. El modelo es un campo por agente, así que subirlo después es cambiar un valor.

**Escalamiento.** El módulo de escalamiento existente suma los triggers nuevos: descuento fuera de rango, dos intentos sin identificar producto, objeción repetida y palabras clave de petición de humano.

**Envío de archivos.** Solo se envían archivos marcados como enviables para el producto identificado. Los videos deben respetar el límite de tamaño de la API de WhatsApp; los que no lo cumplan no se envían y no rompen la conversación.

## Testing Decisions

Un buen test aquí verifica **qué queda en el prompt efectivo y qué decide el escalamiento**, dado un estado de conversación. No se prueba el texto que genera el modelo — eso no es determinista ni es comportamiento del sistema.

**Módulos probados:**

- El constructor de prompt efectivo, verificando que para cada agente compone la persona, los mensajes base y el contexto de producto correctos, y que la configuración de un agente nunca se filtra al otro.
- El módulo de escalamiento, con los triggers nuevos.

**Casos que deben quedar cubiertos:** prompt de Sebastián con producto identificado; prompt de Sebastián sin producto aún; prompt de Katherine sin contaminarse con configuración de ventas; escalamiento por cada trigger; y no escalar cuando la conversación avanza normal.

**Prior art:** `dropi/normalize.test.ts` y `kapso/inbound.test.ts` — vitest, entradas armadas a mano, aserciones sobre la salida, nombres en español que enuncian el comportamiento esperado.

El clamp del descuento **no se prueba aquí**: vive en el constructor de orden, en el spec de cierre, que es donde se aplica.

## Out of Scope

- La captura de datos de cierre y la creación de la orden — spec de cierre.
- El reconocimiento de producto — spec de ingesta.
- La UI de configuración del vendedor — spec del Panel de Ventas.
- Prompt caching. Con el modelo elegido el ahorro absoluto es de decenas de dólares al mes y el soporte no está documentado.
- Cualquier compromiso sobre tasa de cierre o calidad de venta. El sistema promete comportamiento, no resultado.

## Further Notes

El prompt de producción actual tiene cerca de dos mil tokens y se re-paga en cada turno, porque no hay prompt caching. El de ventas probablemente sea más grande, ya que carga contexto de producto. Vale medirlo cuando exista: si crece mucho, el costo por conversación se mueve y la tabla de costos del documento comercial deja de ser válida.

Si Sebastián cierra mal, **el primer sospechoso es el modelo, no el prompt**. Subirlo de gama es cambiar un campo, y la diferencia de costo es marginal frente a una venta perdida.
