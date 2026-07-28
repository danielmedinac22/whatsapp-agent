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

## Deploy del dashboard (Vercel)

`apps/worker` va a Railway; `apps/web` va a Vercel y es un deploy aparte. Hay integración con GitHub, pero conviene forzarlo desde la raíz del repo:

```bash
vercel --prod --yes    # rootDirectory apps/web ya está en la config del proyecto
```

Dominio de producción: https://whatsapp-agent-mauve.vercel.app

Cuando un cambio toca worker y web, **deploya primero el worker**: la UI nueva suele depender de endpoints nuevos del worker.
