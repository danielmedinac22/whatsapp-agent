# La memoria, en el repo

Acá vive la **memoria automática** de este proyecto: las notas que Claude se
escribe a sí mismo sobre correcciones, decisiones y contexto que no se deduce
del código. `MEMORY.md` es el índice, una línea por memoria; los demás archivos
son una memoria cada uno.

## Por qué está acá y no donde va por defecto

Por defecto vive en `~/.claude/projects/<proyecto>/memory/`, que es **local a la
máquina**: la documentación dice que no se comparte con entornos de nube. Cuando
el trabajo se hace desde `claude.ai/code`, esa memoria no existe, y la sesión
arranca sin nada de lo que este proyecto ya aprendió.

Mudarla acá la vuelve parte del clon. Se commitea, se revisa en un diff, viaja.

## Cómo está enganchada

Dos piezas, ninguna automática de más:

- **`CLAUDE.md` importa `MEMORY.md`.** El índice entra en el contexto de toda
  sesión, acá y en la nube, y cada archivo se lee bajo demanda. Es el mismo
  comportamiento de la memoria nativa, sobre archivos que viajan.
- **`autoMemoryDirectory` apunta a esta carpeta** desde el
  `.claude/settings.local.json` de cada máquina. Solo acepta rutas absolutas, así
  que no puede vivir en el settings compartido: cada checkout la escribe con la
  suya. El ejemplo está en `docs/nube/README.md`.

## Lo que esto NO cierra

Una sesión en la nube que aprenda algo lo escribe en su VM, que es efímera y se
pierde al terminar. No hay forma limpia de devolver eso al repo sin un enlace
frágil entre el home y el checkout.

La regla que lo suple está en `CLAUDE.md` y vale para las dos puntas: **lo que
tenga que sobrevivir a la sesión no va a memoria.** Si es una regla de cómo
trabajar, va a `CLAUDE.md`; si es un hecho del negocio o una trampa de medición,
va a `CONTEXT.md`.

## El costo, dicho de frente

Cada sesión que aprenda algo escribe un archivo acá, así que el árbol de git va
a estar sucio más seguido. `--teleport`, que trae una sesión de la nube a la
terminal, exige árbol limpio. Es el precio de que la memoria viaje.
