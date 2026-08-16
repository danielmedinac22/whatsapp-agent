# Spec · Ingesta de ventas y reconocimiento de producto

Status: ready-for-agent

Origen: [PRD Panel de Ventas §4, §5](../panel-de-ventas/prd.html) · decisiones en [el mapa](../panel-de-ventas/map.md)

## Problem Statement

Vorare paga anuncios de Meta que llevan gente directo a WhatsApp, pero hoy esos leads caen en el mismo número de postventa, donde el agente que los atiende está entrenado para confirmar pedidos, no para vender. Nadie los atiende como compradores potenciales.

Peor: aunque los atendiera, el agente no sabría **de qué producto le están escribiendo**. Un solo número recibe leads de muchos anuncios distintos, y el lead casi nunca dice qué vio — llega escribiendo "hola" o "info". Preguntar siempre es fricción justo en el momento más frágil de la conversación.

Y el catálogo hace el problema peor de lo que parece: cuatro de los productos de Vorare tienen nombres casi idénticos (la familia REVITALHAIR), y concentran el 77% del volumen. Adivinar por texto ahí es una moneda al aire sobre la mayoría de las ventas.

## Solution

Un **número de WhatsApp dedicado a ventas**, separado del de confirmación, cuyos mensajes entrantes traen la metadata del anuncio que los originó.

Cuando un lead entra, una **cascada fija de tres niveles** resuelve el producto:

1. Por **ID del anuncio**, contra el mapeo que el admin cargó en el panel. Un anuncio puede apuntar a varios productos.
2. Por **match semántico** del titular y cuerpo del anuncio contra el catálogo, solo si el ID no está registrado. Nunca desempata entre nombres parecidos: ante baja confianza, cede al nivel 3.
3. **Preguntando** al lead con una lista corta. Si el nivel 1 devolvió varios productos, la lista es la de ese anuncio, no el catálogo entero.

Tras dos intentos sin resolver, escala a un asesor.

La **atribución del lead a su anuncio se persiste en el primer contacto**, porque es el único mensaje que la trae.

## User Stories

1. Como lead que hace clic en un anuncio, quiero que me responda alguien que ya sabe qué producto vi, para no tener que explicar de qué se trata.
2. Como lead que hace clic en un anuncio de la familia REVITALHAIR, quiero que me pregunten cuál de las presentaciones me interesa, para no recibir información del producto equivocado.
3. Como lead que escribe sin venir de un anuncio, quiero que me pregunten qué busco con una lista corta, para llegar rápido a lo que necesito.
4. Como lead, quiero que si el agente no logra entender qué producto quiero, me pase con una persona, para no quedar atrapado en un bucle.
5. Como admin, quiero conectar un número de WhatsApp exclusivo para ventas, para que las conversaciones comerciales no se mezclen con las de confirmación.
6. Como admin, quiero asociar los IDs de mis anuncios a cada producto, para que el agente reconozca el producto sin preguntar.
7. Como admin, quiero poder asociar un mismo anuncio a varios productos, para que mis anuncios de familia o de combo funcionen sin crear productos falsos.
8. Como admin, quiero que el reconocimiento funcione aunque no haya registrado un anuncio nuevo todavía, para que lanzar una campaña no me obligue a tocar el panel antes.
9. Como admin, quiero que el agente prefiera preguntar antes que adivinar entre productos de nombre parecido, para no mandarle al cliente información del SKU equivocado.
10. Como asesor, quiero saber de qué anuncio vino cada lead, para entender el contexto cuando tomo el chat.
11. Como asesor, quiero recibir los chats donde el agente no logró identificar el producto, para destrabarlos yo.
12. Como dueño de Vorare, quiero saber qué anuncio originó cada venta, para decidir dónde pongo el presupuesto.
13. Como dueño de Vorare, quiero que la atribución sobreviva toda la conversación, para que un cliente que responde con botones no pierda su origen.
14. Como operador del sistema, quiero que el flujo de confirmación existente no se vea afectado por el número nuevo, para no arriesgar lo que ya funciona.

## Implementation Decisions

**Segunda conexión de WhatsApp.** La tabla de conexión de Kapso es hoy de fila única. Deja de serlo: el sistema debe sostener al menos dos conexiones con roles distintos —confirmación y ventas— y el ruteo de mensajes entrantes debe resolver a qué agente pertenece cada mensaje según la conexión por la que llegó. Es cambio de modelo de datos, no configuración.

**El parser de entrantes carga la metadata del anuncio.** La función que hoy normaliza el payload de Kapso a un mensaje entrante tipado se extiende para exponer el objeto de referencia CTWA cuando venga: identificador del anuncio, titular, cuerpo, URL de origen e identificador de clic. Es el punto más alto de la ingesta y ya tiene cobertura de tests.

**Reconocimiento como función pura con el matcher inyectado.** La cascada vive en una única función que recibe la referencia del anuncio, el catálogo y una función de match semántico, y devuelve un resultado de tres formas: resuelto a un producto, ambiguo con la lista de candidatos, o desconocido. El match semántico entra como dependencia para que la cascada completa sea determinista y probable sin llamar a un modelo.

**La relación anuncio→producto es N:M.** Un anuncio puede mapear a varios productos y un producto puede tener varios anuncios. No se introduce un concepto de "familia": la agrupación la expresa el mapeo. Los productos quedan uno a uno con Shopify, sin reestructurar el catálogo del cliente.

**El nivel semántico nunca desempata nombres parecidos.** Ante candidatos de similitud alta entre sí, el resultado es ambiguo, no una elección. El umbral es una constante del sistema, no un campo configurable.

**La cascada es fija.** No se puede reordenar, apagar niveles ni ajustar umbrales desde el panel. El admin configura únicamente el catálogo y el mapeo de anuncios.

**Atribución persistida en el primer contacto.** La referencia del anuncio solo llega en el primer mensaje de la conversación, nunca en respuestas de botón o lista. Se guarda asociada a la conversación de ventas en cuanto llega; el resto del sistema la lee de ahí, no del mensaje.

**Escalamiento tras dos intentos.** Si tras dos rondas de pregunta el producto sigue sin resolverse, la conversación se marca para asesor.

## Testing Decisions

Un buen test aquí describe **comportamiento observable de la cascada**, no cómo está implementada por dentro. Se prueba qué producto sale dado un mensaje entrante y un catálogo, nunca cuántas veces se llamó a qué.

**Módulos probados:**

- El parser de entrantes de Kapso, extendiendo su suite existente con payloads que traen y que no traen referencia de anuncio.
- La función de reconocimiento, con el matcher semántico stubeado.

**Casos que deben quedar cubiertos:** anuncio registrado con un producto; anuncio registrado con varios productos; anuncio no registrado que el matcher resuelve; anuncio no registrado que el matcher deja ambiguo; mensaje sin referencia alguna; referencia presente pero con catálogo vacío; y el caso REVITALHAIR real, con cuatro nombres casi idénticos, que debe dar ambiguo y no una elección.

**Prior art:** `kapso/inbound.test.ts` y `kapso/delivery.test.ts` prueban funciones puras de parseo con payloads de fixture; `dropi/normalize.test.ts` hace lo propio con normalización de estados. Mismo estilo: vitest, fixtures inline, nombres de test en español que enuncian el comportamiento.

La orquestación que toca base de datos no se prueba, en línea con la convención existente del repo.

## Out of Scope

- Auto-registro de IDs de anuncio desde la API de Meta Ads. Los carga el admin a mano.
- La UI para cargar productos y anuncios — vive en el spec del Panel de Ventas.
- La conversación de venta en sí — vive en su propio spec.
- Reportería de atribución. Se guarda el dato; explotarlo es otro trabajo.

## Further Notes

**Riesgo abierto que puede cambiar este spec.** Kapso documenta que entrega el objeto de referencia CTWA en el evento de mensaje recibido, pero la ruta exacta del campo no aparece en ninguna de sus specs, y se comprobó que su serializador recorta campos que Meta sí manda. Falta verificarlo con un anuncio activo y un clic real.

Si el campo se recorta, la salida es configurar el webhook en modo passthrough de Meta, con estas advertencias: el modo no se puede cambiar en un webhook existente, es uno por número, no hay buffering, y la firma HMAC en ese modo no está documentada. Ese cambio afectaría la ingesta, no la cascada — la función de reconocimiento no se entera.

Si el mecanismo no resultara viable del todo, el nivel 1 desaparece y la cascada arranca en el nivel 2. El módulo sigue funcionando con un paso más para el cliente.
