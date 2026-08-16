# Criterios de aceptación del alcance

Type: grilling
Status: resolved
Blocked by: 02, 03, 04

## Question

El documento compromete alcance cerrado a precio fijo. La pregunta que evita el pleito es: ¿qué significa exactamente "entregado" para cada pieza del PRD?

Recorrer el alcance y fijar, para cada parte, la condición observable que la da por terminada. Por ejemplo: ¿"reconoce el producto" es que acierte siempre, o que acierte cuando el ID está registrado y pregunte cuando no? ¿"crea la orden en Shopify" incluye variantes y cantidades, o solo el producto simple?

Depende de las tres decisiones de alcance abiertas: no se puede fijar el criterio de terminación de algo cuyo mecanismo aún no está elegido.

## Answer

**Todos los criterios son condiciones observables de comportamiento. Ninguno es una métrica de resultado.**

| Pieza | Entregada cuando |
|---|---|
| Número de ventas | Un mensaje al número de ventas entra al panel y Sebastián responde, sin tocar el flujo de Katherine |
| Reconocimiento de producto | Con anuncio registrado identifica sin preguntar; sin registrar pregunta con lista corta; tras 2 intentos sin resolver, escala a humano |
| Conversación con apoyos | Envía las imágenes y videos marcados como enviables del producto identificado |
| Captura de datos | Los seis requeridos capturados y validados: teléfono con formato, ciudad y departamento contra lista de Colombia, dirección **o** reclame-en-oficina pero nunca ambos |
| Orden en Shopify | Se crea con line items, cliente, dirección o tag `reclame_oficina`, `financial_status: pending` y tags. **Idempotente**: dos cierres no crean dos órdenes |
| Handoff | La orden dispara el pipeline existente y a los 10 minutos sale la plantilla de ventas desde el número de confirmación |
| Panel · persona | Vorare edita nombre, mensajes base, límite de descuento y tono, y aplica en la siguiente conversación |
| Panel · catálogo | Vorare conecta un producto de Shopify o crea uno nativo, le cuelga IDs de anuncio y marca assets enviables |
| Takeover | El asesor ve los chats de Sebastián, toma el chat (Sebastián se pausa) y lo devuelve |

### Sin métricas de resultado

El documento **no compromete** tasa de cierre, porcentaje de reconocimiento correcto ni tiempo de respuesta. Compromete comportamiento.

El razonamiento: comprometer tasa de cierre a precio fijo es absorber el riesgo comercial de Vorare. Si su producto no vende, o su anuncio trae leads malos, el incumplido termina siendo WaiChat por algo que no controla.

### El fallo de Shopify entra en v1

La cola de reintentos y la alerta del PRD §8 son **alcance**, no mejor esfuerzo. Sin eso una venta cerrada se pierde en silencio, y eso no es una funcionalidad faltante: es un defecto. Es además lo que hace creíble el resto del documento.

### Sin ventana formal de aceptación

No hay periodo de revisión ni acta de recibido por fase. La relación con Vorare no lo necesita y la formalidad agregaría fricción sin comprarle nada a nadie. El cobro sigue arrancando **desde producción**, que es un hecho observable y no requiere firma.
