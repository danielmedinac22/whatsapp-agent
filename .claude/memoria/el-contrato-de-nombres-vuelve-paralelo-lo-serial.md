---
name: el-contrato-de-nombres-vuelve-paralelo-lo-serial
description: Un cambio de sistema visual encadena todos los tickets a globals.css; fijar los nombres antes de repartir rompe la cadena
metadata:
  type: feedback
---

Cuando varios tickets dependen de un mismo archivo de sistema (`globals.css`, un
módulo de tokens, un tipo compartido), la dependencia real no es el archivo: son
**los nombres**. Fijarlos en el `spec.md` antes de repartir, con valores y medidas,
convierte una cadena serial en tres worktrees en paralelo.

Daniel lo eligió sobre las dos alternativas el 20-ago-2026, para la tanda
PRO-26/27/28 del Panel de Ventas.

**Why:** en serie, el camino crítico es la suma; en paralelo es el máximo. PRO-26
sola eran 16 archivos y 381 colores escritos a mano, así que 27 y 28 habrían
esperado días por una clase CSS que no existía todavía. Una sesión hija puede
escribir `className="app-context"` contra una clase que su worktree no define:
resuelve al mergear.

**How to apply:** el contrato es un recurso global como el número de migración,
así que lo reparte la sesión que coordina y **nadie más edita el archivo donde
vive**. Tres cosas que tiene que traer, o no sirve: los nombres con su valor
exacto, la firma textual de todo componente que una rama crea y otra importa, y
la tabla de qué archivo es de quién. Y la instrucción explícita en cada encargo
de que un desvío se avisa, no se decide. Ver [[un-archivo-grande-un-solo-dueno]].

Lo que decide el reparto son los archivos, no los tickets: medí dónde vive de
verdad cada cosa antes de agrupar. En esta tanda el `h1` del Inbox estaba dentro
de `inbox-client.tsx` y no en su `page.tsx`, así que el ticket de «las ocho
pantallas» resultó ser de siete.

**Y el contrato es punto único de fallo: un error suyo entra en las tres ramas a
la vez y nadie lo contradice.** Pasó el 20-ago-2026. El veredicto decía «Figtree
para todo» y añadía que las dos variables de familia «pueden seguir siendo el
mismo valor»; yo lo condensé como «no se toca la familia». Valer lo mismo entre
sí no es valer lo de hoy. Las tres sesiones lo implementaron tal cual y el panel
salió a producción con la escala nueva sobre la tipografía vieja, que además no
tenía el peso 800 que el diseño pide y el navegador lo sintetizaba.

Por eso, al escribir el contrato: **cada línea que condensa una decisión ajena se
verifica contra la frase original, no contra el recuerdo de haberla leído.** Y
las que dicen «esto no cambia» son las peligrosas, porque nadie las cuestiona.
