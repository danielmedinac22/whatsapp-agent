---
name: la-fila-implicita-se-come-el-min-h-0
description: "Una retícula sin `grid-rows` declarado tiene una fila `auto` que crece con el contenido y anula el `min-h-0`: el panel entero scrollea y la cabecera se va"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 26ece25c-97ce-4f4e-b6e4-89c82a0c3964
  modified: 2026-08-21T23:10:04.209Z
---

**`min-h-0` en una retícula no alcanza: hay que declarar la fila.** El Inbox
tenía `grid min-h-0 lg:flex-1 lg:grid-cols-[336px_1fr]` y ninguna
`grid-template-rows`. La única fila era implícita, y una fila implícita es
`auto`: se estira a lo que mida el contenido aunque la caja tenga alto definido.
Medido el 21-ago-2026 a 1440×900: la retícula medía 724px y su fila 2.254px.

Lo que eso rompía, todo junto y sin un solo error: el desbordamiento se lo comía
`.app-main` (que es `overflow-y-auto`), así que **scrolleaba la pantalla entera**
— la cabecera con el nombre y el teléfono del cliente se iba hacia arriba, el
compositor quedaba debajo del pliegue, y el `overflow-y-auto` del hilo no llegaba
a activarse nunca. Lo arregla `lg:grid-rows-[minmax(0,1fr)]`.

Y su hermano: **un `min-height` sobre un hijo de la retícula es el mismo
desbordamiento por otra puerta.** El `lg:min-h-[520px]` de la lista empujaba la
fila a 520px donde la retícula solo tenía 464 (1024×640). Con la fila declarada
el hijo ya se estira solo: el mínimo sobra y encima hace daño.

**Why:** lo reportó el cliente (Vorare, 21-ago-2026) y en desarrollo no se veía,
porque las conversaciones sembradas traen uno o dos mensajes y con eso la tarjeta
nunca pasa del alto de la ventana. Es literalmente lo que advierte la cabecera de
`scripts/seed-bandejas-ensayo.ts`: **el estado fácil aprueba por la razón
equivocada.** Tres commits seguidos dejaron escrito en comentarios que «la
cabecera no se va con el scroll, y eso ya estaba resuelto» — y era cierto del
árbol de cajas y falso en pantalla. Ver
[[ejecutar-encuentra-lo-que-leer-no]] y [[base-de-ensayo-con-docker]].

**How to apply:** ante cualquier pantalla que prometa «esto no scrollea»,
sembrar el caso grande (un hilo de 30 mensajes, una lista larga) y medir
`scrollHeight - clientHeight` de cada ancestro, no solo mirar. Y al escribir una
retícula que tiene que caber en la ventana, declarar la fila con
`minmax(0, 1fr)`: `min-h-0` sobre el contenedor no la constriñe.
