# Investigación — ¿La app de Meta puede ser multi-cliente? ¿Dos apps sobre una misma WABA?

Fecha: 2026-08-16
App en cuestión: **3918760311591600 — "CLAUDE VORARE GUATEMALA"**, hoy conectada al portafolio de negocio de Vorare.
Permisos actuales: `ads_management`, `ads_read`, `business_management`, `catalog_management`, `leads_retrieval`, `whatsapp_business_management`, `whatsapp_business_messaging`.
Fuentes: documentación oficial de Meta for Developers, Platform Terms y Developer Policies. **No se llamó a la Graph API ni se usaron credenciales** — es investigación documental.

> Nota de método: Meta reestructuró la documentación de WhatsApp hacia `/documentation/business-messaging/whatsapp/…`. Varias URLs conocidas ahora dan 404 o redirigen; abajo se citan las páginas canónicas vigentes al 16 de agosto de 2026.

---

## Respuesta corta

**Pregunta 1 — ¿Puede la app ser multi-cliente? Sí. Es un modelo que Meta documenta explícitamente y contempla en su contrato.** Se llama ser **Tech Provider** (Platform Terms §5.b). Kapso opera bajo exactamente ese modelo. **No hace falta** ser Meta Business Partner ni Solution Partner.

Pero hoy la app **no** es multi-cliente, y el muro es concreto: con **Standard Access** los permisos *"can only be requested from app users who have a role on the requesting app"* ([access levels](https://developers.facebook.com/docs/graph-api/overview/access-levels?locale=en_US)). Es decir: hoy solo funcionan para ustedes. Para que una empresa ajena conecte su ad account hacen falta cuatro cosas, ninguna opcional:

1. **Business Verification** del portafolio dueño de la app.
2. **App Review con Advanced Access** en los siete permisos (más uno que falta, ver abajo).
3. **Marketing API Access Tier → Full Access**, que exige **historial previo**: 500 llamadas en 15 días con <15 % de error.
4. **Aislamiento de datos por cliente** — obligación contractual, no preferencia de arquitectura.

⚠️ **Falta un permiso:** `whatsapp_business_manage_events` **no está en la lista actual** y es requisito para reportar conversiones CTWA por CAPI.

**Pregunta 2 — ¿Dos apps sobre la misma WABA? Sí, y con evidencia textual sólida.** La semántica del endpoint es inequívoca: `POST` *"Subscribe **your application**"*, `DELETE` *"Unsubscribe **your application**"*, `GET` *"Retrieve a list of **all applications** currently subscribed"*. **La suscripción es por par (app, WABA)** — el POST **añade**, no reemplaza, y **no existe operación alguna para desuscribir a un tercero.** Además Meta escribe, literal: los reintentos van *"to **all apps that have subscribed**"*.

**Y hay una vía aún más limpia de lo que parecía:** si la WABA es propiedad del portafolio de Vorare —el mismo al que ya está conectada la app de ustedes— **no se consume ningún cupo de partner**. Kapso ocupa un cupo como partner asignado; ustedes entran por la puerta del dueño, no por la de partner.

**Recomendación:** suscribir la app propia como segunda app, solo al campo `messages`, con callback propio. Kapso sigue operando intacto.

---

# PREGUNTA 1 — ¿Puede esa app ser multi-cliente?

## 1.1 Platform Terms §5.b: ustedes serían un "Tech Provider"

Las [Platform Terms](https://developers.facebook.com/terms/dfc_platform_terms/?locale=en_US) (vigentes desde el **3 de febrero de 2026**) tienen **una sección entera dedicada exactamente a este caso**: la §5.b, "Tech Providers". Esto es importante de entender bien: el modelo multi-cliente no es una zona gris que haya que justificar, es un escenario que el contrato nombra y regula.

**Definiciones del glosario:**

> **Tech Provider** (12.s): *"a Developer of an App whose primary purpose is to enable Users thereof to access and use Platform or Platform Data."*
>
> **Client** (12.e): *"the User of a Tech Provider's App."*

**No es un programa al que uno se postula.** Es una categoría contractual que aplica automáticamente en el momento en que otras empresas usan la app para acceder a la Plataforma. No hay badge, no hay aprobación, no hay solicitud — hay obligaciones.

### Las obligaciones de §5.b, textuales

| § | Texto (verbatim) | Qué significa en la práctica |
|---|---|---|
| **5.b.1** | *"You will only use Platform and Process Platform Data on behalf of and at the direction of your Client… ('Client's Purpose'), and **not for your own purposes or another Client's or entity's purposes**"* | Los datos de Vorare son de Vorare. No se usan para optimizar la cuenta de otro cliente, ni para benchmarks, ni para su propio producto. |
| **5.b.2** | *"You will ensure that Platform Data you maintain on behalf of one Client is **maintained separately** from that of other Clients"* | **Aislamiento por tenant en la base.** No una tabla común con `WHERE client_id=`. Esto es decisión de arquitectura y hay que tomarla antes del cliente #2. |
| **5.b.3** | *"You will maintain an **up-to-date list of your Clients** and their contact information and provide it to us if we ask for it"* | Hay que llevar un registro formal de clientes, entregable a Meta bajo demanda. |
| **5.b.4** | Solo puedes compartir Platform Data con el Cliente aplicable, cuando la ley lo exija, con tu propio Service Provider para el Client's Purpose, o con el proveedor del cliente si este lo indica | Nada de compartir datos lateralmente. |
| **5.b.5** | *"We may require that your Clients agree to these Terms or other applicable terms or policies in order to access Meta Products… through your App."* | El contrato con cada cliente debe poder incorporar los términos de Meta. |
| **5.b.6** | *"You will **promptly terminate a Client's use**… if we request it"* porque Meta cree que el cliente violó los términos o está afectando la Plataforma | Contractualmente hay que poder **cortarle el servicio a un cliente que paga** si Meta lo pide. Esto tiene que estar en el contrato comercial con cada cliente. |
| **5.b.7** | Notificar al cliente de cualquier comunicación de Meta sobre solicitudes de derechos de datos de un usuario | Proceso operativo, no solo código. |

### Reventa: qué está prohibido exactamente

**§2 (licencia):** *"limited, non-exclusive, non-sublicensable (except to Service Providers…), non-transferable, non-assignable license"* y **"You will not sell, transfer, or sublicense Platform to anyone."**

**§3:** prohibido *"Selling, licensing, or purchasing Platform Data."*

**Matiz que importa:** esto **no** prohíbe cobrar por su software. Prohíbe revender el acceso a la Plataforma *como tal* (vender llamadas a la API como commodity) y vender los datos de Meta. El modelo donde cada cliente conecta **sus propias** cuentas y ustedes cobran por su producto está expresamente contemplado en §5.b. La línea es: **cobran por el software, no por el acceso ni por los datos.**

### Tokens

**§6:** *"You must protect and **not transfer, share, or solicit** Meta user IDs, access tokens, or app secrets, but you may share with a Service Provider who helps you build, run, or operate your App."*

**Un token por cliente, siempre.** Prohibido usar el token del cliente A para operar sobre activos del cliente B. La única excepción es su propio proveedor de infraestructura (hosting, subprocesador) — no otro cliente.

### Business Tools Terms

Las [Business Tools Terms](https://www.facebook.com/legal/technology_terms) (vigentes desde el 3 de noviembre de 2025), §1.c, exigen que si usan o comparten datos en nombre de un tercero, ustedes declaran estar autorizados a hacerlo **y a vincular a ese tercero a los términos de Meta**. Traducción: el contrato comercial con cada cliente tiene que incorporar los términos de Meta por referencia.

## 1.2 Developer Policies — las reglas de anuncios que sorprenden

De [developers.facebook.com/devpolicy](https://developers.facebook.com/devpolicy/?locale=en_US). Hay varias que cambian decisiones de producto:

**5.3.b — Autoridad de agente:**
> *"Ensure you have the authority to act as an agent for the entity to which you're providing a service, and that your use of our Platform is strictly for the benefit of that entity."*

**10.4 — ⚠️ Se pierde el acceso por inactividad:**
> *"Standard and Advanced Ads API access may be **downgraded to Development access after 30 days of non-use**."*

Esto es una trampa real: si consiguen Full Access y luego pasan un mes sin llamadas de anuncios (por ejemplo entre el cliente 1 y el cliente 2), **pueden perder el acceso y tener que repetir el proceso**. Hay que mantener tráfico vivo.

**10.5 — ⚠️ Un ad account por anunciante:**
> *"**Don't combine multiple end advertisers** or their Meta business assets in the same ad account, unless you meet the requirements described here or as otherwise approved by Meta in writing."*

Descarta de plano cualquier idea de "una cuenta publicitaria nuestra donde corremos las campañas de todos". **Cada cliente usa su propio ad account**, y ustedes acceden por delegación.

**10.7.f:** *"Only allow the end advertiser or people acting on their behalf to access Meta's Platform data."*

**10.7.g:** *"Keep Meta's data that you maintain on behalf of one advertiser **separately** from that of other advertisers."* (Refuerza §5.b.2 desde otro ángulo.)

**10.7.a:** *"Don't use Meta advertising data for any purpose, except on an aggregate and anonymous basis."*

**10.6 — Transparencia (entra en vigor el 3 de febrero de 2027):** si el anunciante final lo pide, hay que revelarle *"the amount that you spent on Meta advertising on behalf of such end advertiser, **separate from your fees**, and the associated fee structure you charge"*, y *"Display Meta ad campaign reporting separately from other publishers."* Vale tenerlo en el radar si el modelo de negocio incluye gestionar pauta con margen.

**10.8:** los clientes deben aceptar los ToS de Meta y los términos suplementarios aplicables.

## 1.3 El muro técnico: Standard Access vs Advanced Access

Esta es la razón exacta por la que hoy la app no puede ser multi-cliente. De [Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels?locale=en_US):

> **Standard Access:** *"Permissions with Standard Access **can only be requested from app users who have a role on the requesting app**."* … *"Features with Standard Access are only active for app users who have a role on the app."*
>
> **Advanced Access:** *"Permissions with Advanced Access can be requested from **any app user**, and features with Advanced Access are active for all app users."*
>
> *"**Business Verification is required to get Advanced Access.**"*

Y de [App Review](https://developers.facebook.com/docs/app-review/?locale=en_US):

> *"If your app will be used by **anyone without a Role on the app** or a role in a Business that has claimed the app, it must first undergo App Review."*

Traducido: hoy, para que una empresa nueva conecte su cuenta, tendrían que agregar a alguien de esa empresa como Admin/Developer/Tester de la app — lo cual no escala y además le da visibilidad sobre la app entera. **Ese es el modelo que hay que romper, y App Review es la única forma.**

## 1.4 Qué permisos requieren App Review, uno por uno

Los siete permisos actuales requieren App Review y admiten Advanced Access ([Permissions Reference](https://developers.facebook.com/docs/permissions/?locale=en_US)):

| Permiso | Descripción oficial (verbatim) | Dependencias |
|---|---|---|
| `ads_management` | *"read and manage the ad accounts that belong to you **or that other account owners granted you access to**"* | `pages_read_engagement`, `pages_show_list` |
| `ads_read` | *"access the Ads Insights API to pull Ads report information for Ad accounts you own **or have been granted access to**"* | — |
| `business_management` | *"read and write with the Business Manager API"* | `pages_read_engagement`, `pages_show_list` |
| `catalog_management` | *"create, read, update and delete business-owned product catalogs"* | `business_management` |
| `leads_retrieval` | *"retrieve and read all information captured by a lead ads form"* — uso permitido incluye *"advertiser authorized CRM platforms to pull the lead data **on behalf of the advertisers**"* | — |
| `whatsapp_business_management` | *"read and/or manage WhatsApp business assets you own **or have been granted access to**"* | — |
| `whatsapp_business_messaging` | *"send WhatsApp messages and make calls, upload/retrieve media, manage profile info, and register phone numbers"* | `whatsapp_business_management` |

**Detalle que vale oro:** la redacción oficial de `ads_management`, `ads_read` y `whatsapp_business_management` dice explícitamente *"or that other account owners granted you access to"* / *"or have been granted access to"*. **El multi-cliente es el caso de uso previsto por el permiso**, no una interpretación forzada. Eso ayuda mucho al redactar la justificación de App Review.

**⚠️ Permiso faltante:** `whatsapp_business_manage_events`, requerido para CAPI de CTWA (ver §1.8). Hay que agregarlo a la solicitud.

**Qué pide Meta para aprobar `ads_management`** ([referencia](https://developers.facebook.com/docs/permissions/reference/ads_management?locale=en_US)) — uso permitido: *"Develop ad management tools offering innovative solutions and added value for advertisers"*. En la revisión piden *"specific examples of why your app needs to manage ads on behalf of other businesses"* más **tres screencasts**:

1. El flujo completo de login y concesión de permisos.
2. Cómo el negocio accede a sus datos de rendimiento tras conceder el permiso.
3. Que las métricas (impresiones, conversiones, clics, alcance) se muestren correctamente.

> **Decisión de alcance que vale la pena tomar antes de someter:** si el agente solo **lee** métricas y reporta conversiones —sin crear ni editar campañas— **`ads_read` basta y pueden dejar fuera `ads_management`**, que es la revisión más dura. Pedir menos permisos sube la tasa de aprobación y acorta el ciclo. Vale definir esto primero.

## 1.5 Business Verification

De [Business Verification](https://developers.facebook.com/docs/development/release/business-verification/):

> *"Apps that request advanced access for permissions and **apps that allow other Businesses to access their own data** must be connected to a Business that has completed Business Verification."*
>
> *"As of February 1, 2023, if your app requires advanced level access to permissions, you might need to complete Business Verification."*

Y la consecuencia de no hacerlo, textual: *"app users from other Businesses will be unable to grant these apps permissions and **all features will be inactive**."*

La excepción confirma exactamente dónde están hoy:

> *"If your app will **only** be used by app users who have a role on the app itself you do not need to complete verification."*

**Es obligatoria y es el paso más lento** (documentos legales, revisión humana). Se conecta la app en App Dashboard → Settings → Basic → Verification.

**La documentación no especifica** la lista exacta de documentos — remite al Business Manager Help Center.

## 1.6 Marketing API: Limited Access vs Full Access

Aparte del App Review de permisos, la Marketing API tiene **su propio nivel de acceso**. Esto se pasa por alto seguido. De [Marketing API Access](https://developers.facebook.com/docs/marketing-api/access?locale=en_US) y [Authorization](https://developers.facebook.com/docs/marketing-api/overview/authorization?locale=en_US):

> *"Ads Management Standard Access is now **Marketing API Access Tier**"*
>
> *"Tier labels have been updated: 'Standard Access' is now **Limited Access**, and 'Advanced Access' is now **Full Access**."*

| Tier | Rate limit (verbatim) |
|---|---|
| **Limited Access** (default al añadir el producto) | *"Heavily rate-limited per ad account. **For development only. Not for production apps running for live advertisers.**"* |
| **Full Access** | *"Lightly rate limited per ad account."* |

**La frase decisiva para esta pregunta:**

> *"If your app is **managing other people's ad accounts**, you need advanced access to the `ads_read` and/or `ads_management` permissions."*

**Requisitos para subir a Full Access — y tienen consecuencia de cronograma:**

> *"Have successfully made **at least 500 Marketing API calls in the last 15 days**."*
> *"Have made Marketing API calls with an **error rate of less than 15%** in the last 500 calls."*

**No se puede pedir Full Access el día uno.** Hay que acumular tráfico real con Vorare, limpio de errores, y *después* someter. Si el plan mental es "conseguimos el segundo cliente y entonces pedimos acceso", van a chocar con esto. **Empiecen a generar historial ahora.** Y recuerden 10.4: una vez conseguido, no lo dejen 30 días sin uso.

## 1.7 Tech Provider vs Solution Partner vs Meta Business Partner

Hay **dos cosas distintas que se llaman "Tech Provider"** y confundirlas cuesta tiempo:

### A) "Tech Provider" de las Platform Terms — aplica a toda la plataforma, anuncios incluidos

Es la categoría contractual de §5.b (ver §1.1). **Automática, ineludible, sin postulación.** Es la que les aplica.

### B) "Tech Provider" de WhatsApp Business Platform — un rol específico de WABP

De [Solution Providers Overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview):

| | Solution Partner | **Tech Provider** | Tech Partner |
|---|---|---|---|
| Gama completa de servicios WABP | Sí | **Sí** | Sí |
| Línea de crédito | Sí | **No** | No |
| Factura directo al cliente el uso de API | Sí | **No** | No |
| Es Meta Business Partner | Sí | **No** | Sí |
| Programa acelerador SMB | Sí | **No** | Sí |

> **Solution Partner:** *"Meta Business Partners that provide a full range of WhatsApp Business Platform services to other businesses (clients), such as messaging services, billing, integration support, and customer support."*
>
> **Tech Provider:** *"offer a full range of WhatsApp Business Platform services to other businesses, either by providing these services on their own, or by partnering with a Solution Partner."*

Sobre facturación: el Tech Provider no cobra el consumo — *"Meta will then bill these clients for API usage, and the Tech Provider will bill for other services."* Cada cliente pone su propio método de pago.

**Y la propia doc recomienda la ruta de ustedes:**

> *"Becoming a Solution Partner is **a lengthy process**, so if you don't need a credit line and don't need to invoice your clients for API usage directly, **consider becoming a Tech Provider instead**."*

Para convertirse en Tech Provider de WABP basta Business Verification + App Review de `whatsapp_business_messaging` y `whatsapp_business_management` ([Get started for Tech Providers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)).

### ¿Es lo mismo el Tech Provider de WhatsApp que un partner de anuncios? **No.**

Son pistas separadas. Para anuncios **no existe un rol con nombre propio**: lo que aplica es Advanced Access en `ads_management`/`ads_read`/`business_management` + Marketing API Access Tier. Conseguir el rol de WhatsApp no les da nada del lado de anuncios, y viceversa. **Hay que hacer las dos.**

### ¿Hace falta ser Meta Business Partner? **No.**

El [programa Meta Business Partners](https://www.facebook.com/business/marketing-partners/become-a-partner/) es de reconocimiento comercial; la elegibilidad *"varies by solution type, and is typically a combination of the quantity and quality of your company's work across Meta technologies"*. **Nada en las Platform Terms, los Developer Policies ni los docs de Marketing API lo exige** para administrar anuncios de terceros. No otorga ningún permiso técnico. Es opcional: sirve para credibilidad comercial y, vía Solution Partner, línea de crédito.

## 1.8 El flujo correcto para que un tercero conecte su cuenta

**Facebook Login for Business.** De la [documentación oficial](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business?locale=en_US):

> *"Facebook Login for Business is **the preferred authentication and authorization solution for tech providers** building integrations with Meta's business tools to create marketing, messaging, and selling solutions."*

Es explícitamente para *"businesses that you do not own or manage"*.

**Requisito previo:** *"Your Meta app must be a **business type app**."* — verifiquen esto primero en la app 3918760311591600.

### La "configuration"

Un setup de login guardado en el App Dashboard donde se especifica *"the access token type, assets, and permissions your app needs"*. Produce un **Configuration ID** que se pasa al diálogo de login como `config_id`.

**Se pueden tener varias configurations** y mostrar distintas a distintos clientes. Esto es directamente útil: una config solo-WhatsApp para clientes que únicamente quieren mensajería, y otra con `ads_management` + `business_management` para los que además quieren anuncios. Permite vender por niveles sin pedirle a todos los permisos más invasivos.

### Los dos tipos de token

| Tipo | Cuándo usarlo (verbatim) |
|---|---|
| **User access token** | *"should be used if your app takes actions in real time, based on input from the user."* |
| **Business integration system user access token** | *"should be used if your app performs **programmatic, automated actions on your business clients' assets without having to rely on input from an app user**."* |

El segundo está *"associated with your business client's business portfolio rather than a specific user"* y **"defaults to never expire."**

**Para un backend que corre 24/7 el correcto es el business integration system user access token.** No depende de que un empleado del cliente siga en la empresa, y no expira.

**Alcance:** *"Your app can only access the assets that were designated by your business client when they completed the Facebook Login for Business flow."*

**Revocación:** el cliente puede invalidarlo en Business Manager → Settings → Business Settings → Integrations → Connected apps.

### Comparación con las alternativas

| Opción | ¿Sirve? | Por qué |
|---|---|---|
| **Facebook Login for Business** | **Sí — es la recomendada por Meta** | Diseñada para tech providers sobre activos ajenos. Token de sistema por cliente, no atado a una persona, sin expiración. |
| **System User creado a mano** en el BM del cliente | Funciona, es el fallback | Exige pasos manuales de alguien del cliente en Business Settings. Sirve para el cliente #1, no para el #10. Útil para clientes técnicos. |
| **Facebook Login clásico** (token de usuario) | **No** | El token muere cuando esa persona cambia de contraseña, deja la empresa o revoca sesión. Causa #1 de integraciones que se caen solas. |
| **WhatsApp Embedded Signup** | **Sí, pero resuelve otra pieza** | Onboardea la **WABA y el número**. Es FLB bajo el capó con una config específica. Complementario, no sustituto: no resuelve ad accounts ni portafolio. |

### ⚠️ Límites de onboarding de Embedded Signup

De [Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/) — dato de capacidad que conviene tener en el plan:

> *"By default, you can onboard **up to 10 new business customers in a rolling 7-day window**."*

Sube a **200 por semana** al completar *"Business Verification, App Review, and **Access Verification**"*. Nótese que **Access Verification es un tercer trámite**, distinto de los otros dos.

Y confirma la dependencia dura:

> *"You will **not be able to onboard business customers** until your app has been approved for advanced access for each of the permissions it requires."*
>
> *"Once you switch your app to live mode, **only permissions that have been approved for advanced access** through the App Review process will appear in the flow."*

## 1.9 Restricciones, límites y carga operativa recurrente

### Rate limits: qué escala y qué no

De [Rate Limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting?locale=en_US):

- **Nivel app (Platform):** `Calls within one hour = 200 * Number of Users`. **Crecer en clientes aumenta la cuota**, no la reduce.
- **Business Use Case (Marketing API):** *"the rate limit is applied to **the ad account** across the same Business Use Case."* Ejemplo Ads Management: `300 + 40 * Number of Active ads` por hora.

**Conclusión tranquilizadora:** los límites de Marketing API son **por ad account del cliente**, no un pool compartido de la app. Un cliente pesado no ahoga a los demás. Esa es precisamente la razón por la que el modelo multi-tenant escala.

### Prohibiciones duras — resumen

| Prohibición | Fuente |
|---|---|
| Compartir/transferir tokens o app secrets entre clientes | Platform Terms §6 |
| Usar datos de un cliente para otro cliente o para uno mismo | Platform Terms §5.b.1 |
| Mezclar datos de distintos clientes sin separación | Platform Terms §5.b.2 · Dev Policies 10.7.g |
| Que alguien distinto al anunciante final acceda a sus datos | Dev Policies 10.7.f |
| Meter varios anunciantes finales en el mismo ad account | Dev Policies 10.5 |
| Vender, transferir o sublicenciar la Plataforma | Platform Terms §2 |
| Vender, licenciar o comprar Platform Data | Platform Terms §3 |
| Dejar el acceso Ads API 30 días sin uso (se degrada) | Dev Policies 10.4 |

### Auditorías anuales — carga permanente, no trámite único

- **Data Use Checkup (DUC)** — [docs](https://developers.facebook.com/docs/development/maintaining-data-access/data-use-checkup?locale=en_US): *"An annual assessment that evaluates whether a developer's continued use of and access to specific data via Meta APIs is in compliance."* Aplica a apps live con Advanced Access. Sin completarlo, se pierde el acceso.
- **Data Protection Assessment (DPA)** — [docs](https://developers.facebook.com/docs/development/maintaining-data-access/data-protection-assessment?locale=en_US): *"an annual requirement for apps accessing certain types of data."* Los admins reciben *"60 days to complete the assessment or risk losing platform access."* Pregunta por cifrado en reposo y tránsito, control de accesos, retención y **separación por tenant** — justo lo de §5.b.2.

**La documentación no especifica** qué permisos exactos disparan el DPA. Con Advanced Access en siete permisos de negocio sobre datos de terceros, conviene asumir que sí.

## 1.10 CAPI para CTWA en modo multi-cliente

Hay una diferencia relevante entre CAPI genérico y CAPI para mensajería.

**CAPI estándar (web), anunciante directo** — [Get Started](https://developers.facebook.com/docs/marketing-api/conversions-api/get-started?locale=en_US): *"Your app does not need to go through App Review. You do not need to request any permissions."* **Pero advierte:** *"If you are a third-party partner offering Conversions API functionalities for advertisers, there are different requirements."*

**CAPI como partner tercero** — [implementación end-to-end](https://developers.facebook.com/docs/marketing-api/conversions-api/guides/end-to-end-implementation?locale=en_US): requiere `ads_management` **o** `business_management`, más `pages_read_engagement` y `ads_read`, todos en **Full Access**, más el feature Marketing API Access Tier. El cliente comparte su dataset con el Business Manager del partner, que asigna su system user al pixel y genera el token.

> ⚠️ *"The token **can't be used to run API GET data requests**."* — el token de CAPI del cliente sirve para **enviar**, no para leer.

**CAPI for Business Messaging (el caso CTWA)** — [docs](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/):

> *"The Conversions API is a Meta Business Tool that lets **Business Messaging Partners share their clients' data**, for which they have permissions, directly from their servers."*

- **Permisos:** `whatsapp_business_management` + **`whatsapp_business_manage_events`** + feature Marketing API Access Tier. **El segundo falta hoy.**
- **Propiedad del dataset:** *"The business owns the dataset, and if the business is working with a partner, access to the dataset will also be granted to the partner."* Cada cliente tiene **su propio dataset** — coherente con §5.b.2.
- **Identificación del partner:** los partners incluyen **`partner_agent`** en las llamadas. Meta contempla y espera el modelo multi-cliente.
- **Formato:** `"action_source": "business_messaging"`, `"messaging_channel": "whatsapp"`, `ctwa_clid` en `user_data` **sin hashear** ([parámetros](https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters)).
- **Origen del `ctwa_clid`:** *"obtained from the **referral object** under **Messages webhook**."* — **esto ata la Pregunta 2 a la Pregunta 1: sin el `referral` del webhook, no hay CAPI.**
- **Automatic Events API** ([docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/automatic-events-api)): si el cliente opta, Meta analiza con regex y NLP los hilos originados en CTWA y dispara un webhook `automatic_events` con eventos de lead/compra detectados.

## Recomendación — Pregunta 1

**Sí es viable y es el camino correcto. No hay obstáculo contractual ni técnico — Kapso opera exactamente bajo el modelo de §5.b.** La barrera es operativa y toma semanas. El orden importa:

1. **Hoy: iniciar Business Verification.** Es el paso más lento y bloquea todo. No esperen a tener el segundo cliente.
2. **Hoy: empezar a acumular historial de Marketing API con Vorare** — 500+ llamadas en 15 días con <15 % de error. Es prerequisito de Full Access y no se puede acelerar después.
3. **Verificar que la app sea de tipo Business** (requisito de FLB). Si no lo es, resolverlo antes de invertir en lo demás.
4. **Decidir el set mínimo de permisos.** Si el agente no crea campañas, **quiten `ads_management`** y pidan solo `ads_read`. Menos permisos = revisión más rápida y más probable.
5. **Agregar `whatsapp_business_manage_events`** — falta y es requisito de CAPI para CTWA.
6. **Rediseñar el almacenamiento con aislamiento por tenant antes del cliente #2.** Es obligación contractual (§5.b.2), la audita el DPA, y reacomodarlo con clientes en producción es mucho más caro.
7. **Ajustar el contrato comercial:** debe vincular al cliente a los términos de Meta (§5.b.5, Business Tools §1.c) y permitir terminación a petición de Meta (§5.b.6).
8. **Someter App Review** con los tres screencasts y justificación de "on behalf of other businesses".
9. **Completar Access Verification** para subir el límite de onboarding de 10 a 200 por semana.
10. **Calendarizar DUC y DPA anuales**, y no dejar la Ads API 30 días sin uso.

**No hace falta** ser Meta Business Partner ni Solution Partner. Nadie los tiene que "aceptar" como partner.

---

# PREGUNTA 2 — ¿Pueden dos apps recibir los webhooks de una misma WABA?

## 2.1 Respuesta: sí. La semántica del endpoint lo dice sola

La evidencia más fuerte está en cómo Meta redacta cada verbo del endpoint ([Subscribed Apps API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/subscribed-apps-api)):

| Verbo | Texto oficial |
|---|---|
| `POST` | *"Subscribe **your application** to webhook events for the specified WhatsApp Business Account."* |
| `GET` | *"Retrieve a list of **all applications** currently subscribed to webhook events for the specified WhatsApp Business Account."* |
| `DELETE` | *"Unsubscribe **your application** from webhook events for the specified WhatsApp Business Account."* |

**El sujeto de POST y DELETE es siempre "your application" — nunca la WABA.** No existe parámetro para desuscribir a un tercero, ni PATCH, ni nada que toque a otra app. **La suscripción es por par (app, WABA), y el POST añade.**

**Confirmación estructural:** el GET devuelve un **array**:

```json
{
  "data": [
    {
      "whatsapp_business_api_data": { "id": "string", "name": "string", "link": "string" },
      "override_callback_uri": "string"
    }
  ]
}
```

La [referencia Graph API clásica](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/subscribed_apps/) lo confirma: *"Get a list of apps subscribed to webhooks for the WABA"*, donde `data` es *"A list of WhatsAppApplication nodes"*, con `paging`. **Un recurso exclusivo de una sola app no se pagina, y no lleva `override_callback_uri` por entrada.**

**Confirmación explícita en la doc de webhooks** ([overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview)):

> *"Meta sends retries to **all apps that have subscribed** to webhooks (and their appropriate fields) for the WhatsApp Business account. These retries can result in duplicate webhook notifications."*

**Confirmación por diseño de producto:** existe un documento entero de [Multi-Partner Solutions](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/multi-partner-solutions) cuyo propósito es que *"Solution Partners and Tech Providers **jointly** manage client WhatsApp assets"*. El escenario de dos proveedores sobre una WABA es un caso soportado, no un hack.

Y de la [guía para proveedores](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/manage-webhooks): *"You must **individually subscribe to every WABA** for which you want to receive webhooks."* — refuerza que la suscripción vive en el par (app, WABA).

⚠️ **Hallazgo honesto:** Meta **nunca escribe una frase del tipo "múltiples apps pueden estar suscritas simultáneamente"** en la referencia del endpoint, ni documenta un **número máximo** de apps. La conclusión es una inferencia muy sólida (semántica de los verbos + array paginado + `override_callback_uri` por entrada + frase de reintentos + Multi-Partner Solutions), pero es inferencia. **Verifíquenlo empíricamente** (ver §2.6).

## 2.2 El límite real está en el acceso al asset, no en el endpoint

De [WhatsApp Business Accounts](https://developers.facebook.com/documentation/business-messaging/whatsapp/whatsapp-business-accounts):

> *"A WABA must belong to **only one** business portfolio. You cannot have two or more portfolios owning one WABA."*
>
> *"You can **share a WABA with up to two partners**."*

Esto abre **dos escenarios muy distintos**, y conviene averiguar cuál aplica antes de mover nada:

### Escenario A — la WABA es propiedad del portafolio de Vorare (probable)

La app de ustedes **ya está conectada al portafolio de Vorare**. Si ese portafolio es el dueño de la WABA, entonces el acceso les llega **por la puerta del dueño**, no por la de partner. Kapso ocupa uno de los dos cupos de partner; ustedes **no consumen ninguno**. Camino limpio: crear/usar su app dentro de ese portafolio, generar un system user token con los permisos, y suscribirse.

### Escenario B — la WABA la creó/posee Kapso

Entonces hay que compartirla con el portafolio de ustedes, **ocupando el segundo y último cupo de partner**. Funciona, pero deja la WABA sin margen: si mañana Vorare contrata otra herramienta, alguien tiene que salir. Vale que el cliente lo sepa.

**Cómo distinguirlos:** comparando `GET /{business-id}/owned_whatsapp_business_accounts` contra `client_whatsapp_business_accounts`. *(Requiere credenciales — queda fuera de esta investigación documental; es el primer paso de la implementación.)*

**Cómo compartir, si toca el escenario B** (lo ejecuta el dueño de la WABA en Meta Business Suite): Settings (engranaje) → **Accounts** → **WhatsApp accounts** → seleccionar la WABA → **Details** → **"Assign partner"** → business portfolio ID de ustedes → toggles de permisos → **Assign**.

Nota, por si algún día son Solution Partner: *"If you are sharing your WABA with a Solution Partner (a type of partner who has a credit line), they must share their credit line with you before you will be able to use their app to send messages."* No les aplica: ustedes solo van a **leer**.

**No hace falta "claim" de la WABA** — basta acceso compartido con los permisos correctos sobre el token.

> Dato de contexto: el modelo **On-Behalf-Of (OBO) está deprecado** — *"We have deprecated the On-Behalf-Of ('OBO') account ownership model"*, reemplazado por partner-initiated WABA creation ([docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/obo-model-deprecation)). No construyan sobre OBO.

## 2.3 Permisos necesarios para la segunda app

De [Set up Webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks), textual:

> *"**whatsapp_business_messaging** — for **messages** webhooks"*
> *"**whatsapp_business_management** — for all other webhooks."*

**Corrección importante respecto de la intuición habitual:** para capturar `referral` —que viaja **dentro** del campo `messages`— el permiso crítico es **`whatsapp_business_messaging`**, no `whatsapp_business_management`. Este último hace falta para el resto de campos y para operar sobre la WABA.

Un system user token necesita que se le asignen `business_management`, `whatsapp_business_management` y `whatsapp_business_messaging` ([Access Tokens](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/)).

## 2.4 Cómo suscribirse, y por qué solo al campo `messages`

```bash
curl -X POST 'https://graph.facebook.com/<API_VERSION>/<WABA_ID>/subscribed_apps' \
  -H 'Authorization: Bearer <ACCESS_TOKEN>'
# → {"success": true}
```

- **El token determina qué app se suscribe.** No se pasa `app_id`: Meta lo deduce del token. Por eso la llamada **no puede tocar la suscripción de Kapso** — ni siquiera la nombra.
- **Body opcional:** solo `override_callback_uri` y `verify_token`.
- **Los campos suscritos NO se eligen aquí.** Se eligen por app en el dashboard: *"use the **App Dashboard > WhatsApp > Configuration** panel to subscribe to individual webhook fields."* Como los campos son configuración **de la app** y no de la WABA, ustedes marcan **solo `messages`** y dejan sin marcar `message_template_status_update`, `account_update`, `phone_number_quality_update`, etc. **La configuración de Kapso queda intacta.**
- **Consecuencia a tener en cuenta:** el campo `messages` trae también los `statuses` de mensajes salientes. Si solo quieren el referral, filtren en su endpoint por presencia de `messages[].referral`.

## 2.5 ¿Puede esto romper a Kapso? No — y estas son las razones

1. **La suscripción es por par (app, WABA).** POST y DELETE están redactados sobre *"your application"*; no hay operación que afecte a otra app.
2. **Cada app tiene su propio callback.** De [webhook overrides](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override/): la resolución evalúa *"if **your app** has designated an alternate callback URL"*, en orden teléfono → WABA → callback por defecto de la app. **El override que Kapso tenga puesto no afecta la entrega hacia la app de ustedes.**
3. **La doc de reintentos ya asume el escenario multi-app.**
4. **Ustedes solo tocan `messages`** — ningún campo operativo del que dependa Kapso.

**Riesgos reales, que sí existen pero son operativos:**

- ⚠️ **El POST valida el callback.** Error 422: *"Webhook callback URL is not reachable or invalid"*. **Su endpoint debe estar arriba y verificado ANTES de suscribir.**
- **Duplicados:** van a recibir eventos que Kapso también procesa, más reintentos. **Deduplicar por `messages[].id`** e implementar el endpoint idempotente.
- **Cupo de partners** (solo en el escenario B): si ya hay dos partners asignados, no cabe un tercero.
- **Limitación documentada:** template webhooks y account-level webhooks **no soportan overrides** — siempre van al callback por defecto de la app.
- Si el tooling de Kapso re-ejecuta un onboarding que llame `DELETE` con **su** token, solo se borra a sí mismo. El riesgo inverso también aplica: cuidado con scripts propios que llamen DELETE.

## 2.6 El objeto `referral` — lista oficial completa

Fuente canónica: [webhook de mensajes de texto](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text). Ubicación: `entry[].changes[].value.messages[].referral`.

| Campo | Descripción oficial |
|---|---|
| `source_url` | *"Click to WhatsApp ad URL"* |
| `source_id` | *"Click to WhatsApp ad ID"* — **el ID del anuncio** |
| `source_type` | Siempre `"ad"` |
| `body` | *"Click to WhatsApp ad primary text"* |
| `headline` | *"Click to WhatsApp ad headline"* |
| `media_type` | `"image"` o `"video"` |
| `image_url` | *"Only included if the ad is an image ad"* |
| `video_url` | *"Only included if ad is a video ad"* |
| `thumbnail_url` | *"Only included if ad is a video ad"* |
| `ctwa_clid` | *"Click to WhatsApp ad click ID. The `ctwa_clid` property is **omitted entirely for messages originating from an ad in WhatsApp Status**"* |
| `welcome_message` | Objeto con `text`: *"Click to WhatsApp ad greeting text"* |

`referral` puede acompañar **cualquier tipo** de mensaje entrante: text, location, contact, image, video, document, voice y sticker.

**La lista que el equipo enumeró coincide 1:1 con la oficial** — es decir, el serializador de Kapso está recortando **todos** los campos publicitarios, no un subconjunto marginal.

## 2.7 Alternativas, y una ausencia crítica

### ❌ No existe forma de recuperar el `referral` después del hecho

Esto es un hallazgo explícito, buscado y confirmado, no una omisión:

- **No hay endpoint de lectura sobre `/{message-id}`.** La Message API de Cloud API es de **envío**, no de consulta de histórico.
- La doc de CAPI señala la webhook como **única** fuente: *"The `ctwa_clid` field is obtained from the **referral object** under **Messages webhook**."*
- Meta retiene mensajes internamente hasta 30 días *"in order to provide the base features and functionality of the Cloud API service; for example, retransmissions"*, pero **no expone API de lectura** de ese almacenamiento ([data privacy](https://developers.facebook.com/documentation/business-messaging/whatsapp/data-privacy-and-security/)).

**Si el payload no se captura en el momento de la webhook, el `ctwa_clid` se pierde de forma irrecuperable.** Y sin `ctwa_clid` no hay CAPI, no hay atribución, y la pauta se optimiza a ciegas. **Esto eleva la prioridad: hay que resolver la captura antes de gastar en anuncios**, no después.

### Alternativas, ordenadas

| Alternativa | Veredicto |
|---|---|
| **Webhook `kind: "meta"` de Kapso** | **Probar esto PRIMERO.** Kapso documenta que reenvía *"the exact payload received from Meta, without modification"* — ya verificado en [`01-referral-kapso.md`](./01-referral-kapso.md). Cero riesgo, cero coordinación con el cliente, cero trámites. Si funciona, el problema está resuelto. |
| **Segunda app suscrita a la WABA** | **La solución limpia si lo anterior falla.** Payload de Meta directo, sin depender de decisiones de producto de un tercero. |
| **Webhook `automatic_events`** | **Parcial — red de seguridad, no fuente primaria.** [Existe](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/automatic_events) y entrega `{ id, event_name, timestamp, ctwa_clid, custom_data }` para eventos de lead/compra que Meta detecta en hilos CTWA. Pero: (a) requiere optar por "Automatic Events reporting", (b) da el `ctwa_clid` y **no** el resto del referral (`source_id`, `headline`…), y (c) el `ctwa_clid` **se omite** en placements de WhatsApp Status. |
| **`override_callback_uri` a nivel WABA** | ❌ **No — es peligroso.** Redirige los webhooks **de Kapso** a la URL de ustedes. Eso **sí** rompería al proveedor. No confundir con suscribir una segunda app. |

## 2.8 Changelog

- El [changelog de Graph API](https://developers.facebook.com/docs/graph-api/changelog) es solo un índice de versiones; **no hay ninguna entrada** sobre `subscribed_apps`, suscripciones multi-app ni `override_callback_uri`.
- El changelog específico de WhatsApp devolvió **HTTP 500** de forma consistente durante la investigación; no se pudo auditar.

**No hay evidencia documental de cambios que restrinjan o habiliten explícitamente la suscripción multi-app.** El comportamiento parece estable de larga data, pero no se pudo confirmar vía changelog.

## Recomendación — Pregunta 2

**Sí es posible. Hay dos caminos; prueben el barato primero.**

1. **Primero: el webhook `kind: "meta"` de Kapso.** Cero riesgo y ya documentado que preserva el payload íntegro. Si funciona, no hay que tocar nada más.
2. **Si falla: segunda app suscrita a la WABA.** Pasos, en orden:
   - **Determinar el escenario** (A o B): `GET /{business-id}/owned_whatsapp_business_accounts` vs `client_whatsapp_business_accounts`. Si la WABA es del portafolio de Vorare, no se consume cupo de partner.
   - **Levantar y verificar el callback ANTES** de suscribir — el POST valida y falla con 422 si no responde.
   - En App Dashboard → WhatsApp → Configuration, marcar **solo `messages`**.
   - `GET /{WABA_ID}/subscribed_apps` para **registrar el estado previo**.
   - `POST /{WABA_ID}/subscribed_apps` con system user token propio (`whatsapp_business_messaging` + `whatsapp_business_management`).
   - `GET` de nuevo: **deben aparecer dos entradas en `data`** (Kapso + la suya). **Esa lista es la comprobación empírica definitiva.** Si sale una sola, revertir.
   - **No** setear `override_callback_uri` a nivel WABA salvo necesidad real.
   - Endpoint **idempotente por `messages[].id`**.
3. **En ambos casos: persistir el objeto `referral` completo apenas llegue** — crudo, no solo los campos que hoy parecen necesarios. No hay forma de recuperarlo después.

**No hace falta desconectar a Kapso en ningún escenario.**

---

## Lo que la documentación NO especifica

Los puntos donde una suposición saldría cara:

**Pregunta 1**
- Los **documentos exactos** para Business Verification (remite al Help Center).
- **Qué permisos concretos disparan el DPA.**
- Los *"requirements described here"* de Dev Policies 10.5 para combinar varios anunciantes en un ad account.
- Si `leads_retrieval` tiene requisitos adicionales más allá de la regla general.
- Los criterios cuantitativos de elegibilidad de Meta Business Partners (*"varies by solution type"*).
- Si `whatsapp_business_manage_events` requiere Business Verification aparte.
- Las etiquetas "Business Login for Direct Business" / "for Tech Providers" **no aparecen** como categorías formales en la página principal de FLB; la distinción documentada es **por tipo de token**.
- **Tiempos de App Review** — no publicados.

**Pregunta 2**
- ⚠️ **Meta nunca afirma literalmente que múltiples apps puedan estar suscritas a la vez**, ni documenta un máximo. La conclusión es inferencia sólida sobre la semántica del API. **Hay que verificarla con el `GET` antes/después.**
- **No se documenta si el POST es idempotente** ni qué pasa si la app ya estaba suscrita.
- **No se documenta si "dos partners" y "N apps suscritas" son el mismo contador** o límites distintos.
- **No existe endpoint para recuperar el `referral` de un mensaje pasado** — ausencia buscada y confirmada, y la más consecuente de esta lista.
- El changelog de WhatsApp no se pudo auditar (HTTP 500).

---

## Fuentes

**Platform Terms y políticas**
[Platform Terms (vig. 3-feb-2026)](https://developers.facebook.com/terms/dfc_platform_terms/?locale=en_US) ·
[Developer Policies](https://developers.facebook.com/devpolicy/?locale=en_US) ·
[Business Tools Terms](https://www.facebook.com/legal/technology_terms) ·
[Data Use Checkup](https://developers.facebook.com/docs/development/maintaining-data-access/data-use-checkup?locale=en_US) ·
[Data Protection Assessment](https://developers.facebook.com/docs/development/maintaining-data-access/data-protection-assessment?locale=en_US)

**Acceso, revisión y verificación**
[Niveles de acceso](https://developers.facebook.com/docs/graph-api/overview/access-levels?locale=en_US) ·
[Referencia de permisos](https://developers.facebook.com/docs/permissions/?locale=en_US) ·
[`ads_management`](https://developers.facebook.com/docs/permissions/reference/ads_management?locale=en_US) ·
[App Review](https://developers.facebook.com/docs/app-review/?locale=en_US) ·
[Business Verification](https://developers.facebook.com/docs/development/release/business-verification/) ·
[Rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting?locale=en_US)

**Marketing API y CAPI**
[Marketing API Access](https://developers.facebook.com/docs/marketing-api/access?locale=en_US) ·
[Authorization](https://developers.facebook.com/docs/marketing-api/overview/authorization?locale=en_US) ·
[CAPI Get Started](https://developers.facebook.com/docs/marketing-api/conversions-api/get-started?locale=en_US) ·
[CAPI end-to-end (partners)](https://developers.facebook.com/docs/marketing-api/conversions-api/guides/end-to-end-implementation?locale=en_US) ·
[CAPI for Business Messaging](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/) ·
[Parámetros de CAPI](https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters) ·
[Click to WhatsApp (Marketing API)](https://developers.facebook.com/documentation/ads-commerce/marketing-api/ad-creative/messaging-ads/click-to-whatsapp)

**Onboarding de terceros**
[Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business?locale=en_US) ·
[WhatsApp Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/) ·
[Automatic Events API](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/automatic-events-api)

**WhatsApp: WABAs, partners y webhooks**
[WhatsApp Business Accounts (compartir con partners)](https://developers.facebook.com/documentation/business-messaging/whatsapp/whatsapp-business-accounts) ·
[Solution Partner vs Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview) ·
[Get started for Tech Providers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers) ·
[Multi-Partner Solutions](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/multi-partner-solutions) ·
[OBO deprecation](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/obo-model-deprecation) ·
[Managing webhooks (proveedores)](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/manage-webhooks) ·
[Webhooks overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview) ·
[Set up Webhooks (permisos por campo)](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks) ·
[Webhook overrides](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override/) ·
[Subscribed Apps API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/subscribed-apps-api) ·
[`/{waba-id}/subscribed_apps` (Graph API)](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/subscribed_apps/) ·
[Webhook de mensajes de texto (`referral`)](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text) ·
[Webhook `automatic_events`](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/automatic_events) ·
[Access tokens](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/) ·
[Data privacy and security](https://developers.facebook.com/documentation/business-messaging/whatsapp/data-privacy-and-security/)

**Investigación previa en este repo**
[`01-referral-kapso.md`](./01-referral-kapso.md) — el webhook `kind: "meta"` de Kapso y el payload crudo.
