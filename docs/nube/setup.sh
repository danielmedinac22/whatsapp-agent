#!/bin/bash
# Setup script del entorno de nube de Claude Code.
#
# Se pega en el campo **Setup script** del entorno, en claude.ai/code. NO se
# ejecuta desde el repo: esta copia existe para que el script tenga historia y
# se pueda revisar en un diff, porque el campo de la web no la tiene.
#
# Tres reglas que la documentación impone y que este script respeta:
#   1. Tiene que salir con código 0, o la sesión no arranca. De ahí los `|| true`.
#   2. Tiene que terminar en unos cinco minutos, para que el snapshot se pueda
#      construir. Por eso los instaladores van en paralelo.
#   3. Corre como root sobre Ubuntu 24.04, una sola vez por entorno: después
#      Anthropic fotografía el disco y las sesiones siguientes arrancan de ahí.
#
# Lo que NO va acá: `pnpm install`. Eso es del proyecto y tiene que pasar igual
# en local, así que vive en el hook `SessionStart` de `.claude/settings.json`.

set -u

# La versión de pnpm la manda el `packageManager` del package.json. Sin fijarla,
# `pnpm install --frozen-lockfile` puede quejarse contra la que traiga la imagen.
corepack enable || true
corepack prepare pnpm@10.30.3 --activate || true

# Los dos CLI de deploy, en paralelo. Ninguno viene preinstalado.
npm install -g @railway/cli &
npm install -g vercel &
wait

# `psql` ya viene con el PostgreSQL 16 de la imagen; esto solo lo confirma en el
# log del arranque, para no descubrirlo a mitad de un diagnóstico.
psql --version || true
railway --version || true
vercel --version || true

exit 0
