# CLAUDE.md

@CONTEXT.md
@.claude/memoria/MEMORY.md

<!-- El segundo import trae el índice de la memoria acumulada, que vive en el
     repo justamente para poder viajar. Una línea por memoria; los archivos se
     leen bajo demanda, igual que con la memoria nativa.

     El primer import no es decorativo: carga CONTEXT.md en toda sesión, y
     existe porque la memoria automática NO viaja. La documentación lo dice
     textual: es local a la máquina y no se comparte con entornos de nube. En
     una sesión en la web, lo que no esté en el repo no existe, y la primera que
     corrimos dedujo mal el incidente del 21-ago teniendo la explicación a un
     archivo de distancia, porque solo estaba mencionada y no cargada. -->

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

**En una sesión en la nube esto es al revés y hay que mirarlo antes de escribir el comando.** Allá no existe `~/.railway/config.json`, así que el `RAILWAY_TOKEN` del entorno es la única credencial y `env -u` deja al CLI sin nada. La comprobación:

```bash
[ -f ~/.railway/config.json ] && echo "local: env -u RAILWAY_TOKEN" || echo "nube: railway directo"
```

## Deploy del dashboard (Vercel)

`apps/worker` va a Railway; `apps/web` va a Vercel y es un deploy aparte. Hay integración con GitHub, pero conviene forzarlo desde la raíz del repo:

```bash
vercel --prod --yes    # rootDirectory apps/web ya está en la config del proyecto
```

Dominio de producción: https://whatsapp-agent-mauve.vercel.app

Cuando un cambio toca worker y web, **deploya primero el worker**: la UI nueva suele depender de endpoints nuevos del worker.

## Agent skills

### Issue tracker

Los issues viven en Linear, workspace `Producto Con Daniel`, prefijo `PRO`, vía `mcp__linear-pcd__*`. Ver `docs/agents/issue-tracker.md`.

### Triage labels

Los cinco roles canónicos con su nombre por defecto: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Ninguna existe todavía en Linear. Ver `docs/agents/triage-labels.md`.

### Domain docs

Un solo contexto: `CONTEXT.md` en la raíz y `docs/adr/`. `CONTEXT.md` ya existe; `docs/adr/` todavía no. Ver `docs/agents/domain.md`.

## Sesiones en la nube

Este repo está preparado para correr en **Claude Code on the web**, para poder trabajar desde el celular sin depender de la máquina de Daniel. La configuración del entorno —setup script, dominios permitidos, variables— está en **`docs/nube/README.md`**.

Tres diferencias que muerden si no se saben:

1. **Railway al revés**, como dice la sección de deploy: en la nube el token es la credencial y no lleva `env -u`.
2. **No hay `.env`.** La base de producción llega como `DATABASE_PUBLIC_URL` en el ambiente; el dominio privado `postgres.railway.internal` no resuelve fuera de Railway.
3. **La memoria automática no viaja, y no hay forma de que viaje.** Es local a la máquina y no se comparte con entornos de nube; `autoMemoryDirectory` solo acepta rutas absolutas o `~/`, así que tampoco se puede meter en el repo. Una sesión en la nube arranca de un clon limpio: lo que no esté en el repo, no existe.

**La memoria acumulada sí viaja, porque se mudó al repo.** Vive en `.claude/memoria/`, su índice se importa arriba y `autoMemoryDirectory` apunta ahí en el `.claude/settings.local.json` de cada máquina —ruta absoluta, por eso no puede ir en el settings compartido—. Lo que se aprenda en esta máquina cae en el repo y llega a la nube en el siguiente clon.

**Lo que no cierra, y hay que compensarlo a mano:** una sesión en la nube que aprenda algo lo escribe en su VM, que es efímera. Así que cuando algo tenga que sobrevivir a la sesión, **no alcanza con guardarlo en memoria**. Si es una regla de cómo trabajar, va a `CLAUDE.md`; si es un hecho del negocio o una trampa de medición, va a `CONTEXT.md`. El repo es lo único que las dos puntas comparten de verdad.
