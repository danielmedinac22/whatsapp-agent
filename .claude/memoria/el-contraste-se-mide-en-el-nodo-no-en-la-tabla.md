---
name: el-contraste-se-mide-en-el-nodo-no-en-la-tabla
description: "Emparejar tokens no verifica contraste: el texto que falla es el que hereda su color y cae sobre un fondo que le puso un ancestro"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f67cd5bb-09ad-42b3-b79c-6d6dd1e9edf0
  modified: 2026-08-20T22:32:08.284Z
---

Al pasar el panel a claro (PRO-26, 20-ago-2026) calculé la tabla de contraste de
todos los pares de tokens y me dio limpia. **La tabla no encuentra los fallos
reales.**

Los seis textos que sí fallaban eran todos de la misma forma: un `<p>` con
`--color-text-dim` **heredando su color**, dentro de un `<div>` al que un
ancestro le había puesto `--state-escalada-bg`. Tenue sobre el fondo de
«escalada» da 4,33:1. Ni el par estaba en mi tabla —porque nadie lo escribió
como par— ni el `grep` lo veía, porque el color y el fondo viven en **elementos
distintos**, a veces separados por varios niveles de JSX.

Lo que sí los encontró: levantar el panel contra base desechable y recorrer con
un navegador **cada nodo de texto** de cada pantalla, leyendo su `color`
computado y subiendo por `parentElement` hasta el primer fondo no transparente.
Seis fallos en siete pantallas, todos invisibles al diff.

**Why:** el modo de fallo típico de una migración de tema no es un token mal
elegido —esos se calculan una vez— sino una herencia que cambia de fondo debajo.
Y `typecheck`, `lint` y las 1.013 pruebas pasan **en verde** con el fallo dentro:
un color vive en una cadena de texto que ningún compilador mira. En esa misma ola
pasaron 40 clases rotas (`border-[…]0/25`) por una alternancia de regex que
probaba `50` antes que `500`, y también estaba todo verde.

**How to apply:** después de tocar colores, medir en el navegador, no en la hoja
de cálculo — el recorrido es corto y da una cifra por pantalla. Y en cualquier
sustitución masiva de clases de Tailwind, ordenar la alternancia de tonos **de
más largo a más corto** (`950|900|…|500|50`, nunca `50|…|500`), y contar los
reemplazos esperados antes de aceptar el resultado.

Ver [[lo-que-vacia-de-significado-no-lo-ve-el-tipado]],
[[ejecutar-encuentra-lo-que-leer-no]], [[base-de-ensayo-con-docker]],
[[el-contrato-de-nombres-vuelve-paralelo-lo-serial]].
