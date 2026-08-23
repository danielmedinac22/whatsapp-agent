---
name: reproducir-la-linea-base-antes-de-tocar
description: Antes de optimizar, reproducir el número viejo EXACTO en una base desechable; y volcar a JSON lo que la función devuelve, para que «las mismas filas» sea un diff y no una promesa
metadata:
  type: feedback
---

**Dos pasos, y ninguno es el cambio.** Salieron de PRO-15+PRO-16, donde había que
bajar el Inbox de 23 idas y vueltas a cuatro **sin cambiar una fila de lo que el
usuario ve**, sin `.env` y sin poder tocar producción.

1. **Reproducir la línea base exacta antes de escribir código.** Docker +
   `pnpm --filter @wa/db migrate` + `scripts/seed-bandejas-ensayo.ts SEMBRAR=si
   ESCALA=si` dio 13 consultas, 23 idas y vueltas y 1.256 filas: **los mismos
   números del encargo, hasta la fila**. Recién ahí el «después» significa algo.
   Si no coincide, lo que está mal es el banco, no el código — y descubrirlo al
   final cuesta la medición entera.

2. **Volcar a JSON lo que la función devuelve, y diffear.** Un guion de ensayo
   que llama a `listConversations` con siete escenarios —sin bandeja, buscando
   por texto, buscando por dígitos, con conversación anclada, las dos bandejas
   con y sin búsqueda— y escribe id, contacto, asignado, `sinResponder`, dropi,
   shopify, ruteo, vista previa y no leídos. `diff -q` antes y después. Fusionar
   tres consultas en una y que el archivo salga **idéntico** es la única forma
   de decir «mismas filas, mismo orden» sin que sea una promesa.

**Why:** «no cambia el comportamiento» es la frase que más veces resulta falsa en
una optimización, y el tipado no la vigila —ver
[[lo-que-vacia-de-significado-no-lo-ve-el-tipado]]—. Con el volcado, la
afirmación se convierte en un archivo que o coincide o no.

Tres trampas que este par de pasos ya pagó:

- **Sembrar el estado fácil no prueba nada.** La bandeja de ventas traía **una**
  fila con la fecha de activación de hoy. Corriendo `activated_at` 400 días
  atrás pasó a 115 y recién ahí el escenario ejercía las rezagadas. Ver
  [[la-bandeja-definida-por-resta]].
- **La primera corrida escribe.** Hasta PRO-20, `conversationIdsOfInbox` soltaba
  asignaciones viejas, así que la corrida 1 y la 2 difieren legítimamente. El
  arreglo definitivo del volcado es **fotografiar las columnas que la lectura
  toca y restaurarlas antes de cada escenario**, para que los dos volcados vean
  la misma base; y dejar las notas del propio instrumento en un archivo aparte,
  porque `diff` no distingue una fila que cambió de una nota al margen.
- **La caché puede hacer que el instrumento mida otra escena.** En PRO-18, la
  escena «bandeja apagada» apagaba al vendedor en la base pero no invalidaba la
  caché de cinco segundos de `getSalesAgentSettings`: el marco seguía viendo al
  vendedor encendido y le sumaba 3.605 filas a la línea base —4.661 donde PRO-10
  midió 1.256—. Y por lo mismo, la medición de «leer escribe» daba **1** fila en
  vez de 199. **Los dos números dependían de si habían pasado cinco segundos.**
  Tocar una fila que la aplicación cachea y no invalidar es medir el pasado.
- **La regla de medir también se rompe con el cambio.** Al fusionar dos
  consultas en un `union`, el resumidor la llamó «? ?» y el `EXPLAIN` la saltó
  por empezar con paréntesis: la consulta más grande se caía de la cuenta sin
  decirlo. **Después de cambiar el código, mirar que el instrumento siga
  nombrando lo que mide.**

**How to apply:** ante cualquier ticket de rendimiento con un número declarado,
estos dos pasos van antes del primer `Edit`. Ver
[[base-de-ensayo-con-docker]], [[ejecutar-encuentra-lo-que-leer-no]] y
[[el-panel-y-la-base-en-costas-opuestas]].
