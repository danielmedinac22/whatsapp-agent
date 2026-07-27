---
name: deploy
description: Deploy whatsapp-agent worker to Railway production. Use when the user asks to "deploy", "send to prod", "envía a prod", "deployar", "push to railway", "railway up", or any variant of shipping the current branch. Covers preflight (typecheck), DB migrations (generation + backfill + apply), commit/push, and the railway up command — including post-deploy verification of the Kapso connection.
---

# Deploy a producción (Railway)

Stack: monorepo pnpm con `apps/worker` (Hono + Kapso/WhatsApp Cloud API + tsx), `apps/web` (Next.js, deploy aparte en Vercel), `packages/db` (drizzle + Postgres). El servicio que se deploya con este skill es **whatsapp-worker** en Railway.

Sigue estos pasos en orden. **No saltes** la verificación de migraciones — la DB de Railway prod se conecta directamente desde el `.env` local, así que es fácil aplicar cambios destructivos por accidente.

## 1 · Preflight

Verifica que todo compile antes de tocar prod:

```bash
pnpm -r typecheck
```

Si falla en cualquier workspace, **detente y arregla**. No continúes con migraciones ni deploy si hay errores de tipos.

## 2 · Migraciones de DB (si tocaste schema)

> Si esta sesión NO modificó `packages/db/src/schema.ts`, salta a la sección 3.

### 2.1 · Cargar env y generar la migración

`drizzle-kit` exige `DATABASE_URL`, pero el `.env` no se auto-carga. Usa este patrón en TODA invocación que toque la DB:

```bash
set -a && source .env && set +a && pnpm --filter @wa/db generate
```

Esto crea un archivo nuevo en `packages/db/migrations/NNNN_*.sql`.

### 2.2 · Revisar y editar el SQL

**Drizzle no añade backfill automáticamente.** Lee la migración generada y mete UPDATEs manuales antes de los `CREATE INDEX` cuando:

- Añadiste columnas que deben poblarse desde columnas existentes (ej: split de `jid` legacy en `lid` / `pn_jid` según sufijo).
- Cambiaste un `uniqueIndex` por `index`/partial index — los datos pueden violar el nuevo unique si no haces backfill primero.

Patrón de backfill seguro (separadores de drizzle):

```sql
ALTER TABLE "contacts" ADD COLUMN "lid" text;--> statement-breakpoint
UPDATE "contacts" SET "lid" = "jid" WHERE "jid" LIKE '%@lid';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_lid_idx" ON "contacts" ("lid") WHERE "lid" IS NOT NULL;
```

### 2.3 · Aplicar la migración a prod

```bash
set -a && source .env && set +a && pnpm --filter @wa/db migrate
```

> ⚠️ **Esto modifica la DB de Railway prod inmediatamente.** El `DATABASE_URL` apunta a `shuttle.proxy.rlwy.net`. Solo aplica migraciones **additivas** (ADD COLUMN / CREATE INDEX) sin confirmar primero — si el cambio incluye DROP / RENAME / ALTER TYPE / NOT NULL en columnas pobladas, **avisa al usuario antes de correr `migrate`** y verifica que el código viejo siga funcionando con el schema nuevo (idealmente la migración debe ser compatible con la versión actual del worker en Railway hasta que el deploy nuevo la reemplace).

### 2.4 · Verificar el resultado

`psql` no está instalado. Usa un script tsx desde la raíz del repo:

```bash
cat > /tmp/check-db.ts <<'EOF'
import { getDb, contacts } from "@wa/db";
import { sql } from "drizzle-orm";
async function main() {
  const db = getDb();
  const rows = await db.select().from(contacts).orderBy(sql`created_at`);
  for (const r of rows) console.log(JSON.stringify(r));
  process.exit(0);
}
main();
EOF
cd /Users/danielmedina/Documents/whatsapp-agent && set -a && source .env && set +a && npx tsx /tmp/check-db.ts
rm /tmp/check-db.ts
```

> No uses top-level await en estos scripts — tsx lo bloquea con CJS. Envuélvelo en `async function main()`.

## 3 · Commit

Mensaje en español, con HEREDOC, scope-prefixed (`feat(area): …`, `fix(area): …`). Lista los cambios por ítem y termina con el `Co-Authored-By` de Claude.

```bash
git add <archivos específicos por nombre — nunca git add -A ni git add .>
git commit -m "$(cat <<'EOF'
feat(scope): titulo corto en español

- bullet 1
- bullet 2
- bullet 3

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## 4 · Push a GitHub

```bash
git push origin main
```

Mantiene `main` sincronizado con lo que sube `railway up`. Saltarse el push deja prod desincronizada respecto al repo y rompe cualquier auto-deploy futuro vía GitHub integration.

## 5 · Deploy a Railway

El proyecto está vinculado (`railway status` → `whatsapp-agent`/`production`), pero no tiene servicio default. Pasa el servicio explícito:

```bash
railway up --service whatsapp-worker --ci
```

- `--ci` evita el modo interactivo (necesario en sesiones no-TTY).
- La build corre `pnpm install --frozen-lockfile && pnpm --filter @wa/worker build` (definido en `railway.json`).
- El `startCommand` es `pnpm --filter @wa/worker start` — **no corre migraciones** automáticamente. Por eso el paso 2 va antes que este.
- Timeout: usa `timeout: 300000` (5 min) en la llamada Bash; el build Docker suele tardar 90-180s.

## 6 · Verificación post-deploy

```bash
sleep 8 && railway logs --service whatsapp-worker 2>&1 | tail -25
```

Busca:
- `worker listening port=8080` ✅
- `kapso template poll worker started` ✅
- `outbound worker started` / `follow-up worker started` / `remarketing worker started` ✅

## 7 · Verificación de la conexión Kapso

Con la Cloud API **no hay QR ni sesión que se pierda en el redeploy** — el webhook y el número siguen conectados en Kapso. Tras el deploy verifica:

```bash
curl -s -H "Authorization: Bearer $WORKER_API_TOKEN" "$PUBLIC_URL/api/kapso/status" | head -c 500
```

Debe responder `connection.phoneNumberId` no nulo. Si el worker cambió de URL pública (dominio Railway nuevo), re-registra el webhook con `POST /api/kapso/connect {"phoneNumberId": "..."}` y actualiza `PUBLIC_URL`.

## Resumen de comandos en orden

```bash
# 1. preflight
pnpm -r typecheck

# 2. migraciones (solo si tocaste schema)
set -a && source .env && set +a && pnpm --filter @wa/db generate
# … editar SQL para añadir backfill si aplica …
set -a && source .env && set +a && pnpm --filter @wa/db migrate

# 3. commit + push
git add <archivos>
git commit -m "$(cat <<'EOF'
feat(scope): …
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main

# 4. deploy
railway up --service whatsapp-worker --ci

# 5. verificación
sleep 8 && railway logs --service whatsapp-worker 2>&1 | tail -25
```

## Lo que NO debes hacer

- ❌ `git add -A` o `git add .` — riesgo de incluir secretos del `.env` o artefactos.
- ❌ `git push --force` a `main` — es la rama de prod en GitHub.
- ❌ Aplicar migraciones destructivas (DROP, NOT NULL en columnas con datos, ALTER TYPE) sin confirmar con el usuario — la DB del `.env` ES la de prod.
- ❌ `railway up` sin `--service` — falla en non-interactive.
- ❌ Asumir que `DATABASE_URL` está en el ambiente — siempre `set -a && source .env && set +a` antes de comandos drizzle.
