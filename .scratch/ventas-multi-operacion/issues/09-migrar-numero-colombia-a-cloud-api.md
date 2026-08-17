# 09 — Migrar el número de Colombia a Cloud API

**What to build:** El número colombiano queda operativo en Cloud API, que es la única forma en que el sistema puede usarlo.

**No es código: es trámite con Meta, y tiene espera externa.** Arranca de inmediato, en paralelo con todo lo demás — es lo único del proyecto que no se acelera trabajando más rápido.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

Verificado contra la Graph API el 16-ago-2026: el número **+57 304 5430173** ya existe, en la WABA «Vorare Living» (`1301601911943339`, moneda COP). Pero está registrado en **ON_PREMISE**, no en Cloud API — y la API On-Premises está descontinuada.

- [ ] Se confirma si el número está realmente en uso o es un registro heredado sin actividad.
- [ ] El número queda registrado y verificado en **Cloud API**.
- [ ] Queda con calidad de mensajería sana, comparable a la del número guatemalteco (que hoy está en verde).
- [ ] Queda claro **qué WABA** va a alojarlo definitivamente: hay cuatro bajo el portafolio Vorare y conviene no dejarlo en la equivocada.
- [ ] Se documenta el procedimiento seguido, porque es el mismo que haría falta para un tercer país.

**Nota:** las otras dos WABAs guatemaltecas (+502 5946 7118 y +502 4722 4176) también están en ON_PREMISE. Vale confirmar si son registros muertos antes de que alguien los tome por operativos.

## Answer (parcial) — verificado contra la Graph API el 16-ago-2026, solo lectura

Token de usuario de la app **CLAUDE VORARE GUATEMALA** (`3918760311591600`), sin expiración, válido. Scopes confirmados: `ads_management`, `ads_read`, `business_management`, `catalog_management`, `leads_retrieval`, `whatsapp_business_management`, `whatsapp_business_messaging` — **y no `whatsapp_business_manage_events`**, lo que confirma por medición, y ya no solo por investigación, que CAPI sobre anuncios CTWA está bloqueado por permiso (asunto de `ventas-capi`).

### Los cinco números del portafolio Vorare, completos

Las **cuatro WABAs** cuelgan del portafolio **Vorare** (`2036295690245421`, `verified`), y las cuatro están en `account_review_status: APPROVED` y `business_verification_status: verified`.

| WABA | Moneda | Número | phone id | Plataforma | Estado | Calidad |
| -- | -- | -- | -- | -- | -- | -- |
| Vorare `1676368750161510` | USD | **+502 3689 0343** | `1226267277233200` | **CLOUD_API** | **CONNECTED** | **GREEN** |
| Vorare `1676368750161510` | USD | +502 5946 7118 | `997437023462377` | NOT_APPLICABLE | PENDING | UNKNOWN |
| Tienda Vorare `1234095348671288` | — | +502 5946 7118 | `993189033885747` | ON_PREMISE | DISCONNECTED | UNKNOWN |
| Vorare Store Guatemala `888601147047306` | — | +502 4722 4176 | `1275213219002737` | ON_PREMISE | **CONNECTED** | UNKNOWN |
| Vorare Living `1301601911943339` | COP | **+57 304 5430173** | `1101476763057048` | ON_PREMISE | DISCONNECTED | UNKNOWN |

### Criterio 1 — resuelto: el número colombiano es un registro heredado sin actividad

`status: DISCONNECTED` · `code_verification_status: NOT_VERIFIED` · `quality_rating: UNKNOWN` · `throughput.level: NOT_APPLICABLE`. Nunca llegó a operar. **Migrarlo no interrumpe nada** — que era el riesgo que justificaba preguntar antes de tocarlo.

### Criterio 4 — resuelto: se queda donde está, en «Vorare Living»

`1301601911943339` es la WABA correcta y no hay que moverlo: ya está en **COP**, ya está `APPROVED` y verificada, y cuelga del portafolio Vorare. Además `name_status: AVAILABLE_WITHOUT_REVIEW` — el nombre visible «Vorare Living» **no necesita revisión de Meta**, que es justo el paso con espera externa que se temía.

**No hay Business Verification pendiente.** El portafolio y las cuatro WABAs ya están verificados. Ese paso, que suele darse por obligatorio, aquí no aplica.

### Corrección a lo que decía este ticket

- **+502 5946 7118 está registrado en dos WABAs a la vez**, no en una: `997437023462377` (en «Vorare», PENDING) y `993189033885747` (en «Tienda Vorare», ON_PREMISE DISCONNECTED). Quien lo busque por el número visible va a encontrar dos respuestas distintas.
- **+502 4722 4176 NO es un registro muerto: está `CONNECTED` en ON_PREMISE.** Es un servicio vivo sobre una API que Meta descontinuó. No es de este proyecto, pero es un riesgo real con fecha de vencimiento y merece ticket propio.
- El número guatemalteco vivo tiene `code_verification_status: EXPIRED` y aun así está `CONNECTED` con calidad `GREEN`. Es normal en un número de larga data y **no afecta el servicio** — que nadie lo tome por una falla y lo «arregle».
- Cuidado con los nombres: el número vivo tiene `verified_name: "Vorare Store Guatemala"` pero vive en la WABA llamada **«Vorare»**, mientras existe una WABA aparte llamada **«Vorare Store Guatemala»** que aloja otro número. Es una trampa de nombres, y conectar la equivocada es un error fácil y silencioso.

### Lo que falta, y por qué ningún agente lo hizo

Los criterios 2 y 3 —registrar el número en Cloud API y dejarlo con calidad sana— **son escrituras sobre activos de Meta del cliente**, y quedaron fuera por decisión del usuario el 16-ago-2026: se investiga en lectura y el trámite lo ejecuta una persona.

**Procedimiento, en orden:**

1. **Liberar el registro On-Premises.** Un número no puede estar registrado en las dos plataformas: hay que darlo de baja del On-Premises antes de registrarlo en Cloud API. Como está `DISCONNECTED`, en la práctica no hay sesión que cerrar, pero el registro sigue ocupando la plataforma.
2. **Elegir el PIN de verificación en dos pasos** (seis dígitos) y **guardarlo donde se pueda recuperar**: se vuelve a pedir en cada re-registro, y perderlo cuesta un bloqueo de siete días.
3. **Pedir el código de verificación** a Meta para `1101476763057048` (SMS o llamada de voz).
4. **Registrar en Cloud API** con el código y el PIN.
5. **Verificar el resultado en lectura** — es lo que sí puedo hacer yo: `platform_type` debe quedar en `CLOUD_API` y `status` en `CONNECTED`. Pásame el aviso cuando termines y lo compruebo contra la Graph API.
6. **La calidad arranca en `UNKNOWN` y no se puede forzar.** Se gana con tráfico real y sin bloqueos; el criterio 3 solo se puede cerrar después de que el número curse mensajes. Comparar contra el guatemalteco (`GREEN`, `throughput: STANDARD`) tiene sentido recién semanas después de encender.

**Este ticket no bloquea la tanda actual** (tickets 01–06, toda la migración de código). Bloquea el ticket 08, que crea la operación de Colombia, y ese ya estaba fuera de este alcance.

**Status:** en curso — investigación cerrada, trámite pendiente del usuario.
