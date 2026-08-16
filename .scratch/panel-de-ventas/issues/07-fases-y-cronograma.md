# Fases y cronograma del documento

Type: grilling
Status: resolved
Blocked by: 06

## Question

Se acordó entregar por fases, con fecha por fase en vez de una fecha única. ¿Cuáles son las fases y qué entra en cada una?

Corte sugerido, a discutir: (1) número de ventas conectado y Sebastián conversando con contexto de producto; (2) captura de datos de cierre y creación de la orden en Shopify; (3) panel de configuración, catálogo y takeover.

Dos cosas que hay que meter en el cronograma y no son obvias:

- **La plantilla nueva de Katherine para pedidos de ventas necesita aprobación de Meta**, y esa aprobación no la controlamos. Va en camino crítico.
- **La vista de conversaciones de ventas** (PRD §10) puede ser pantalla nueva o pestaña filtrada del inbox existente. La diferencia de esfuerzo es grande y cae entera dentro de una fase — decidirlo al estimar.

Fijar también desde cuándo corre el cobro: se acordó cobrar desde producción — ¿desde la fase 1 en producción, o desde la última?

Depende de los criterios de aceptación: una fase sin criterio de terminación no es una fase, es una fecha.

## Answer

**Tres fases, ~7 semanas, cobro desde la Fase 2 en producción.**

El corte sugerido en la pregunta se movió: el **catálogo pasa a la Fase 1**, porque el reconocimiento de producto depende de que existan productos con IDs de anuncio. Sin eso la Fase 1 no es demostrable.

| Fase | Contenido | Estimado |
|---|---|---|
| **1 · Cimientos y conversación** | Número de ventas conectado · catálogo de productos con IDs de anuncio y assets enviables · reconocimiento de producto · Sebastián conversando con apoyos visuales | Semana 1 |
| **2 · Cierre y entrega a confirmaciones** | Captura y validación de datos · orden en Shopify idempotente con cola de reintentos y alerta · handoff con la plantilla nueva de Katherine | Semana 2 |
| **3 · Operación y control** | Configuración de la persona (nombre, mensajes base, límite de descuento, tono) · vista de conversaciones de ventas con takeover | Semana 2 |

**Cronograma comprimido a 2 semanas por decisión del usuario (16-ago-2026)**, desde el estimado inicial de ~7. Las tres fases se mantienen; las dos últimas comparten la semana 2.

Riesgo declarado y aceptado: **la aprobación de la plantilla de Meta cae dentro de la semana 2** y no la controlamos. El supuesto que lo cubre ya está publicado en el documento, pero con este cronograma pesa mucho más que con el original.

### El momento del cobro no va en el documento

**Revertido el 16-ago-2026.** Se había decidido cobrar desde la Fase 2 en producción, con este razonamiento: la Fase 1 sola es un chatbot que conversa pero no vende, y esperar a la Fase 3 regala el núcleo funcionando.

Ese razonamiento sigue en pie como argumento, pero **el documento ya no dice nada sobre cuándo arranca el cobro**: se cobra para iniciar y el momento se negocia por fuera. Se quitaron las tres menciones — el campo de la ficha, la marca en la Fase 2 y la nota de la sección de inversión.

Queda un punto por confirmar: el documento sigue afirmando *"no hay cobro de implementación ni cuota de entrada"*. Compatible con cobrar el primer mes por adelantado; **incompatible con un cobro de arranque aparte**.

### Advertencias sobre el estimado

- **Las semanas son estimación propia y hay que contrastarlas con la capacidad real.** No salen de una planeación con el equipo.
- **La aprobación de la plantilla de Meta no la controlamos** y está en camino crítico de la Fase 2.
- **La Fase 1 no puede arrancar sin el número de ventas**, que provee Vorare.
- **La vista de conversaciones de ventas** puede resolverse como pestaña filtrada del inbox existente en vez de pantalla nueva. Esa decisión cae dentro de la Fase 3 y puede moverle una semana.
