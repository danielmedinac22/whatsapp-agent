# Mapa — Panel de Ventas (Sebastián) para Vorare

Label: `wayfinder:map`

## Destination

Un **artefacto publicado** — página web privada, en español, en registro de negocio — que le presenta a Vorare el alcance completo del Panel de Ventas (el agente comercial *Sebastián* descrito en el PRD) y lo cotiza en **200.000 COP/mes**.

El mapa termina cuando ese artefacto está publicado y el link está en manos del usuario.

## Notes

**Este mapa lleva ejecución.** A diferencia del default de wayfinder, el destino *es* un entregable: el último ticket lo escribe y lo publica. Todos los demás tickets son decisiones.

**Dominio.** WhatsApp Business vía Kapso; Shopify como catálogo y sistema de órdenes; Dropi como capa logística (guías, novedades, tracking); pago contraentrega (COD) en Colombia. Dos agentes: *Katherine* (postventa, ya existe en producción) y *Sebastián* (preventa, es lo que se cotiza).

**Aguas abajo.** El mapa llegó a su destino y las decisiones se convirtieron en cuatro specs, listos para tickets:
[ingesta y reconocimiento](../ventas-ingesta-reconocimiento/spec.md) ·
[conversación de venta](../ventas-conversacion/spec.md) ·
[cierre, orden y handoff](../ventas-cierre-orden/spec.md) ·
[Panel de Ventas](../ventas-panel/spec.md).
El PRD final está en `prd.html` y la cotización cara-cliente en `artefacto.html`.

**Fuente.** El PRD del cliente vive en `/Users/equipo/Downloads/PRD-Panel-de-Ventas-WaiChat (1).md`.

**Skills a consultar.** `/grilling` y `/domain-modeling` en todo ticket de decisión. `artifact-design` es **obligatorio** antes de escribir la página del artefacto.

**Idioma y registro.** Todo lo cara-cliente va en español y en lenguaje de negocio. Sin webhooks, sin nombres de API, sin jerga técnica en el artefacto — ese detalle vive en los tickets.

### Términos comerciales fijados (no se re-litigan)

- **200.000 COP/mes** cubren construcción y mantenimiento del Panel de Ventas. Sin cobro único de implementación.
- Es el precio **de este módulo**, no del servicio completo de WaiChat.
- **Costos variables por cuenta de Vorare, con cuentas propias suyas**: Kapso (que incluye el costo de conversaciones de Meta) y OpenRouter (tokens del LLM). WaiChat configura las llaves; no factura el consumo.
- **Alcance = literalmente el PRD**, con las cuatro decisiones abiertas del §12 **cerradas antes de publicar**.
- Cobro **desde producción**, no desde firma. Contrato **mes a mes**. Entrega **por fases**.
- **Incluido en "mantener"**: corregir fallas, ajustar el prompt de Sebastián, cargar productos e IDs de anuncio nuevos (hasta una cantidad razonable al mes), ajustar mensajes base, monitoreo.
- **No incluido**: funciones nuevas, integraciones nuevas, otro número, otra tienda o cliente.
- **Vorare provee** el número dedicado de ventas, ya aprovisionado en su Business Manager.
- **Cuentas que Vorare debe abrir**: Kapso plan **Pro ($25/mes)** — cubre hasta 2.000 leads/mes y pasa los cobros de Meta a costo sin markup — y OpenRouter. La cuenta de Meta se factura **en USD, nunca en COP**: la rate card en COP usa una tasa implícita ~17,7% peor.

### Hechos verificados contra el código

- `apps/worker/src/shopify/admin.ts` hoy **solo lee** Shopify (productos, ping). Crear órdenes es código nuevo.
- `kapso_connection` y `shopify_connection` son tablas de **una sola conexión**. Un segundo número toca el modelo de datos, no es configuración.
- **No existe** manejo de `referral` / CTWA en el código.
- El agente corre en producción sobre **`openai/gpt-5.4-mini`** ($0,75/$4,50 por millón), no sobre el default `claude-sonnet-4.6` del schema. **Sin prompt caching ni tool calls** — el system prompt (7.728 caracteres, ~2.000 tokens) se re-paga cada turno y es el 85–90% del costo variable.
- **Tasa de confirmación real: 88,4%** (1.449 de 1.640 pedidos).
- La cuenta Kapso **ya topó el plan Free al menos una vez**: el 4-ago-2026 hubo envíos que el outbound worker marcó `dead` con `'Free plan message limit'`, y existe `apps/worker/src/scripts/resend-dead-402.ts` para reencolarlos. El script está **sin commitear** y no consta si se corrió ni si el plan se subió después. Es un asunto del servicio actual, ajeno a este mapa, pero confirma que el plan Free no da y que el Pro entra como dependencia real.
- El worker **no crea** pedidos en Dropi — solo los lista y los confirma (`apps/worker/src/dropi/orders.ts`). La guía nace de una integración Shopify↔Dropi ajena a WaiChat.

### Cambio de alcance del 16-ago-2026 (nota de voz del usuario)

**Vorare opera en Guatemala, no en Colombia**, y va a abrir una segunda operación en Colombia. Verificado en producción: las 1.678 órdenes son 100% GTQ, prefijo 502, país Guatemala. Todo el análisis de catálogo de abajo es del **catálogo guatemalteco**.

Decidido con el usuario:

- **Colombia es una operación completa**, no solo un número de ventas: tienda, catálogo, confirmación y ventas.
- **Un número por país, con operación completa cada uno.** Ventas y confirmación **comparten número** — lo que elimina la plantilla *nueva* y la aprobación de Meta del camino crítico, porque el primer toque tras una venta de Sebastián cae dentro de la ventana de 24 h. **Las plantillas existentes no desaparecen**: los pedidos que entran directo desde la tienda conservan el flujo actual completo (plantilla de confirmación y mensajes de actualización), y el seguimiento de guía y entrega sigue siendo plantilla para todos. Regla: **el origen decide contenido y demora; la ventana decide el mecanismo.**
- **Dos tiendas Shopify separadas**, con un **selector de operación** en el panel.
- **El precio se mantiene en 200.000 COP/mes.** Señalado que el trabajo cambia de naturaleza —de agregar una función a volver multi-inquilino un sistema que asume uno solo en 110 referencias— y reafirmado por el usuario.

**Cuatro tablas singleton**, no dos: `agent_settings` (65 refs) · `dropi_connection` (19) · `shopify_connection` (16) · `kapso_connection` (10).

**`shopify_connection` está vacía.** Los pedidos entran por webhook con secreto de entorno, pero **crear** órdenes por la Admin API necesita esa conexión y nadie la ha configurado. Prerequisito del cierre. Además `dropi_dry_run` está en `true`: las confirmaciones a Dropi se simulan.

**Pendiente:** la tabla de costos de la cotización usa tarifas de Meta **para Colombia**. La operación es Guatemala. Hay que rehacerla con tarifas de ambos países.

### Verificado contra la Graph API de Meta (16-ago-2026, credenciales reales, solo lectura)

App **CLAUDE VORARE GUATEMALA** (`3918760311591600`), token de usuario sin expiración, con `ads_management`, `ads_read`, `business_management`, `catalog_management`, `leads_retrieval`, `whatsapp_business_management` y `whatsapp_business_messaging`.

- **El número vivo es +502 3689 0343** — WABA «Vorare» (`1676368750161510`), CLOUD_API, calidad GREEN. Coincide con el fixture de `kapso/inbound.test.ts` (`from: "50236890343"`).
- **El número de Colombia ya existe**: +57 304 5430173, WABA «Vorare Living» (`1301601911943339`, COP). Pero está en **ON_PREMISE**, no Cloud API — hay que migrarlo antes de usarlo.
- Hay **cuatro WABAs** bajo el portafolio Vorare, no una. Las otras dos (+502 5946 7118, +502 4722 4176) están en ON_PREMISE.
- **Cuenta publicitaria `act_2042265076620189` «CP - Vorare»: activa, en COP, zona Bogotá.** Se pauta en pesos y se factura en quetzales.
- **Píxel `1825130408114773` «Pixel Vorare Guatemala»**: disponible, uso publicitario habilitado. CAPI no tiene bloqueo técnico.
- **Seis portafolios de negocio** accesibles con este token: Vorare, Prime Luxury, Tu tienda online y Esencia Urbana verificados; Mp Perfumes y Carpas JJ sin verificar.
- **`whatsapp_business_management` + `whatsapp_business_messaging` abren una salida al riesgo abierto**: esta app podría recibir los webhooks de WhatsApp directo de Meta, con `referral` sin recortar, y volver innecesaria la verificación pendiente contra Kapso.
- **Advertencia del administrador de la cuenta**: existe un segundo token, de usuario de sistema, que sirve para CAPI y lectura pero **no** para crear anuncios (choca con la certificación de no discriminación). El de usuario sí crea anuncios.

**CAPI entra al alcance y no se cotiza aparte** — decisión del usuario, tras señalarle que era la única pieza cuya naturaleza justificaba revisar el precio.

**Resuelto por investigación** ([`research/06-app-meta-multicliente.md`](research/06-app-meta-multicliente.md)):

- **Multi-cliente: sí, Meta lo contempla** como *Tech Provider* (Platform Terms §5.b) — la misma figura bajo la que opera Kapso. **No** hace falta ser Business Partner ni Solution Partner. Pero la app hoy no califica: faltan Business Verification, App Review con Advanced Access, Marketing API Full Access (que exige **500 llamadas en 15 días con menos de 15% de error — hay que acumular historial antes de pedirlo**) y aislamiento de datos por cliente, que es obligación contractual y no preferencia. Dos restricciones: prohibido meter varios anunciantes en una misma cuenta publicitaria, y el acceso se degrada tras 30 días sin uso. Si el agente no crea campañas conviene pedir solo `ads_read` y omitir `ads_management`, que es la revisión más dura. El flujo correcto es Facebook Login for Business con *configuration* más un token de usuario de sistema por cliente.
- **Dos apps sobre una misma WABA: sí.** El endpoint añade, no reemplaza, y los reintentos van a todas las suscritas. Se puede suscribir solo al campo de mensajes sin tocar la configuración de Kapso.
- **Falta el permiso `whatsapp_business_manage_events`**, que Meta exige para CAPI sobre anuncios CTWA. No está en el token — **corrige lo dicho antes de que nada bloqueaba CAPI técnicamente.**
- **No existe endpoint para recuperar la referencia después del hecho.** Si no se captura en el webhook, el identificador de clic se pierde. **Toda pauta que corra antes de que la captura funcione es atribución perdida** — reordena la prioridad: captura antes que inversión.

### Módulos y ruteo de bandeja (revisión con Pablo, 16-ago-2026)

Una sola plataforma con **dos módulos separados** dentro de cada operación: el de Katherine —plantillas de confirmación, pedidos, logística— y el de Sebastián —plantillas de venta, persona, catálogo, anuncios—. Quien entra a uno ve lo suyo.

- **País primero, módulo dentro.** Equivocarse de módulo es molestia; equivocarse de país despacha al lugar equivocado.
- **Los módulos separan pantallas y configuración, NO el historial.** Al abrir un chat se ve la conversación completa. *Corrige una recomendación previa mía de que ambos equipos vieran todo: Pablo quiere vistas separadas, y es su operación.*
- **Roles nuevos: ventas y operaciones**, además de admin, que ve ambos. `user_role` tiene solo 2 referencias en el código — cambio barato. **La separación la impone el rol, no el módulo.**
- **El estado no se guarda: se deriva, y su trabajo es rutear.** Ya hay tres máquinas de estado (pipeline del pedido, `confirmation_status`, 15 estados de Dropi); una cuarta guardada tendría que mantenerse de acuerdo con todas, y la que miente siempre es la que un humano olvidó actualizar. Derivarla la vuelve incapaz de desactualizarse.
- **Lo único guardado es la asignación** — «este lo estoy trabajando yo» — porque el sistema no lo puede deducir.
- **La conexión de la tienda es de la operación, no del módulo de ventas.** Si viviera ahí, apagar ventas tumbaría la confirmación. El catálogo sí es de Sebastián.
- **El recomprador va a la bandeja de ventas**: un clic de anuncio posterior al último pedido es intención de compra nueva.

Consecuencia estructural: hay **una conversación por contacto, para siempre** (índice único sobre `contact_id`). Por eso el ruteo no puede ser un campo que se sobrescriba — un recomprador tendría encima su estado de julio.

### Datos reales de producción (consultados 15-ago-2026, solo lectura)

- **1.640 pedidos** entre el 29-abr-2026 y el 15-ago-2026 → ~**470 pedidos/mes**.
- **17 productos distintos**, con concentración extrema: *REVITALHAIR – DHT ANTICALVICIE* es el **77%** del volumen (1.263 pedidos); los tres primeros suman el **96%**. Los otros 14 tienen entre 1 y 18 pedidos cada uno.
- **Riesgo de ambigüedad semántica confirmado**: hay tres SKUs REVITALHAIR de nombre casi idéntico — *DHT ANTICALVICIE*, *DHT BLOCKER ANTICALVICIE* y *COMBO DHT + SERUM ANTICALVICIE 360*. Un match semántico sobre el copy del anuncio no los distingue con confianza, y ahí está el 77% del volumen.
- **Implicación para la tabla de costos**: con ~470 pedidos/mes ya confirmados, el escenario realista de leads no es 100/mes sino la banda **500–2.000**. Con el modelo real de producción eso son ~$105.500–$185.900 COP/mes de costo variable — por debajo de la mensualidad.
- **Tasa de confirmación: 88,4%** (1.449 de 1.640). Cifra fuerte, sirve en el documento.

## Decisions so far

<!-- una línea por ticket cerrado: gist + link -->

- [Escribir y publicar el artefacto](issues/09-publicar-el-artefacto.md) — **Publicado**: https://claude.ai/code/artifact/b5904b76-34b1-4ecf-b82d-e735dd44f5de · fuente en `artefacto.html`. Se publicó con *Verificar `referral`* aún abierto, a propósito: el riesgo entró como supuesto declarado con plan alterno (si el ad-id no sirve, Sebastián pregunta) en vez de quedar escondido.
- [Estructura del artefacto](issues/08-estructura-del-artefacto.md) — Nueve secciones. **Precio arriba en ficha y desglosado abajo**; **exclusiones justo después del alcance**, no en la letra chica, porque una exclusión escondida se lee como trampa; dependencias del cliente con sección propia; cláusula de vigencia sobre los costos. Numeración solo donde hay secuencia real: el recorrido del lead y las fases.
- [Fases y cronograma del documento](issues/07-fases-y-cronograma.md) — **Tres fases, ~7 semanas.** El catálogo se movió a la Fase 1 porque el reconocimiento depende de él. Los estimados son propios y hay que contrastarlos con capacidad real. **El momento del cobro se sacó del documento** (16-ago): se cobra para iniciar y se negocia por fuera. Pendiente confirmar si eso choca con la frase "no hay cobro de implementación" que sigue publicada.
- [Modelo de Sebastián: calidad de venta vs costo variable](issues/11-modelo-de-sebastian.md) — **`openai/gpt-5.6-terra`, reasoning effort bajo.** La premisa del ticket estaba mal: producción corre `gpt-5.4-mini`, no Sonnet. Terra cuesta 1,33x el actual (~$0,023/lead) y la prima sobre la opción barata es ~$130.000 COP/mes a 2.000 leads — una venta extra. En un agente cuyo output es ingreso se yerra del lado caro. `medium` descartado: persuadir no es razonar, y la latencia mata conversaciones de venta. Prompt caching fuera de alcance; el documento no nombra el modelo.
- [Criterios de aceptación del alcance](issues/06-criterios-de-aceptacion.md) — Nueve criterios, **todos de comportamiento observable, ninguno de resultado**: no se compromete tasa de cierre ni % de reconocimiento, porque eso sería absorber el riesgo comercial de Vorare a precio fijo. La cola de reintentos y alerta ante fallo de Shopify **entra en v1** — sin eso una venta se pierde en silencio, y eso es defecto, no funcionalidad faltante. Sin ventana formal de aceptación.
- [Disparador del handoff a Katherine](issues/03-disparador-del-handoff.md) — **Sin código nuevo**: la orden que Sebastián cree por la Admin API dispara el webhook de Shopify que el pipeline de Katherine ya consume. Los pedidos con tag `waichat-ventas` usan una **plantilla distinta** que reconoce la venta previa y se enfoca en verificar la dirección (saltarse la confirmación perdería la validación que sostiene el COD), y salen a los **10 minutos** en vez de 5. Crea dependencia: plantilla nueva con aprobación de Meta, en camino crítico.
- [Configuración de Sebastián: personas, descuentos y límites](issues/04-configuracion-de-sebastian.md) — **Una sola persona**. Configuración **híbrida**: estructurado lo que tiene consecuencia (nombre, mensajes base, límite de descuento) y campo libre para tono. El **descuento es regla dura aplicada en código** con el valor configurable desde el panel; fuera de rango la orden se crea al precio válido y escala a humano. `agent_settings` es fila única, así que Sebastián exige cambio de modelo de datos.
- [Reconocimiento de producto: ad-id o semántico](issues/02-reconocimiento-de-producto.md) — Cascada **fija** de tres niveles con el **ID de anuncio como primario**; lo decidió la ambigüedad, no la escala (cuatro SKUs REVITALHAIR de nombre casi idéntico concentran el 77% del volumen y el match semántico no los distingue). Anuncio→producto es **N:M**, así que no hace falta un concepto de "familia": los productos quedan 1:1 con Shopify. La atribución se persiste en el primer contacto. Vorare carga los IDs de anuncio. Sin perillas configurables.
- [Costos variables que asume Vorare](issues/05-costos-variables.md) — Kapso Pro $25/mes cubre todos los escenarios y pasa Meta a costo; Meta cobra por mensaje y el free entry point de CTWA da 72 h gratis; OpenRouter sale ~$0,017 por lead sobre el modelo **real** de producción (`gpt-5.4-mini`; la investigación asumió Sonnet 4.6 y sobrestimó ~4x — corregido en el ticket). Total mensual para Vorare: ~$84.100 COP a 100 leads, ~$185.900 a 2.000 — **siempre por debajo de la mensualidad, sin punto de quiebre**. Dos alertas vigentes: Meta sube tarifas el 1-oct-2026, y facturar Meta en COP cuesta 17,7% más que en USD.
- [Confirmar que Kapso entrega `referral` en el webhook](issues/01-referral-kapso.md) — Sí según la doc oficial de Kapso, no es bloqueante duro; pero la ruta exacta del campo no está en ninguna spec y se comprobó que el serializador recorta otros campos, así que queda pendiente verificarlo con un anuncio real. `referral` solo llega en el primer mensaje, nunca en respuestas interactivas: la atribución hay que persistirla en el primer contacto.

## Not yet specified

- **Seguimiento de leads fríos.** El PRD no dice qué hace Sebastián con un lead que conversa y no cierra. ¿Reintenta? ¿cuándo? ¿con plantilla, si ya cerró la ventana de 24 h? Es un hueco de alcance que el documento tendrá que cerrar o excluir explícitamente.
- **Cómo se mide la calidad de Sebastián.** El documento promete un vendedor. Qué se compromete sobre su desempeño — o qué explícitamente *no* se compromete — aparece al llegar a los criterios de aceptación.

## Out of scope

- **Pagos en línea** — el modelo es contraentrega (PRD §2).
- ~~**Handoff en un mismo número visible**~~ — **entró al alcance el 16-ago-2026.** Ventas y confirmación comparten número por operación. Consecuencia: el primer toque de Katherine cae **dentro** de la ventana de 24 h, así que es mensaje libre y no plantilla — desaparece la aprobación de Meta del camino crítico.
- ~~**Multi-tienda**~~ — **entró al alcance el 16-ago-2026.** Dos operaciones desde el día uno: Guatemala y Colombia.
- **Multi-cliente (LogiGho y otros)** — sigue fuera. Multi-**operación** para un mismo cliente no es lo mismo que multi-cliente.
- **Auto-registro de IDs de anuncio vía Meta Ads API** (PRD §2).
- **Creación automática de la orden en Dropi** — decidido al trazar el mapa: la guía nace hoy de una integración Shopify↔Dropi ajena a WaiChat y sigue igual. El documento describe el paso y lo excluye; construirlo sería un segundo integrador completo.
- **Mover a Katherine de `gpt-5.4-mini` a GPT-5.6 Luna** — apareció al decidir el modelo de Sebastián. Le cortaría el costo **7,5x** con un modelo de generación más nueva, y confirmar y clasificar es exactamente lo que Luna dice hacer bien. Es plata gratis para Vorare, pero en el **servicio que ya opera**, no en el módulo cotizado. Vale la pena hacerlo aparte.
- **Spec técnico interno como documento aparte** — decidido al trazar el mapa: el detalle técnico vive en estos tickets, no en un segundo documento que envejece en una semana.
