# CLAUDE.md

## Git / GitHub

El remote `origin` (`danielmedinac22/whatsapp-agent`) es **privado y pertenece a la cuenta personal `danielmedinac22`**.

Hay dos cuentas de GitHub autenticadas en `gh`: `danielmedinac2205` (correo de Simetrik) y `danielmedinac22` (dueña del repo). **Antes de `git push` o `git fetch`, la cuenta gh activa debe ser `danielmedinac22`** — si está activa `danielmedinac2205`, las operaciones fallan con "Repository not found".

```bash
gh api user --jq .login                 # ver la cuenta activa
gh auth switch --user danielmedinac22   # cambiar a la personal antes de push
```

El deploy a prod (`railway up`) no depende del push, pero el push mantiene el respaldo en GitHub al día. Ver el skill `deploy` para el flujo completo de deploy.

**El autor de los commits debe ser `danielmedina2205@gmail.com`** (`git config user.email` local del repo, ya configurado). Vercel bloquea todo deploy cuyo autor de commit no tenga asiento en el equipo: la cuenta `daniel.medina@simetrik.com` está invitada como DEVELOPER pero sin asiento verificado, así que los deploys firmados con ese correo quedan en estado `BLOCKED` (`seatBlock: TEAM_ACCESS_REQUIRED`) y el sitio nunca se actualiza — sin error visible en el CLI, que se queda colgado. La alternativa es asignarle un asiento Pro a la cuenta de Simetrik.

## Tickets (Linear)

Los tickets de este repo viven en Linear: workspace **Producto Con Daniel**
(`linear.app/producto-con-daniel`), equipo `Producto Con Daniel`, prefijo `PRO`.

Fue una mudanza del 19 ago 2026. Antes eran archivos en `.scratch/<mapa>/issues/`
y **los 58 que ya existen se quedan ahí como histórico de solo lectura** — no se
migraron. Los nuevos nacen en Linear. Lo que sigue viviendo en el repo es el
`spec.md` de cada mapa, porque viaja en el diff y una sesión hija lo lee desde su
worktree sin depender de la red.

**Hay dos servidores MCP de Linear conectados y apuntan a workspaces distintos:**

| Prefijo | Workspace | Repo |
| -- | -- | -- |
| `mcp__linear-pcd__*` | Producto Con Daniel | **este** |
| `mcp__linear__*` | `waichat-app` | `waichat-app`, otro repo |

Usar el prefijo equivocado **no falla con error**: crea el ticket en el tablero
de otro cliente. Confirma con `mcp__linear-pcd__get_workspace` antes del primer
write de la sesión.

`linear-pcd` está registrado con **scope local** contra la ruta de este checkout
(vive en `~/.claude-personal/.claude.json`, no en el repo), así que **un worktree
de Orca no lo hereda**: las sesiones hijas abren sin acceso a Linear. Es
deliberado — el encargo viaja como archivo y los issues los cierra la sesión que
coordina. El flujo completo está en el skill `tanda-de-tickets`.

## Deploy del worker (Railway)

**Hay un `RAILWAY_TOKEN` inyectado en el entorno de las sesiones y es inválido.** El CLI lo prefiere sobre el login guardado en `~/.railway/config.json`, así que todo comando falla con `Invalid RAILWAY_TOKEN` — **incluido `railway login`, que ni siquiera abre el navegador.** Parece un problema de credenciales y no lo es: la cuenta (`danielmedina2205@gmail.com`) está bien autenticada.

La solución es ignorar la variable en cada comando, no volver a hacer login:

```bash
env -u RAILWAY_TOKEN railway whoami
env -u RAILWAY_TOKEN railway status
env -u RAILWAY_TOKEN railway up --service whatsapp-worker --ci   # la build tarda 90-180s
```

No está en `~/.zshrc` ni en los demás perfiles: la inyecta el entorno de la sesión. No hay que borrarla ni pedirle nada al usuario — basta con `env -u`.

## Deploy del dashboard (Vercel)

`apps/worker` va a Railway; `apps/web` va a Vercel y es un deploy aparte. Hay integración con GitHub, pero conviene forzarlo desde la raíz del repo:

```bash
vercel --prod --yes    # rootDirectory apps/web ya está en la config del proyecto
```

Dominio de producción: https://whatsapp-agent-mauve.vercel.app

Cuando un cambio toca worker y web, **deploya primero el worker**: la UI nueva suele depender de endpoints nuevos del worker.
