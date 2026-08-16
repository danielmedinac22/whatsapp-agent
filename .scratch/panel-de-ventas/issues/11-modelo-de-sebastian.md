# Modelo de Sebastián: calidad de venta vs costo variable

Type: grilling
Status: resolved
Blocked by: —

## Question

El agente corre hoy sobre `anthropic/claude-sonnet-4.6` ($3/$15 por millón de tokens). Como el costo variable lo paga Vorare, el modelo que elijamos es una cifra en la cotización, no un detalle interno.

La tensión: Sebastián es un **vendedor**. Su calidad conversacional es ingreso, no comodidad. Bajarlo a Haiku recorta ~67% el costo variable, pero un vendedor que cierra menos le sale carísimo a Vorare. El documento no puede recomendar lo barato por default.

Decidir tres cosas:

- **¿Sonnet o Haiku para Sebastián?** Y si es configurable, con qué recomendación explícita.
- **¿Se activa prompt caching antes de cotizar?** Hoy no está activo. El system prompt se re-paga en cada turno y es el 85–90% del costo variable; con caching baja 50–70% **sin tocar la calidad**. Esto no es un trade-off, es plata que se está botando — la pregunta real es si entra en el alcance cotizado o se hace aparte.
- **¿El documento fija el modelo o lo deja abierto?** Si lo deja abierto, la tabla de costos tiene que mostrar el rango de las dos opciones.

Alimenta la tabla de costos del artefacto. Ver el Anexo B de [`research/05-costos-variables.md`](../research/05-costos-variables.md): el modelo real en producción vive en `agent_settings` y no se pudo leer desde el repo — confirmarlo es parte de este ticket.

## Answer

**Sebastián corre sobre `openai/gpt-5.6-terra` con reasoning effort bajo.**

### La premisa del ticket estaba mal

El ticket asumía que el agente corría sobre `claude-sonnet-4.6`. Consultando `agent_settings` en producción, el modelo real es **`openai/gpt-5.4-mini`** — la investigación de costos había tomado el default del schema. Eso invalidó la pregunta original ("¿Sonnet o Haiku?") y también las cifras de costo, sobrestimadas ~4x.

### Comparación real (precios OpenRouter, 50% de descuento exclusivo ya aplicado)

| Modelo | Input /1M | Output /1M | vs. el actual |
|---|---|---|---|
| GPT-5.6 Luna | $0,10 | $0,60 | 7,5x más barato |
| `gpt-5.4-mini` (actual) | $0,75 | $4,50 | — |
| **GPT-5.6 Terra** | **$1,00** | **$6,00** | 1,33x más caro |

Ambos GPT-5.6 son de julio-2026, contexto 1M. Luna está descrita para *"chat, clasificación y flujos agénticos ligeros"*; Terra como *"modelo balanceado"* para *"razonamiento y tareas agénticas del día a día"*.

### Por qué Terra

Costo por lead: Luna ~$0,0023 · mini ~$0,017 · **Terra ~$0,023**. A 2.000 leads/mes la prima de Terra sobre Luna es **~$130.000 COP** — literalmente **una venta extra al mes**, con pedidos de decenas de miles de pesos cada uno.

En un agente cuyo output es ingreso, errar del lado caro cuesta una cifra visible y pequeña; errar del lado barato cuesta ventas que nadie ve perderse. Se elige el lado caro.

### Reasoning effort: bajo, no medio

Se descartó `medium`. Dos razones:

- **Persuadir no es razonar.** El modelo no tiene que deducir nada; tiene que conversar bien. El effort alto no compra calidad en esa tarea.
- **Latencia.** `medium` agrega segundos, y en una conversación de WhatsApp con un lead que acaba de hacer clic en un anuncio, esperar 15 segundos cuesta más ventas que cualquier mejora de fraseo.

Si algún día se prueba `medium`, que sea midiendo latencia real contra tasa de cierre, no de entrada.

### Decisiones de soporte

- **Prompt caching queda fuera del alcance cotizado.** Con un modelo barato el ahorro absoluto son decenas de dólares al mes, y OpenRouter no documenta soporte de caching para estos modelos. Se menciona como mejora futura.
- **El documento no nombra el modelo.** Nombrarlo ata a un proveedor y envejece. Se dice *"el costo de IA se factura a tu cuenta de OpenRouter, estimado ~$X por lead"*.

### Riesgo abierto

Ninguna de las páginas de OpenRouter documenta si los **tokens de razonamiento se facturan como output**. Con effort bajo el riesgo es chico, pero la estimación de $0,023 por lead lo asume. Rehacer la tabla de costos sobre Terra es parte de *Estructura del artefacto*.

**Cifras con Terra**, para esa tabla: 100 leads ≈ $86.000 COP · 500 ≈ $115.000 · 2.000 ≈ $224.000 (incluye Kapso Pro). El escenario de 2.000 es el único que supera la mensualidad de 200.000 — y hay que mostrarlo así, sin maquillarlo.
