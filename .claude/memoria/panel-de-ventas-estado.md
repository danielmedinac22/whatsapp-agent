---
name: panel-de-ventas-estado
description: "Panel de Ventas — 39/44 y un lote nuevo abierto (ventas-bandeja-honesta); qué falta, quién lo trae, y en qué orden se enciende"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6c48b56e-e369-4241-a1a2-3a5835522b4c
  modified: 2026-08-19T15:24:20.726Z
---

El **Panel de Ventas** —agente comercial *Sebastián*, que atiende leads de anuncios Click-to-WhatsApp, vende y crea el pedido en Shopify— está **terminado en código y apagado a propósito**.

**Al 19-ago-2026 (tras la ola de credenciales): 39 de 44 tickets resueltos**, diez migraciones aplicadas (`0020`–`0029`), 814 tests, worker y dashboard desplegados y verificados. **Llegaron las dos llaves de Vorare** y con ellas se cerró la conexión de la tienda y la lista de anuncios de Meta.

**Vuelve a haber trabajo construible.** El 19-ago-2026 Pablo miró el panel y preguntó de qué eran las 55 conversaciones que decían «necesitan atención»: ninguna era de Sebastián, ninguna era urgente y 30 ya estaban contestadas. De ahí salió el lote **`.scratch/ventas-bandeja-honesta/`**, **cerrado y en producción el 20-ago-2026**: bandeja de ventas 110 → 0, Inbox de Katherine 1.650 → 1.760, el contador rojo 90 → 35. Migración `0030` aplicada. Ver [[la-bandeja-definida-por-resta]].

**Para retomar, leer `.scratch/panel-de-ventas/estado.md`** — es el punto de entrada, está al día y trae el detalle de todo lo de abajo.

## Lo que falta, y quién lo trae

| Qué | Quién | Qué destraba |
| -- | -- | -- |
| ~~Credenciales de Shopify~~ y ~~token con `ads_read`~~ | Vorare | **llegaron el 19-ago-2026 y están cargadas y verificadas en producción.** La tienda es **Vorare Store Guatemala** (GTQ, 46 productos) y está en modo seco; la lista de anuncios se lee de `act_2042265076620189`. Ojo: la credencial de la tienda **caduca cada 24 h**, ver [[credencial-de-shopify-caduca]] |
| **El dataset de CAPI de Guatemala** | Vorare | `ventas-capi/04`. El token trae `whatsapp_business_manage_events` pero el endpoint del dataset exige **además `whatsapp_business_management`**, que no se pidió. Dos salidas: pegar el dataset a mano desde el Administrador de Eventos (Conexión → Meta), o agregar ese permiso y reemitir el token |
| Configurar a Sebastián (`display_name`) y cargar el catálogo | El dueño de la operación | Que el vendedor atienda. `display_name` está vacío y `products` en 0 filas |
| Migrar +57 304 5430173 a Cloud API | Consola de Meta | `ventas-multi-operacion/08` y `09` |

**Artefacto con las dos credenciales, listo para pasarle a Vorare:** https://claude.ai/code/artifact/d4014b57-11a2-400c-a63f-5a4c70bad9da — trae los pasos de cada consola y los IDs ya verificados. Ver [[activos-meta-vorare]].

**Pedir `ads_read`, nunca `ads_management`**: solo se lee la lista de anuncios, y `ads_management` dispara la revisión más dura de Meta.

## Colombia está pospuesta

Decisión del usuario del 19-ago-2026: **por ahora solo Guatemala.** Los dos tickets de Colombia quedan abiertos a propósito, no por bloqueo técnico. Ver [[vorare-opera-en-guatemala]].

## Los tres interruptores, y el orden para encenderlos

El camino de venta está construido de punta a punta y **no se ejecuta**, por tres frenos independientes. Encender es un acto deliberado:

1. **`display_name` vacío** → toda conversación resuelve a Katherine. El listón es `display_name` no vacío, no que exista la fila (la fila ya existe).
2. **Modo de escritura de tienda en seco** → arma el pedido y no lo manda. Verificado el 19-ago con la tienda ya conectada: `writeMode: dry_run`.
3. **`META_CAPI_MODE` sin poner** y sin token → ni una llamada a Meta. El token de CAPI se dejó **deliberadamente sin cargar**: sin dataset no habilita nada y sí quita un freno.

**Orden:** primero catálogo y vendedor; después la tienda, y antes contra un pedido desechable; CAPI al final, con el código de prueba de Meta. Los riesgos R6 y R7 de `.scratch/panel-de-ventas/no-regresion.md` mandan acá.

**Antes de encender nada, leer [[no-romper-guatemala]].** Guatemala factura hoy y no puede cambiar de comportamiento.

Se trabaja con el skill `/tanda-de-tickets`: una sesión mide y reparte a worktrees paralelos, y es la única que mergea y deploya.
