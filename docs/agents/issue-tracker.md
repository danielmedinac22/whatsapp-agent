# Issue tracker: Linear (`PRO`)

Los issues y specs de este repo viven en Linear. Workspace `Producto Con Daniel`
(`linear.app/producto-con-daniel`), equipo `Producto Con Daniel`, prefijo `PRO`.
Todo pasa por el MCP `mcp__linear-pcd__*`.

## Antes del primer write, confirmá el workspace

Hay dos servidores MCP de Linear conectados y apuntan a workspaces distintos.

| Prefijo | Workspace | Repo |
| -- | -- | -- |
| `mcp__linear-pcd__*` | Producto Con Daniel | este |
| `mcp__linear__*` | `waichat-app` | otro repo |

Usar el prefijo equivocado no falla con error. Crea el ticket en el tablero de otro
cliente. Corré `mcp__linear-pcd__get_workspace` y verificá que devuelve
`Producto Con Daniel` antes del primer write de la sesión.

## Convenciones

- Crear un issue: `save_issue` con `team: "Producto Con Daniel"` y `title`. El cuerpo va en `description` como Markdown, con saltos de línea reales y sin secuencias de escape.
- Leer un issue: `get_issue` con el identificador (`PRO-12`). Pasá `includeRelations: true` cuando importen los bloqueos, porque por defecto no vienen.
- Leer la conversación: `list_comments` con `issueId`.
- Listar issues: `list_issues` con `team`, más `state`, `label` o `assignee` según haga falta. `fields` recorta la respuesta, por ejemplo `["id","title","status","labels","parentId"]`. No devuelve relaciones de bloqueo.
- Comentar: `save_comment` con `issueId` y `body`.
- Etiquetar: `labels` en `save_issue` reemplaza el juego completo, así que las que no mandes se borran. Leé las actuales con `get_issue` antes de tocarlas. Las que no existan hay que crearlas primero con `create_issue_label`.
- Cerrar: `save_issue` con `state: "Done"`, o `"Canceled"` para lo que no se va a hacer.
- Editar el cuerpo sin reescribirlo: `save_issue` con `patch` en lugar de `description`.

El equipo tiene hoy siete estados: `Backlog`, `Todo`, `In Progress`, `In Review`,
`Done`, `Canceled`, `Duplicate`. Y tres etiquetas: `Bug`, `Improvement`, `Feature`.
Esas tres son categorías, no estado de triage. Las de triage están en
`triage-labels.md`.

## Lo que se queda en el repo

El `spec.md` de cada mapa vive en `.scratch/<mapa>/spec.md` a propósito. Viaja en el
diff, así que una sesión hija lo lee desde su worktree sin depender de la red.

Los 58 archivos en `.scratch/<mapa>/issues/NN-*.md` son histórico de solo lectura,
de antes de la mudanza del 19-ago-2026. No se migraron y no se editan. Los nuevos
nacen en Linear.

## Un worktree no hereda el MCP

`linear-pcd` está registrado con scope local contra la ruta de este checkout, y vive
en `~/.claude-personal/.claude.json`, no en el repo. Las sesiones hijas de un
worktree abren sin acceso a Linear. Es deliberado. El encargo viaja como archivo y
los issues los cierra la sesión que coordina. El flujo está en el skill
`tanda-de-tickets`.

Si corrés dentro de un worktree y `get_workspace` falla, no busques otro camino ni
escribas en `.scratch/`. Devolvé el trabajo como archivo y dejá que la sesión
coordinadora lo publique.

## PRs como pedidos

**PRs como superficie de pedidos: no.**

El remote `danielmedinac22/whatsapp-agent` es privado y de una cuenta personal, así
que no hay contribuciones externas para triagear. Poné `sí` si eso cambia, porque
`/triage` lee esta bandera.

## Cuando un skill dice "publicar en el issue tracker"

Crear un issue en Linear con `save_issue`, equipo `Producto Con Daniel`.

## Cuando un skill dice "traer el ticket"

`get_issue` con el identificador `PRO-N`, y `list_comments` si importa la
conversación.

## Operaciones de wayfinding

Las usa `/wayfinder`. El mapa es un issue y los tickets son sub-issues.

- Mapa: un issue etiquetado `wayfinder:map`, con el cuerpo Notes, Decisions-so-far y Fog en `description`.
- Ticket hijo: un issue con `parentId` apuntando al `PRO-N` del mapa, etiquetado `wayfinder:<tipo>`, donde el tipo es `research`, `prototype`, `grilling` o `task`.
- Bloqueos: relaciones nativas de Linear. `save_issue` con `blockedBy: ["PRO-7"]` agrega sin borrar las que ya hay, y `removeBlockedBy` las suelta. Se leen con `get_issue` e `includeRelations: true`.
- Frontera: `list_issues` con el `parentId` del mapa y estado sin empezar, descartando los que ya tengan `assignee`. Después `get_issue` con `includeRelations: true` sobre cada candidato, y fuera los que tengan un bloqueador abierto. Gana el primero en el orden del mapa.
- Tomar el ticket: `save_issue` con `assignee: "me"` y `state: "In Progress"`. Es el primer write de la sesión.
- Resolver: `save_comment` con la respuesta, `save_issue` con `state: "Done"`, y después agregá el puntero de contexto a Decisions-so-far del mapa con `save_issue` y `patch`.

El tablero `PRO` está vacío hoy (20-ago-2026). El primer mapa que se abra estrena
las etiquetas.
