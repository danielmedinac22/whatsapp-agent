---
name: el-resaltado-invisible-de-la-seleccion
description: "«El chat no deja seleccionar texto» era un color: `::selection` usaba el mismo hex exacto que la burbuja saliente"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 26ece25c-97ce-4f4e-b6e4-89c82a0c3964
  modified: 2026-08-21T23:10:26.392Z
---

**Vorare reportó (21-ago-2026) que el chat no dejaba seleccionar ni copiar
texto, y sí dejaba.** `getSelection().toString()` traía el texto entero,
cruzando burbujas, medido con arrastres de ratón por CDP. Lo que fallaba era
verlo: `::selection` pintaba `--color-ink-soft` (`#dbe8e4`) y
`--color-bubble-out` es **el mismo `#dbe8e4`** — 1,00:1. Sobre la burbuja del
cliente, blanca, daba 1,15:1.

Por eso el reporte decía «solo el primer mensaje se deja seleccionar»: el primero
suele ser del cliente (blanco, resaltado tenue pero visible) y de ahí en adelante
mandan las respuestas del asesor, donde no se dibujaba nada. Quedó en
`--color-ink` de fondo y `--color-card` de texto: el par que ya usa
`.app-button`, así que no entra un color nuevo (4,35:1 contra la superficie más
apretada, 5,47:1 texto sobre resaltado).

**Why:** dos tokens del sistema tenían el mismo valor y nada lo delataba —el
contrato de nombres los reparte por significado, no por valor, y nadie compara
`ink-soft` con `bubble-out` porque no se usan en el mismo sitio… hasta que
`::selection` los superpone. Es primo de
[[el-contraste-se-mide-en-el-nodo-no-en-la-tabla]]: el par se ve limpio en la
tabla y falla en el nodo.

**How to apply:** al tocar la paleta, comprobar que ningún color que se
superpone a otro comparta hex con él —`::selection`, `:focus-visible`, los
velos— y no solo que cada par de texto/fondo pase AA. Y ante un reporte de «no
se puede seleccionar/copiar», medir primero `getSelection()`: separa «no se
puede» de «no se ve».
