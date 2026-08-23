---
name: activos-meta-vorare
description: Identificadores de Meta de Vorare y qué falta para CTWA y CAPI
metadata: 
  node_type: memory
  type: reference
  originSessionId: 0e63369c-d42d-466b-b2b6-a251a847109c
  modified: 2026-08-17T00:54:15.177Z
---

Verificado contra la Graph API v21.0 el 16-ago-2026. App **CLAUDE VORARE GUATEMALA** (`3918760311591600`).

| Activo | Valor |
|---|---|
| Portafolio de negocio | `2036295690245421` (Vorare, verificado) |
| Cuenta publicitaria | `act_2042265076620189` «CP - Vorare» — activa, **en COP, zona Bogotá** |
| Píxel Guatemala | `1825130408114773` — disponible, uso publicitario habilitado |
| Página Facebook | `882249564976319` · Instagram `17841477773060788` |
| **Número vivo** | **+502 3689 0343** — WABA `1676368750161510`, CLOUD_API, calidad GREEN |
| Número Colombia | +57 304 5430173 — WABA `1301601911943339` (COP), **en ON_PREMISE, hay que migrarlo** |

Hay **cuatro WABAs** bajo el portafolio Vorare y **seis portafolios** accesibles con ese token (Vorare, Prime Luxury, Tu tienda online y Esencia Urbana verificados; Mp Perfumes y Carpas JJ no).

**Lo que falta (actualizado 19-ago-2026, con el token de usuario de sistema en la mano):**

- ~~Permiso `whatsapp_business_manage_events`~~ — **concedido**. El token de sistema de Vorare trae `ads_read` + `whatsapp_business_manage_events`, es `SYSTEM_USER` y **no caduca**. Verificado con `debug_token`.
- **Falta `whatsapp_business_management`**, y sin él CAPI sigue bloqueado: el endpoint del dataset (`GET/POST /{waba}/dataset`) exige **los dos** permisos. Con el token actual devuelve `(#200) permiso denegado`, y la WABA tampoco se lee. Alternativa sin permiso nuevo: leer el dataset a mano en el Administrador de Eventos y pegarlo en Conexión → Meta.
- Para CAPI se usa el token de **usuario de sistema**, no el de usuario: el de sistema sirve para CAPI y lectura pero no crea anuncios (choca con la certificación de no discriminación).

**Dos hechos que condicionan decisiones:**

1. **No existe endpoint para recuperar el `referral`/`ctwa_clid` después del hecho.** Si no se captura en el webhook, se pierde. Toda pauta que corra antes de que la captura funcione es atribución perdida.
2. **Dos apps sí pueden suscribirse a la misma WABA** — el endpoint añade, no reemplaza. Se puede capturar el payload crudo de Meta sin desplazar a Kapso.

Los tokens **no se guardan aquí**. El que se compartió el 16-ago-2026 quedó expuesto en un chat y debía revocarse.

## La pauta CTWA no apunta al número del panel (verificado 18-ago-2026)

Consultada la Graph API v21.0 con un token con `ads_read` sobre
`act_2042265076620189`. De 500 conjuntos, **10 tienen destino WhatsApp**, y el
número de destino nunca es el del panel:

| Destino | Conjuntos | Estado |
|---|---|---|
| **+502 4722 4176** (WABA `888601147047306`, ON_PREMISE) | 2 | **ACTIVE** |
| +502 4722 4176 | 5 | pausados |
| +502 5946 7118 (WABA `1234095348671288`, ON_PREMISE) | 2 | pausados |
| +57 310 661 9655 | 1 | pausado |
| **+502 3689 0343 — el que escucha el panel** | **0** | — |

**Ningún anuncio Click-to-WhatsApp de esta cuenta apunta al número que escucha
el panel**, y **es a propósito**: hoy las confirmaciones (Katherine) corren en
un WhatsApp y las ventas en otro. Daniel confirmó el 18-ago-2026 que los dos
números se van a unir en uno solo, y que Sebastián queda activo cuando eso
pase. Queda **pendiente de validación con datos reales**, no como defecto.

Por eso `conversations` tiene 1.713 filas y **cero** con `ad_id`/`ctwa_clid`:
no es un bug de captura ni de Kapso. Y no hay pérdida retroactiva — esos leads
nunca pudieron llegar al panel.

**El detalle que sí condiciona la unificación:** el número al que hoy apunta la
pauta (+502 4722 4176) está en **ON_PREMISE**, que Meta está descontinuando, y
el del panel (+502 3689 0343) está en **CLOUD_API**, que es lo que Kapso usa.
La unificación tiene que ir hacia el de Cloud API, no al revés.

Los dos conjuntos activos son `CJ NEURO WPP` y `CJ ABT WPP BUSSINES SEBASTIAN
SEGUNDA CAMPAÑA`.

**Vorare no vende solo REVITALHAIR.** La pauta más reciente es de un producto
de **neuropatía** («alivio para pies y manos», «que el hormigueo no te quite el
sueño»). El modelo del catálogo que asume cuatro SKUs capilares casi idénticos
está incompleto.

**Los nombres de anuncio no identifican nada**: 200 anuncios, 122 nombres
distintos, y 92 comparten nombre — «VIDEO 1» ×23, «VIDEO 2» ×23, «VIDEO 3»
×17. Lo que identifica es el nombre de **campaña**
(`DHT WHATSAPP SEBAS CBO GTM 12 08 2026`), no el del anuncio.

Ver [[panel-de-ventas-estado]], [[vorare-opera-en-guatemala]].
