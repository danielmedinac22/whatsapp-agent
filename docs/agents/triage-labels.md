# Etiquetas de triage

Los skills hablan de cinco roles canónicos de triage. Esta tabla los mapea al nombre
real que se usa en Linear.

| Rol en mattpocock/skills | Etiqueta en Linear | Significa |
| -- | -- | -- |
| `needs-triage` | `needs-triage` | Hay que evaluarlo |
| `needs-info` | `needs-info` | Falta información de quien lo reportó |
| `ready-for-agent` | `ready-for-agent` | Especificado completo, listo para un agente sin supervisión |
| `ready-for-human` | `ready-for-human` | Necesita manos humanas |
| `wontfix` | `wontfix` | No se va a hacer |

Cuando un skill nombra un rol, usá la etiqueta de la columna del medio.

Ninguna de las cinco existe todavía en el equipo `Producto Con Daniel`. Hay que
crearlas con `create_issue_label` la primera vez que se apliquen. Las que sí existen
son `Bug`, `Improvement` y `Feature`, y cubren otra cosa, las dos categorías de
triage (`bug` y `enhancement`) en vez del estado.

Dos detalles de Linear que muerden:

- `wontfix` es una etiqueta, pero además conviene mover el issue al estado `Canceled`. La etiqueta dice por qué, el estado lo saca del tablero.
- `labels` en `save_issue` reemplaza el juego completo. Para agregarle `needs-info` a un issue que ya tiene `Bug`, mandá las dos.

Editá la columna del medio si algún día cambiás de vocabulario.
