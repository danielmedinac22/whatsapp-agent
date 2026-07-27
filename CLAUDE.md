# CLAUDE.md

## Git / GitHub

El remote `origin` (`danielmedinac22/whatsapp-agent`) es **privado y pertenece a la cuenta personal `danielmedinac22`**.

Hay dos cuentas de GitHub autenticadas en `gh`: `danielmedinac2205` (correo de Simetrik) y `danielmedinac22` (dueña del repo). **Antes de `git push` o `git fetch`, la cuenta gh activa debe ser `danielmedinac22`** — si está activa `danielmedinac2205`, las operaciones fallan con "Repository not found".

```bash
gh api user --jq .login                 # ver la cuenta activa
gh auth switch --user danielmedinac22   # cambiar a la personal antes de push
```

El deploy a prod (`railway up`) no depende del push, pero el push mantiene el respaldo en GitHub al día. Ver el skill `deploy` para el flujo completo de deploy.
