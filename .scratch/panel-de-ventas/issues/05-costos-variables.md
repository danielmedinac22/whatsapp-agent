# Costos variables que asume Vorare

Type: research
Status: resolved
Blocked by: —

## Question

El documento dirá que Kapso y OpenRouter van por cuenta de Vorare. Vorare va a preguntar cuánto es eso, y una cotización que no lo responde se lee como letra chica.

Conseguir cifras defendibles para:

- **Kapso** — planes y precios vigentes, y cómo factura las conversaciones de WhatsApp.
- **Meta / WhatsApp Business en Colombia** — costo por conversación por categoría, y en particular el tratamiento de los leads que entran por Click-to-WhatsApp (punto de entrada gratuito y su ventana).
- **OpenRouter** — costo por token del modelo que usa el agente hoy, y de ahí un costo estimado por conversación de venta completa.

Entregar un estimado mensual con supuestos explícitos de volumen, en rango y no como número único. El objetivo es una tabla que se pueda pegar en el documento.

## Answer

Cifras y fuentes completas en [`research/05-costos-variables.md`](../research/05-costos-variables.md). TRM $3.128,65 COP/USD (Superfinanciera, 15-ago-2026); las tablas usan $3.150 con colchón.

**Kapso** — cobra por *mensaje* (entrantes, salientes y reacciones), no por conversación. Free $0 hasta 2.000 msg/mes, **Pro $25/mes hasta 100.000**, Platform $299. Asientos y workflows sin costo. Pasa los cobros de Meta **a costo, sin markup**. Pro alcanza en los tres escenarios de volumen.

**Meta Colombia** — cobro **por mensaje desde el 1-jul-2025**; el modelo por conversación está deprecado. Rate card vigente 1-jul-2026: marketing $0,0125, utility $0,0008, authentication $0,0008, service gratis. Hoy las respuestas del agente y las plantillas utility dentro de la ventana de 24 h **no se cobran**. El free entry point de CTWA da **72 h gratis**, arranca cuando el negocio responde y solo lo cierra el vencimiento.

**OpenRouter** — ver la **corrección** más abajo: la investigación tomó el *default* del schema (`anthropic/claude-sonnet-4.6`) en vez del valor real en la base, y sobrestimó el costo ~4x. Lo que sí quedó confirmado: **no hay prompt caching ni tool calls**, así que el system prompt se re-paga en cada turno y es el **85–90% del costo**.

**Costo mensual total para Vorare** según la investigación original, centro del rango, en COP: 100 leads ≈ $99.700 · 500 leads ≈ $183.300 · 2.000 leads ≈ $497.100. **Estas cifras están sobrestimadas** — ver corrección.

### Tres cosas que cambian la cotización

1. **Meta sube tarifas el 1-oct-2026** — empieza a cobrar mensajes de servicio y termina la gratuidad de plantillas utility en ventana. Impacto +2% a +7% del variable. Las tarifas definitivas se publican el **1-sep**. Cualquier tabla publicada antes necesita cláusula de vigencia.
2. **Punto de quiebre en ~550 leads/mes** — ahí el costo variable que paga Vorare iguala la mensualidad de 200.000 COP.
3. **Facturar Meta en COP cuesta 17,7% más** que en USD: su rate card en COP usa una tasa implícita de ~$3.682. La cuenta no se debe migrar a COP.

### Palancas de ahorro documentadas

La investigación proponía activar prompt caching (−50/70%) y bajar el agente a Haiku (−67%). **La corrección le quita fuerza a las dos**: el agente ya corre sobre un modelo barato, así que el ahorro absoluto pasa a ser de decenas de dólares al mes, no de cientos. Se deciden en *Modelo de Sebastián: calidad de venta vs costo variable*.

### Corrección (15-ago-2026) — los tres supuestos del Anexo B, ya verificados

Se consultó `agent_settings` en producción, en solo lectura. Los tres supuestos que la investigación no pudo verificar quedaron resueltos, y **uno de ellos invalida sus cifras**:

- **El modelo real en producción es `openai/gpt-5.4-mini`, no `claude-sonnet-4.6`.** La investigación tomó el default del schema. Precio real en OpenRouter: **$0,75 / $4,50 por millón** contra los $3/$15 asumidos — entre 3,3x y 4x más barato, y el costo lo domina el input, que es el que baja 4x.
- **Prompt del agente: 7.728 caracteres** (~2.000 tokens), bastante más que los 2.936 de la copia del repo. Se re-paga en cada turno.
- **Tasa de confirmación real: 88,4%** — 1.449 confirmados de 1.640 pedidos.

**Cifras corregidas**, reescalando el modelo de la investigación con el precio real (≈$0,017 por lead en vez de $0,066):

| Leads/mes | Kapso Pro | IA + Meta | **Total COP** |
|---|---|---|---|
| 100 | $78.750 | ~$5.400 | **~$84.100** |
| 500 | $78.750 | ~$26.800 | **~$105.500** |
| 2.000 | $78.750 | ~$107.100 | **~$185.900** |

**Esto elimina el punto de quiebre.** Con el modelo real, el costo variable de Vorare se mantiene **por debajo** de la mensualidad de 200.000 COP incluso a 2.000 leads/mes. El argumento comercial mejora bastante.

Son cifras **reescaladas, no recalculadas desde cero**. Rehacer la tabla limpia es parte de *Estructura del artefacto*.

### Hallazgo ajeno a este mapa

El 4-ago-2026 hubo envíos que el outbound worker marcó `dead` con `'Free plan message limit'` — la cuenta Kapso topó el plan Free. Existe `apps/worker/src/scripts/resend-dead-402.ts` para reencolarlos, pero está **sin commitear** y no consta si llegó a correrse ni si el plan se subió después. Verificado en el repo, no en producción. Es un asunto del servicio existente, no del módulo de ventas — se escala aparte.
