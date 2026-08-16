# Costos variables que asume Vorare

> Investigación de respaldo para la cotización del módulo de agente de ventas por WhatsApp.
> Todas las fuentes consultadas el **15 de agosto de 2026**.

## Cómo leer este documento

Cada cifra viene marcada:

- **[OFICIAL]** — publicada por el proveedor, con enlace. Verificada hoy.
- **[MEDIDO]** — leída del código de este repositorio.
- **[ESTIMADO]** — supuesto nuestro. Se da en rango, nunca como número único.

**Tasa de cambio.** TRM del 15 de agosto de 2026 = **$3.128,65 COP/USD**,
certificada por la Superintendencia Financiera de Colombia (vigencia 15–18 de
agosto). Para presupuestar usamos **$3.150 COP/USD**, un colchón de ~0,7%.
Fuente: [Superintendencia Financiera](https://www.superfinanciera.gov.co/publicaciones/60819/informes-y-cifrascifrasestablecimientos-de-creditoinformacion-periodicadiariatasa-de-cambio-representativa-del-mercado-trm-60819/).

**Resumen en una línea:** el costo variable va de **~$100.000 COP/mes** con 100
leads a **~$500.000 COP/mes** con 2.000 leads, y está dominado por OpenRouter.
Kapso es un plan fijo de $25 USD y Meta, en Colombia, es prácticamente
despreciable.

**Dos cosas que hay que decirle al cliente y no son obvias:**

1. **Meta sube precios el 1 de octubre de 2026** — seis semanas después de esta
   cotización. Empieza a cobrar los mensajes de servicio y termina la gratuidad
   de las plantillas utility dentro de la ventana de 24 h. Impacto: +2% a +7%
   del costo variable. Detalle en §2.5.
2. **La cuenta de Kapso ya está topando el plan gratuito**: hay evidencia en el
   repositorio de mensajes rechazados con HTTP 402 el 4 de agosto de 2026. Pasar
   a Pro ($25/mes) no es opcional. Detalle en §1.5.

---

## 1. Kapso — plataforma de WhatsApp

### 1.1 Planes vigentes **[OFICIAL]**

El dominio `kapso.ai` redirige (301) a `kapso.com`. Los precios son públicos.

| Plan | Precio | Mensajes/mes | Números incluidos | Excedente por mensaje |
|---|---|---|---|---|
| **Free** | **$0** | 2.000 | 1 | — |
| **Pro** | **$25/mes** | 100.000 | 3, luego $10 c/u | **$0,002** |
| **Platform** | **$299/mes** | 1.000.000 | 50, luego $5 c/u | **$0,001** |
| Enterprise | A convenir | Custom | Custom | — |

Fuentes: JSON-LD `schema.org/AggregateOffer` incrustado en
[kapso.com/pricing](https://kapso.com/pricing) (`lowPrice: 0`, `highPrice: 299`,
`priceCurrency: USD`); límites en la
[Pricing FAQ](https://docs.kapso.ai/docs/whatsapp/pricing-faq); tarifas de
excedente en las constantes de la calculadora de la propia página.

**Sí hay tier gratuito.** Free incluye 2.000 mensajes/mes, 1 número + sandbox,
1 GB de media, workflows y agentes AI ilimitados y miembros de equipo
ilimitados. No incluye onboarding de números de terceros. Sin tarjeta.

No existe opción de pago anual: todos los precios se muestran `/mo`.

### 1.2 Cómo factura **[OFICIAL]**

**Plan fijo mensual con excedente medido por mensaje individual.** No cobra por
conversación, ni por contacto activo, ni por asiento, ni por workflow.

- La unidad es el **mensaje**, entrante *y* saliente. Textual: *"Kapso counts
  all messages (inbound and outbound) toward your plan limit"* — incluye texto,
  media, plantillas, interactivos y **reacciones**. No cuentan los acuses de
  lectura.
- **Asientos gratis e ilimitados** en todos los planes.
- **Workflows sin costo:** *"Do you charge for workflows? No, you can create
  unlimited workflows at no extra cost."*
- Los mensajes incluidos **no se acumulan** de un mes al siguiente.
- Sin permanencia: *"upgrade, downgrade, or cancel anytime."*

### 1.3 Kapso no marca los cobros de Meta **[OFICIAL]**

Declarado de forma explícita y repetida:

- *"Kapso deducts Meta's published USD price from your project credits **with no
  added fee**."* ([Pricing FAQ](https://docs.kapso.ai/docs/whatsapp/pricing-faq))
- *"**Kapso adds no fee to Meta's price.**"*
  ([Meta message billing](https://docs.kapso.ai/docs/whatsapp/meta-message-billing))
- Tabla comparativa, fila "Meta message fees": **"At cost — No markup"** en los
  cuatro planes.

Hay **dos modos de pago a Meta**, y aplican a toda la cuenta (WABA):

1. **Créditos Kapso** — Kapso le paga a Meta y descuenta el precio publicado. Si
   el saldo se agota, los envíos pagos se pausan.
2. **Pago directo a Meta** — Meta cobra al método de pago de la cuenta Meta.

Para que Vorare pague con cuenta propia, el modo correcto es el **2**. Cambiar
de modo después requiere pasar por soporte de Kapso.

### 1.4 Add-ons **[OFICIAL]**

Número extra ($10 Pro / $5 Platform); *integration calls* por encima de 1.000
(Pro) / 10.000 (Platform); *serverless function calls*; transcripción de audio
por hora; retención de logs y eventos; *local number pools* (add-on, requiere
cuenta Twilio propia). Ninguno aplica al alcance cotizado, salvo que Vorare
conecte un segundo número.

### 1.5 Qué plan necesita Vorare **[MEDIDO] + [ESTIMADO]**

**Dato duro: esta cuenta ya reventó el plan Free.** El archivo
`apps/worker/src/scripts/resend-dead-402.ts` es un script para reencolar envíos
que Kapso rechazó con **HTTP 402 el 4 de agosto de 2026**, filtrando por
`lastError ILIKE '%Free plan message limit%'`. El worker los marcó `dead`, sin
reintento automático — es decir, **hoy se están perdiendo mensajes por el tope
de 2.000/mes**. El salto a Pro no es una optimización futura: es una condición
para operar.

Mensajes Kapso por lead (recordando que cuenta entrantes, salientes, plantillas
y reacciones):

| Segmento | Mensajes | Detalle |
|---|---|---|
| Lead que no confirma | 6 – 10 | 1–2 plantillas + entrantes del cliente + respuestas |
| Lead que confirma y compra | 35 – 45 | 1 confirmación + ~15 turnos (ida y vuelta) + ~6 plantillas de tracking |

Con 30% de conversión: **~18 mensajes por lead (rango 12 – 30).**

| Escenario | Mensajes/mes | Plan | Costo |
|---|---|---|---|
| 100 leads | 1.200 – 3.000 | Free queda al límite → **Pro** | **$25** |
| 500 leads | 6.000 – 15.000 | **Pro** | **$25** |
| 2.000 leads | 24.000 – 60.000 | **Pro** (tope 100.000) | **$25** |

**Kapso cuesta $25 USD/mes en los tres escenarios.** Sólo pasaría a Platform
($299) por encima de ~5.500 leads/mes.

---

## 2. Meta / WhatsApp Business Platform en Colombia

### 2.1 El modelo de cobro cambió: hoy es por mensaje, no por conversación **[OFICIAL]**

Confirmado contra la
[documentación oficial de precios de Meta](https://developers.facebook.com/docs/whatsapp/pricing/)
y su [historial de cambios](https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/):

| Fecha | Cambio |
|---|---|
| **1 nov 2024** | Las conversaciones de **servicio pasan a ser gratis** para todos los negocios, **sin tope**. El cupo previo de 1.000 conversaciones de servicio gratis al mes **quedó eliminado**: *"you can open an unlimited number of service conversations at no charge."* |
| **1 jul 2025** | **Fin del cobro por conversación de 24 h.** Entra el cobro **por mensaje de plantilla entregado**. Textual: *"Effective July 1, 2025, Meta charges on a per-message basis."* El modelo por conversación queda marcado como *deprecated*. |
| **1 oct 2025** | Colombia sube tarifas de utility y authentication. |
| **1 abr 2026** | COP se habilita como moneda de facturación. |
| **1 jul 2026** | Entra en vigor el rate card actual. |
| **1 ago 2026** | Ya vigente: los mensajes de Meta Business Agent se cobran **por token**, a $2,00 USD por millón. No aplica a esta implementación. |
| **1 oct 2026** | ⚠️ **Cambio relevante para esta cotización.** Ver §2.5. |

Lo que esto significa **hoy**:

- **Los mensajes que envía el agente conversando no cuestan nada.** Son texto
  libre dentro de la ventana de servicio, no plantillas. En el código,
  `enqueueOutbound` distingue ambos casos (`outbound.ts:38-57`) y el agente
  envía texto libre (`runner.ts:145-152`). El webhook de Meta los marca
  `"type": "free_customer_service", "billable": false`.
- **Todo lo que escribe el cliente es gratis.**
- **Las plantillas UTILITY entregadas dentro de una ventana de servicio abierta
  también son gratis.** Textual: *"utility templates sent within an open CSW are
  free."*
- Las plantillas **marketing y authentication sí se cobran** aunque la ventana
  esté abierta ("Free in 24-hour CSW: **No**").
- La categoría "service" no tiene tarifa: aparece como `n/a` en el rate card.

La ventana de servicio de 24 h **se reinicia con cada mensaje nuevo del
cliente**.

### 2.2 Tarifas oficiales para Colombia **[OFICIAL]**

Del rate card oficial de Meta, **vigente desde el 1 de julio de 2026**
(archivos CSV enlazados desde
[developers.facebook.com/docs/whatsapp/pricing#rate-cards](https://developers.facebook.com/docs/whatsapp/pricing)).
Fila `Colombia` completa, por **mensaje de plantilla entregado**:

| Categoría | USD | COP (rate card de Meta) |
|---|---|---|
| **Marketing** | **$0,0125** | $46,0227 |
| **Utility** | **$0,0008** | $2,9455 |
| **Authentication** | **$0,0008** | $2,9455 |
| Authentication-International | n/a | n/a |
| Service | n/a (gratis) | n/a (gratis) |

Colombia es uno de los mercados más baratos del mundo para utility: $0,0008 por
mensaje son **$2,52 COP a TRM**.

> ⚠️ **Conviene facturar en USD, no en COP.** El rate card en COP de Meta usa
> una tasa implícita de **~$3.682 COP/USD** ($46,0227 ÷ $0,0125), frente a la
> TRM de $3.128,65. Facturar en COP cuesta **17,7% más** que facturar en USD y
> convertir a TRM. Como COP se habilitó apenas el 1 de abril de 2026, la cuenta
> de Vorare probablemente sigue en USD — conviene **no migrarla**.

> ℹ️ **Ojo con las cifras que circulan.** Varios blogs de proveedores publican
> **$0,014** para marketing en Colombia. El CSV oficial de Meta dice **$0,0125**.
> Usamos el oficial. El de utility/authentication ($0,0008) sí coincide.

**Descuentos por volumen** (sólo utility y authentication, nunca marketing): en
Colombia la tarifa de lista llega hasta **100.000 mensajes utility/mes** y
**120.000 authentication/mes**; a partir de ahí bajan en escalones de −5%, −10%,
−15%, −20% y −25%. Se acumulan a nivel de *business portfolio* y **se resetean
cada mes**. A la escala de Vorare (máximo ~6.000 plantillas/mes con 2.000 leads)
**no se activa ningún descuento**: usamos siempre tarifa de lista.

### 2.3 Click-to-WhatsApp y el punto de entrada gratuito **[OFICIAL]**

Sigue existiendo, y sigue siendo el mecanismo más rentable para captar leads.

- **Qué la abre:** el usuario escribe desde un **anuncio Click-to-WhatsApp** o
  desde el botón de una **página de Facebook**, **usando la app de Android o
  iOS** — *"our desktop and web apps are not supported"*. Eso abre una ventana
  de servicio normal de 24 horas.
- Si el negocio **responde dentro de esas 24 horas**, ese mensaje es gratis y se
  abre la **ventana de punto de entrada gratuito (free entry point) de 72
  horas**, contadas **desde el momento en que el negocio respondió** — no desde
  el mensaje del cliente.
- **Dentro de esas 72 horas todos los tipos de mensaje son gratis:** *"you can
  send any type of message to the user at no charge."* La tabla oficial confirma
  "Free in 72-hour FEP window: **Yes**" para marketing, utility **y**
  authentication.
- **Una plantilla de marketing dentro de la ventana no rompe la gratuidad ni
  abre cobro.** Es gratis igual.
- **Qué la cierra:** el vencimiento de las 72 horas. Es lo único. La ventana de
  servicio de 24 h es independiente: si se cierra mientras el FEP sigue abierto,
  sólo se pueden enviar plantillas, pero siguen siendo gratis.
- **Tope mensual:** ⚠️ **no verificado.** No hay ninguna mención de cupo en la
  documentación de Meta, lo cual no es lo mismo que una confirmación de que no
  existe.

**Consecuencia operativa:** si Vorare pauta con Click-to-WhatsApp y el agente
responde rápido (lo hace: `debounceMs` está en 8 segundos), **todo el ciclo de
confirmación y buena parte del tracking cae dentro de la ventana gratuita**. El
costo con Meta tiende a cero para esos leads. Los que llegan por checkout de
Shopify sin haber escrito primero sí pagan la plantilla de confirmación.

**Esta palanca se vuelve más importante a partir del 1 de octubre de 2026**: el
FEP de 72 h es lo único que sigue gratis tras el cambio descrito en §2.5.
Textual de Meta: *"The 72-hour free entry point window is unchanged for message
delivery."*

### 2.4 Límites de mensajería — una restricción operativa, no de costo **[OFICIAL]**

Meta limita a cuántos **destinatarios únicos** se puede escribir **fuera** de una
ventana de servicio en 24 horas móviles. Los escalones son:

**250** (inicial) → **2.000** → **10.000** → **100.000** → **ilimitado**

Se calculan a nivel de *business portfolio* y se comparten entre todos los
números. Para subir de 250 a 2.000 hay tres caminos: verificar el negocio, que
lo verifique el partner, o entregar 2.000 mensajes fuera de ventana a números
únicos en 30 días con buena calidad de plantillas. De ahí en adelante el
escalado es automático según calidad y volumen.

**Por qué importa:** en el escenario de 2.000 leads/mes, entre leads nuevos
(~67/día) y plantillas de tracking a pedidos en curso, el tope inicial de 250
**se queda corto**. Conviene verificar el negocio antes de escalar la pauta. No
tiene costo asociado (Meta no lista cargo por verificación de negocio ni por el
número), pero sí tiempo de trámite.

### 2.5 ⚠️ Cambio de precios de Meta el 1 de octubre de 2026 **[OFICIAL]**

**Esto ocurre seis semanas después de la fecha de esta cotización y hay que
decírselo al cliente.** Meta lo anuncia en la cabecera de su página de precios:
*"Pricing updates for Meta Business Agent, service, and utility messages will
launch on August 1, 2026 and October 1, 2026."*

Dos cambios afectan directamente este módulo:

1. **Meta empezará a cobrar los mensajes de servicio.** Los mensajes de texto
   libre del negocio dentro de la ventana de 24 h — que son *todas* las
   respuestas conversacionales del agente — dejan de ser gratis. Tarifa
   anunciada: *"rates for service messages are the same as the rates for utility
   and authentication messages"*, es decir **~$0,0008 para Colombia**, y **sin
   descuentos por volumen**.
2. **Las plantillas UTILITY dentro de la ventana de 24 h dejan de ser gratis.**

Meta publica las tarifas definitivas **a más tardar el 1 de septiembre de 2026**.
Colombia **no** aparece en la lista de mercados con cambio de tarifa anunciado
para esa fecha (esos son Bangladesh, Irak, Nepal, Sri Lanka, Kazajistán, Kuwait,
Marruecos, Omán y Ucrania), así que se espera que la tarifa base se mantenga.

**Impacto estimado [ESTIMADO]:** con ~7 mensajes de servicio por lead (2 en
leads que no confirman, ~18 en los que sí) más las utility que dejan de ser
gratis, el costo de Meta pasa de **$0,002–0,004** a **~$0,009 por lead**, es
decir **unas 2,5 veces**. En términos absolutos sigue siendo pequeño: a 2.000
leads/mes, de ~$19.500 COP a ~$58.600 COP.

**Recomendación para la cotización:** incluir una nota de que las tarifas de Meta
cambian el 1 de octubre de 2026, que el impacto estimado es de ~$40.000 COP/mes
adicionales en el escenario de 2.000 leads, y que las cifras finales se
confirman con la publicación de Meta del 1 de septiembre.

### 2.6 Cuántas plantillas paga Vorare **[MEDIDO] + [ESTIMADO]**

El catálogo real está en `packages/shared/src/wa-templates.ts` (ver Anexo A).
Con 25% de conversión y 5% de incidencias, por cada 100 leads:

| Plantilla | Disparos | Categoría |
|---|---|---|
| `confirmacion_datos_cod` | 100 | UTILITY |
| `recuperacion_pedido_sin_confirmar` | ~40 | UTILITY |
| `pedido_confirmado_programado` | 25 | UTILITY |
| `vorare_guia_generada_v2` | 25 | UTILITY |
| `guia_recolectada` | 25 | UTILITY |
| `guia_en_transito` | 25 | UTILITY |
| `guia_en_reparto` | 25 | UTILITY |
| `guia_entregada_v2` | 25 | UTILITY |
| `novedad_entrega` / `guia_en_oficina` | ~5 | UTILITY |
| `remarketing_recompra_mes` / `vorare_reabrir_v2` | ~10 | MARKETING |
| **Total** | **~295 UTILITY + ~10 MARKETING** | |

**≈ 3,0 plantillas UTILITY + 0,1 MARKETING por lead.**

Costo por lead:

- **Escenario conservador** (se paga toda plantilla UTILITY):
  3 × $0,0008 + 0,1 × $0,0125 = **$0,0037**
- **Escenario realista** (la mitad de las UTILITY caen dentro de una ventana
  abierta o del free entry point): **$0,0025**

**Meta cuesta $0,002 – $0,004 USD por lead.** Es decir, entre **$8 y $12 COP
por lead**. A partir del 1 de octubre de 2026 sube a **~$0,009 USD (~$28 COP)**
por lead (§2.5).

---

## 3. OpenRouter — modelo de lenguaje

### 3.1 Qué modelo usa el agente hoy **[MEDIDO]**

El modelo no está fijo en el código: vive en la base de datos, en la columna
`agent_settings.model`, y se cambia desde el dashboard sin desplegar.

| Dónde | Valor |
|---|---|
| Default del esquema — `packages/db/src/schema.ts:404` | `anthropic/claude-sonnet-4.6` |
| Migración inicial — `packages/db/migrations/0000_overrated_deathstrike.sql:22` | `anthropic/claude-sonnet-4.6` |
| Seed — `packages/db/src/seed.ts:51` | `anthropic/claude-sonnet-4.6` |
| Placeholder del dashboard — `apps/web/src/app/(app)/agent/agent-form.tsx:144` | `anthropic/claude-sonnet-4.6` |

El default nunca cambió por migración (`git log -S` sobre el esquema devuelve
sólo el commit de scaffolding). **El valor efectivo en producción no es
verificable desde el repositorio**: hay que leer la fila `agent_settings.id=1`
en la base de Railway. Este documento asume `anthropic/claude-sonnet-4.6`.

El dashboard ofrece además `anthropic/claude-opus-4.7` y
`anthropic/claude-haiku-4.5` como alternativas (`agent-form.tsx:38-40`).

### 3.2 Hay tres puntos de llamada al LLM, no uno **[MEDIDO]**

| # | Dónde | Modelo | Cuándo | Frecuencia |
|---|---|---|---|---|
| 1 | `apps/worker/src/agent/runner.ts:125` | `agent_settings.model` (Sonnet 4.6) | Cada mensaje entrante, **sólo si `contact.agentMode` está activo** | Alta, acotada |
| 2 | `apps/worker/src/agent/confirmation-classifier.ts:73` | `anthropic/claude-haiku-4.5` (fijo en código, línea 8) | Cada mensaje entrante con texto, **sin importar `agentMode`** | Alta, todos los leads |
| 3 | `apps/worker/src/jobs/dropi-novedad-notify.ts:96` | `agent_settings.model` (Sonnet 4.6) | Una vez por novedad logística | Baja |

**El modelo caro no corre para todos los leads.** `agentMode` se enciende cuando
el cliente confirma el pedido (`apps/worker/src/jobs/confirmation-ack.ts:84-87`,
gobernado por `activateAgentOnConfirm`, default `true`) y se apaga al escalar a
humano (`apps/worker/src/agent/escalation.ts:48`). Los leads que no confirman
sólo pagan el clasificador Haiku.

### 3.3 Dos decisiones de arquitectura que dominan el costo **[MEDIDO]**

**(a) No hay tool calls.** `runner.ts:125-129` llama a `generateText` con
`model`, `system` y `messages` — sin parámetro `tools`. El contexto de producto
(Shopify) y de logística (Dropi) no se consulta con herramientas: se **inyecta
en el system prompt** en cada turno (`buildEffectiveSystemPrompt`,
`runner.ts:55-77`). Esto elimina los ciclos de ida y vuelta que multiplicarían
tokens, pero agrava el punto (b).

**(b) No hay prompt caching.** No existe ningún `cache_control` en el
repositorio. El system prompt se reenvía completo en cada turno y es la parte
más pesada del contexto, así que **se paga a precio pleno de entrada en cada
mensaje**. Es la palanca de ahorro más grande disponible (ver §3.7).

### 3.4 Precios **[OFICIAL]**

OpenRouter no aplica margen sobre el proveedor: *"no markup on inference
pricing… you pay the same rate as you would directly with the provider"*
([OpenRouter FAQ](https://openrouter.ai/docs/faq)).

| Modelo | Entrada (USD/1M tokens) | Salida (USD/1M tokens) | Contexto |
|---|---|---|---|
| [`anthropic/claude-sonnet-4.6`](https://openrouter.ai/anthropic/claude-sonnet-4.6) | **$3,00** | **$15,00** | 1M |
| [`anthropic/claude-haiku-4.5`](https://openrouter.ai/anthropic/claude-haiku-4.5) | **$1,00** | **$5,00** | 200K |

Coinciden con la lista oficial de Anthropic.

**Comisiones de OpenRouter** ([FAQ](https://openrouter.ai/docs/faq)):

- Recarga de créditos con tarjeta (Stripe): **5,5%** (mínimo $0,80).
- Recarga con cripto: **5%**.
- BYOK (llave propia de Anthropic): 5% sobre el consumo que exceda $25.000/mes.

Para Vorare aplica el **5,5% de recarga**, sumado al final de la tabla.

### 3.5 Tokens por conversación de venta **[ESTIMADO]**

Supuestos, derivados de la configuración real:

| Componente | Valor | De dónde sale |
|---|---|---|
| System prompt base (ventas: producto, precios, objeciones, política de envío) | 800 – 2.500 tok | Estimación. El seed trae uno de ~60 tokens (`seed.ts:12`), pero es un placeholder genérico. |
| Bloque de contexto Shopify | 300 – 1.200 tok | `shopify-context.ts`: por producto, título + precio + hasta 8 variantes + descripción truncada a 800 caracteres (`DESCRIPTION_MAX_CHARS`). 800 car. ≈ 250 tokens. 1–3 productos. |
| **System prompt efectivo (se reenvía cada turno)** | **1.200 – 3.500 tok** | Suma de lo anterior. |
| Ventana de memoria | 30 mensajes | `agent_settings.memory_window` default 30 (`schema.ts:425`), piso de 5 (`runner.ts:113`). |
| Tamaño de mensaje de WhatsApp | 15 – 40 tok | Estimación. Mensajes cortos, en español. |
| Historial en el turno *i* | mín(2*i*, 30) × 30 tok | Se satura en ~900 tokens desde el turno 15. |
| Respuesta del agente | 50 – 150 tok | Estimación. |

**Conversación de venta completa:**

| | Bajo | Central | Alto |
|---|---|---|---|
| System prompt | 1.200 | 2.000 | 3.500 |
| Turnos del agente | 15 | 20 | 25 |
| Entrada promedio por turno | ~1.600 | ~2.600 | ~4.300 |
| **Entrada total** | ~24.000 tok | ~52.000 tok | ~107.500 tok |
| **Salida total** | ~750 tok | ~1.800 tok | ~3.750 tok |
| Costo entrada | $0,072 | $0,156 | $0,323 |
| Costo salida | $0,011 | $0,027 | $0,056 |
| **Costo por conversación** | **~$0,08** | **~$0,18** | **~$0,38** |

La entrada es el **85–90% del costo**: consecuencia directa de reenviar el
system prompt sin caché en cada turno.

**Clasificador Haiku 4.5** (corre para todos los leads): ~90 tokens de system
prompt + ~250 de transcripción = ~340 de entrada; salida limitada a 8 tokens
(`maxOutputTokens: 8`). **~$0,0004 por corrida**; con 3–10 corridas por lead,
**$0,001 – $0,004 por lead**. Marginal.

**Novedad logística** (Sonnet 4.6): una llamada corta (~500 tok entrada, ~100
salida) ≈ **$0,003**, sólo en pedidos con incidencia (~5–10%). Marginal.

### 3.6 Costo promedio por lead **[ESTIMADO]**

No todos los leads llegan a 20 turnos. Mezcla supuesta:

| Segmento | % de leads | Costo LLM |
|---|---|---|
| No confirma — sólo clasificador Haiku | 60 – 75% | ~$0,002 |
| Confirma y conversa poco (5–10 turnos) | 15 – 25% | ~$0,08 |
| Confirma y conversa a fondo (15–25 turnos) | 8 – 15% | ~$0,18 – $0,38 |

**Promedio ponderado: $0,03 – $0,15 por lead, con centro en ~$0,06.**

El supuesto más sensible es la **tasa de confirmación** (asumimos 25–40%). Si
Vorare tiene el dato real, sustitúyalo: el costo de OpenRouter es casi
linealmente proporcional a él.

### 3.7 Palancas de reducción **[ESTIMADO]**

Sin cambiar el alcance, dos ajustes bajarían la factura de OpenRouter:

1. **Activar prompt caching.** El system prompt es 60–80% de los tokens de
   entrada y es idéntico turno a turno. Con caché de Anthropic las lecturas
   cuestan ~0,1× el precio base. Ahorro estimado: **50–70% del costo del
   agente.** Requiere un cambio de código en `runner.ts`.
2. **Bajar el agente a Haiku 4.5.** Es 3× más barato en entrada y salida; para
   una conversación de ventas guionada puede alcanzar. Ahorro: **~67%.** Cambio
   de un campo en el dashboard, cero código.

Ambas se pueden ofrecer como optimización posterior, no como alcance inicial.

---

## 4. Tabla de costo mensual — lista para el documento de cliente

Supuestos: TRM $3.150 COP/USD · 30% de conversión · plan Kapso Pro · Meta
pagado con cuenta propia de Vorare en USD · incluye la comisión de 5,5% de
OpenRouter por recarga con tarjeta.

### 100 leads/mes

| Concepto | Rango USD | Central USD | Central COP |
|---|---|---|---|
| Kapso (plan Pro, fijo) | $25,00 | $25,00 | $78.750 |
| OpenRouter (+5,5%) | $3,17 – $15,83 | $6,33 | $19.940 |
| Meta / WhatsApp | $0,25 – $0,40 | $0,32 | $1.010 |
| **Total** | **$28,42 – $41,23** | **$31,65** | **≈ $99.700 COP** |

### 500 leads/mes

| Concepto | Rango USD | Central USD | Central COP |
|---|---|---|---|
| Kapso (plan Pro, fijo) | $25,00 | $25,00 | $78.750 |
| OpenRouter (+5,5%) | $15,83 – $79,13 | $31,65 | $99.700 |
| Meta / WhatsApp | $1,25 – $1,85 | $1,55 | $4.880 |
| **Total** | **$42,08 – $105,98** | **$58,20** | **≈ $183.300 COP** |

### 2.000 leads/mes

| Concepto | Rango USD | Central USD | Central COP |
|---|---|---|---|
| Kapso (plan Pro, fijo) | $25,00 | $25,00 | $78.750 |
| OpenRouter (+5,5%) | $63,30 – $316,50 | $126,60 | $398.800 |
| Meta / WhatsApp | $5,00 – $7,40 | $6,20 | $19.530 |
| **Total** | **$93,30 – $348,90** | **$157,80** | **≈ $497.100 COP** |

### Resumen comparativo

| Volumen | Costo variable mensual (COP) | Centro | Desde el 1 oct 2026 | Vs. tarifa de $200.000 COP/mes |
|---|---|---|---|---|
| **100 leads** | $89.500 – $129.900 | ~$99.700 | ~$101.500 | ~50% de la tarifa |
| **500 leads** | $132.600 – $333.800 | ~$183.300 | ~$192.600 | ~92% de la tarifa |
| **2.000 leads** | $293.900 – $1.099.000 | ~$497.100 | ~$534.200 | ~2,5× la tarifa |

**Cómo leerlo:** el costo variable es sublineal al inicio (Kapso es fijo y
absorbe el arranque) y pasa a ser lineal con el volumen, porque OpenRouter
escala uno a uno con los leads. El punto de quiebre está alrededor de los 550
leads/mes, donde el costo variable iguala la tarifa del módulo.

La columna del 1 de octubre de 2026 incorpora el cobro de mensajes de servicio y
el fin de la gratuidad de las plantillas utility dentro de la ventana (§2.5).
Sube el total entre 2% y 7% según volumen — es un ajuste, no un cambio de orden
de magnitud.

### Qué puede mover estas cifras

| Variable | Efecto |
|---|---|
| **Tasa de confirmación** distinta a 30% | OpenRouter escala casi proporcionalmente. Es el supuesto más sensible. |
| **Tamaño del system prompt** | Cada 1.000 tokens extra suben ~$0,06 USD por conversación completa. |
| **Activar prompt caching** | −50 a −70% en OpenRouter. |
| **Cambiar el agente a Haiku 4.5** | −67% en OpenRouter. |
| **Pautar con Click-to-WhatsApp** | Meta tiende a cero (ventana gratuita de 72 h). Gana peso tras el 1 oct 2026. |
| **Cambio de precios de Meta del 1 oct 2026** | +2% a +7% del total. Tarifas definitivas se publican el 1 sep 2026. |
| **Facturar Meta en COP en vez de USD** | +17,7% en Meta. No recomendado. |
| **Subir de 500 a 2.000 leads** | Kapso NO cambia; sigue en Pro hasta ~5.500 leads/mes. |
| **TRM** | Todo el costo es en USD. Una devaluación de 10% sube el total 10% en COP. |

---

## Anexo A — Catálogo de plantillas de WhatsApp **[MEDIDO]**

Fuente: `packages/shared/src/wa-templates.ts`.

**UTILITY (12):** `confirmacion_datos_cod`, `recuperacion_pedido_sin_confirmar`,
`pedido_confirmado_programado`, `guia_recolectada`, `guia_en_transito`,
`guia_en_reparto`, `guia_entregada_v2`, `guia_en_oficina`, `novedad_entrega`,
`vorare_guia_generada_v2`, `vorare_admin_alerta_v2`, `vorare_admin_aviso_v2`.

**MARKETING (3):** `guia_entregada` (obsoleta — reemplazada por
`guia_entregada_v2` en UTILITY, commits `55cf5c9` y `fd5efa6`),
`remarketing_recompra_mes`, `vorare_reabrir_v2`.

El equipo ya optimiza categorías por costo: el encabezado del archivo dice
literalmente *"categorías por costo"*, y `recuperacion_pedido_sin_confirmar`
lleva la nota *"Borderline UTILITY: versión neutra sin lenguaje promocional para
no caer en MARKETING"*. Con marketing a $0,0125 y utility a $0,0008, cada
plantilla reclasificada de MARKETING a UTILITY **cuesta 15,6 veces menos**.

**Nota de mercado:** los ejemplos de las plantillas mezclan Guatemala
(`"Zona 10, Ciudad de Guatemala"`, `"Q{{total}}"`) con Colombia
(`"Interrapidísimo"`). Las tarifas de Meta son **por país del destinatario**, así
que tráfico fuera de Colombia se cobra con otra tabla — y Guatemala es
sensiblemente más cara. No hay código de país fijo en
`apps/worker/src/lib/phone.ts`. Conviene confirmar el mercado objetivo antes de
cerrar la cifra.

---

## Anexo B — Qué no pudimos verificar

- **El modelo que corre en producción hoy.** Está en la base de datos
  (`agent_settings.model`), no en el código. Asumimos el default
  `anthropic/claude-sonnet-4.6`. Verificable en un minuto contra Railway.
- **La tasa real de confirmación de Vorare.** Asumimos 25–40%. Es el supuesto
  que más mueve la cifra final.
- **El tamaño real del system prompt de ventas.** El repositorio sólo contiene
  un placeholder genérico; el prompt real vive en la base
  (`agent_prompt_versions`). Asumimos 800–2.500 tokens.
- **Precios anuales de Kapso.** No aparecen en la página. Ausencia de evidencia,
  no evidencia de ausencia — vale preguntarles.
- **La mezcla real de leads por Click-to-WhatsApp vs. checkout de Shopify.**
  Cambia el costo de Meta, aunque el impacto absoluto es pequeño.
- **Las tarifas definitivas de Meta desde el 1 de octubre de 2026.** Meta las
  publica a más tardar el 1 de septiembre. Nuestra proyección asume que el
  mensaje de servicio se cobrará igual que utility ($0,0008 para Colombia), que
  es lo que Meta anunció, y que la tarifa base de Colombia no cambia.
- **Si existe algún tope mensual al free entry point de 72 h.** Meta no menciona
  ninguno, pero tampoco confirma que no exista.
- **El escalón de límite de mensajería en el que está la cuenta hoy** (250 o
  2.000 destinatarios únicos/24 h). Se consulta en el Administrador de WhatsApp.

---

## Fuentes

**Kapso** — [kapso.com/pricing](https://kapso.com/pricing) ·
[Pricing FAQ](https://docs.kapso.ai/docs/whatsapp/pricing-faq) ·
[Meta message billing](https://docs.kapso.ai/docs/whatsapp/meta-message-billing)

**Meta / WhatsApp Business Platform** —
[Pricing](https://developers.facebook.com/docs/whatsapp/pricing/) (actualizada
el 5 de agosto de 2026) ·
[Cambios de agosto y octubre de 2026](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages) ·
[Modelo por conversación (deprecado)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/conversation-based-pricing) ·
[Límites de mensajería](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits) ·
rate cards oficiales en CSV y PDF ("USD rates", "USD volume tiers", "COP rates",
"COP volume tiers"), enlazados desde la sección *Rate cards and volume tiers* de
la página de precios — las URLs directas llevan token de expiración, hay que
tomarlas del HTML en el momento.

**OpenRouter** — [FAQ](https://openrouter.ai/docs/faq) ·
[claude-sonnet-4.6](https://openrouter.ai/anthropic/claude-sonnet-4.6) ·
[claude-haiku-4.5](https://openrouter.ai/anthropic/claude-haiku-4.5)

**TRM** —
[Superintendencia Financiera de Colombia](https://www.superfinanciera.gov.co/publicaciones/60819/informes-y-cifrascifrasestablecimientos-de-creditoinformacion-periodicadiariatasa-de-cambio-representativa-del-mercado-trm-60819/)
