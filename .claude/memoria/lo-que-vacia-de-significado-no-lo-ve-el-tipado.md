---
name: lo-que-vacia-de-significado-no-lo-ve-el-tipado
description: "El compilador encuentra lo que un cambio retira, no lo que un cambio deja vacío de significado"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 02a34cc6-5a12-4998-8824-f7c11acff539
  modified: 2026-08-20T03:25:49.794Z
---

Este repo confía —con razón— en que `strict: true` y `noUncheckedIndexedAccess`
encuentran los call sites cuando un cambio **retira** algo: quitar una función,
volver obligatorio un parámetro. Está escrito en `no-regresion.md` y ha
funcionado ola tras ola.

**Pero no cubre el caso contrario:** cuando una columna o un campo **sigue
existiendo con el mismo tipo y pasa a significar otra cosa**.

El 19-ago-2026 pasó con `shopify_connection.admin_access_token`. Con la
credencial nueva esa columna queda vacía a propósito, así que
`if (!conn.adminAccessToken)` —que compilaba igual de bien que siempre— pasó a
contestar «no hay tienda» sobre una tienda perfectamente conectada. Dos sitios se
pasaron por alto, y el caro no se veía: `buildShopifyContextBlock` devolvía
`null`, o sea el vendedor conversando sin la ficha del producto, **sin error y
sin alarma**.

**Why:** los dos fallos de esa ola salieron de ejecutar contra producción, no de
revisar el diff ni de correr el typecheck. Un cambio que redefine qué significa
un campo no deja rastro en ningún diff de los archivos afectados — no aparecen en
el diff.

**How to apply:** ante un cambio que **vacía de significado** un campo existente,
`grep` el nombre del campo por todo el árbol antes de dar por cerrado el cambio,
y dejar una **red de fuente** que falle nombrando el archivo culpable
(el precedente es `consultas-del-panel.test.ts`; el nuevo es
`shopify/credencial-unica.test.ts`). Y comprobar que la red muerde
reintroduciendo el fallo a propósito — una prueba de vigilancia que pasa estando
rota ya mordió en este proyecto.

Ver [[credencial-de-shopify-caduca]], [[ejecutar-encuentra-lo-que-leer-no]].
