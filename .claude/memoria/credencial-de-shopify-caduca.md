---
name: credencial-de-shopify-caduca
description: "La tienda de Vorare no emite tokens shpat_ fijos: se acuñan por client credentials y duran 24 h"
metadata: 
  node_type: memory
  type: project
  originSessionId: 02a34cc6-5a12-4998-8824-f7c11acff539
  modified: 2026-08-20T03:25:36.397Z
---

La tienda de Guatemala (`keuvhs-wt.myshopify.com`) **solo soporta el modelo del
Dev Dashboard**. No existe un token `shpat_` estático: se guardan **Client ID +
Client Secret** y el Admin API token se pide con *client credentials grant*
contra `POST /admin/oauth/access_token`.

**Ese token caduca a las 24 horas** — medido el 19-ago-2026 contra la tienda
real: `expires_in: 86399`. Shopify devuelve el mismo token mientras siga vigente,
con el `expires_in` bajando.

**Why:** el modo de fallar de guardarlo es el peor del proyecto — **el día uno
todo funciona** (conexión verde, permisos completos, venta de prueba cerrada) y
el día dos un `401` en medio de un cierre, con el cliente ya despedido creyendo
que compró. No hay error visible hasta ese momento.

**How to apply:** lo que se guarda es **cómo pedir el token**, no el token
(`apps/worker/src/shopify/token.ts`, migración `0029`). Y la pregunta «¿está
conectada la tienda?» **nunca** se contesta mirando `admin_access_token`: con
esta credencial esa columna está vacía a propósito. Se usa `storeCredential(conn)`
— hay una red de fuente (`credencial-unica.test.ts`) que falla nombrando el
archivo si alguien vuelve a preguntar por la columna.

El camino del `shpat_` fijo sigue vivo para una tienda vieja, y si están las dos
credenciales gana la fija.

Ver [[panel-de-ventas-estado]], [[lo-que-vacia-de-significado-no-lo-ve-el-tipado]].
