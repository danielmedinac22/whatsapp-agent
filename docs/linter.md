# El linter del repo

`pnpm -r lint` corre ESLint 9 en los cuatro workspaces. Este archivo dice qué
herramienta se eligió, con qué reglas arrancó y **qué quedó apagado**, que es la
parte que se olvida.

Si vas a apagar una regla, anotala acá. Una regla apagada sin registro es una
regla que nadie va a volver a prender.

---

## Por qué hubo que tocar esto

El repo tenía linter en el papel y no en los hechos. `apps/web` traía
`"lint": "next lint"`, y **Next 16 quitó ese comando**: `next` interpreta `lint`
como el directorio del proyecto y muere antes de mirar un solo archivo.

```
Invalid project directory provided, no such directory: .../apps/web/lint
```

No fallaba a veces: no podía funcionar, y venía así desde que el repo subió a
Next 16. `apps/worker`, `packages/db` y `packages/shared` no tenían linter ni
script — nunca lo tuvieron.

## La herramienta: ESLint, no Biome

Las dos opciones reales eran migrar a la CLI de ESLint o cambiar a Biome. Se
eligió **ESLint**, por tres razones concretas:

1. **Ya estaba instalado y configurado.** `apps/web` tenía `eslint@9` y
   `eslint-config-next@16` en devDependencies. Pasar de `next lint` a `eslint .`
   es [la migración que documenta Next](https://nextjs.org/docs/app/api-reference/config/eslint)
   y no trajo ninguna dependencia nueva para el panel.

2. **Biome no tiene las reglas que acá encontraron algo.** De los 10 hallazgos
   de la primera pasada sobre `apps/web`, **8 salieron de
   `eslint-plugin-react-hooks` v7** — las reglas del React Compiler
   (`set-state-in-effect`, `purity`). Los otros 2 eran `@next/next/*` sobre un
   bundle minificado de terceros y hoy están ignorados por carpeta.

   Biome no implementa ninguna de las dos familias. Elegirlo habría sido cambiar
   de herramienta para dejar de ver justo lo único que la herramienta vieja veía
   — y quedarse sin las reglas de `@next/next/*` para lo que venga.

3. **Una sola cadena para todo el monorepo.** El worker se cubre con la misma
   base que el panel; no hay dos linters que discutan entre sí.

Lo que se paga por elegir ESLint es velocidad. Medido en este repo:
`pnpm -r lint` tarda **~3,7 s** sobre 303 archivos (324 con `pnpm lint`). Biome estaría en el orden de
las décimas de segundo. A esta escala la diferencia no compra nada; si el repo
creciera mucho, esta decisión se puede revisar — pero entonces habría que
aceptar perder las reglas del punto 2.

## Cómo está armado

```
eslint.config.base.mjs        la base compartida (las reglas viven acá)
eslint.config.mjs             la raíz: cubre scripts/ y los .mjs de config
apps/web/eslint.config.mjs    base + eslint-config-next
apps/worker/eslint.config.mjs base
packages/db/eslint.config.mjs base
packages/shared/…             base
```

Cada workspace tiene su `eslint.config.mjs` y su `"lint": "eslint ."`, así que
`pnpm -r lint` lintea los cuatro. `pnpm lint` (en la raíz) corre eso **y además**
`scripts/`, que no es un workspace y por eso `-r` no lo alcanza.

El único `eslint` instalado está en la raíz; los workspaces lo resuelven por el
`.bin` de la raíz y no lo declaran cada uno.

### Reglas encendidas

| Dónde | Qué |
|---|---|
| Todos | `@eslint/js` → `recommended` |
| Todos | `typescript-eslint` → `recommended` (**sin tipos**, ver abajo) |
| `apps/web` | `eslint-config-next/core-web-vitals` (= `next/core-web-vitals` + `next/typescript`) |

Es un conjunto acotado a propósito. La idea fue arrancar con algo que pase en
verde hoy y se pueda apretar después, no con algo exhaustivo que todos ignoren.

---

## Lo que quedó apagado

### 1. `react-hooks/set-state-in-effect` y `react-hooks/purity` — apagadas

**Dónde:** `apps/web/eslint.config.mjs`.

Son reglas nuevas de `eslint-plugin-react-hooks` v7 (las del React Compiler).
Marcan cosas ciertas, pero arreglarlas es refactor de componentes con riesgo de
comportamiento, no trabajo de linter. Hoy son **8 ocurrencias**, y esta es la
lista completa — es la lista de tareas de quien las vuelva a prender:

```
apps/web/src/app/(app)/agent/agent-form.tsx:375          purity           (Date.now en render)
apps/web/src/app/(app)/vendedor/vendedor-form.tsx:445    purity           (Date.now en render)
apps/web/src/app/(app)/agent/prompt-card.tsx:411         set-state-in-effect
apps/web/src/app/(app)/catalogo/catalogo-client.tsx:144  set-state-in-effect
apps/web/src/app/(app)/orders/orders-table.tsx:143       set-state-in-effect
apps/web/src/app/(app)/inbox/inbox-client.tsx:318        set-state-in-effect
apps/web/src/app/(app)/inbox/inbox-client.tsx:416        set-state-in-effect
apps/web/src/app/(app)/inbox/inbox-client.tsx:432        set-state-in-effect
```

Se apagaron en vez de dejarlas en `warn` porque tres de las ocho viven en
`inbox-client.tsx`, que en ese momento era de otro worktree: habrían sido ruido
permanente que nadie podía callar. Un aviso que no se puede atender enseña a
ignorar la salida entera.

**Para volver a verlas sin cambiar nada:**

```bash
pnpm --filter @wa/web exec eslint . \
  --rule '{"react-hooks/set-state-in-effect":"error","react-hooks/purity":"error"}'
```

**Para prenderlas de verdad:** borrá el bloque `rules` del final de
`apps/web/eslint.config.mjs`.

### 2. `@typescript-eslint/no-explicit-any` — apagada solo en tests

**Dónde:** `eslint.config.base.mjs`, acotada a `**/*.test.{ts,tsx}` y `**/*.spec.{ts,tsx}`.

Los helpers de test arman payloads crudos a mano — por ejemplo
`apps/worker/src/kapso/inbound.test.ts`, que fabrica payloads de Kapso y les
cuelga un `referral` en distintos sitios. Con `Record<string, unknown>` cada uno
de los ~15 sitios que hacen `p["message"].referral = …` deja de compilar y hay
que castear en cada aserción: más ruido y ninguna seguridad de más.

En código de producción la regla sigue encendida. Hoy hay **cero** `any` fuera
de tests.

### 3. `no-unused-vars` deja pasar lo que empieza con `_`

**Dónde:** `eslint.config.base.mjs` (`argsIgnorePattern` / `varsIgnorePattern`).

Convención de siempre: un argumento que empieza con `_` está sin usar a
propósito. No es un permiso nuevo, es la forma de decirlo.

### 4. Un `eslint-disable-next-line` suelto, en `apps/web/src/auth.ts`

`import type { JWT } from "next-auth/jwt"` **parece** muerto y no lo está: es lo
que mete el módulo en el programa para poder aumentarlo más abajo. Sin él,
TypeScript falla con TS2664. ESLint no mira las augmentaciones, así que no puede
saberlo.

Es el único disable local del repo. Si aparece otro, que venga con su comentario
diciendo por qué el linter se equivoca.

### 5. Carpetas que no se lintean

| Carpeta | Por qué |
|---|---|
| `apps/web/public/**` | `opus/encoderWorker.min.js` es un bundle minificado de terceros |
| `.agents/**` | skills ancladas por hash en `skills-lock.json`, se reinstalan pisadas |
| `apps/web/next-env.d.ts` | lo genera Next en cada build |
| `**/dist`, `**/build`, `**/.next`, `**/coverage` | salida de build |

---

## El siguiente apretón, ya medido

Lo que falta es **linting con tipos** (`typescript-eslint` →
`recommendedTypeChecked`). Es donde viven las reglas que de verdad atrapan bugs
en este repo — `no-floating-promises` y `no-misused-promises`, con un worker
lleno de jobs asíncronos.

No entró ahora porque no pasa en verde. Medido sobre `apps/worker`:

| | |
|---|---|
| Hallazgos que agrega | **61** |
| Costo en tiempo | ~4,4 s vs ~3,7 s |

Los 61 se reparten así, y el reparto dice cómo encararlo:

```
20  no-unnecessary-type-assertion     ← mecánico, casi todo autofix
15  no-unsafe-member-access
 6  no-unsafe-assignment              ← los tres salen de los mismos pocos `any`
 3  no-unsafe-argument
 3  no-misused-promises               ← estos son los que importan
 1  no-floating-promises              ←
 3  no-base-to-string
 2  no-unsafe-return
 2  restrict-template-expressions
 2  require-await
 …
```

La forma barata de entrar: prender solo `no-floating-promises` y
`no-misused-promises` (4 hallazgos, no 61) con `projectService: true`, y dejar
las de `no-unsafe-*` para cuando se tipen los pocos `any` de los que cuelgan.

## Cómo se corre

```bash
pnpm -r lint          # los cuatro workspaces
pnpm lint             # los cuatro + scripts/
pnpm -r lint --fix    # arregla lo autofixable en los cuatro
```

Ojo con `pnpm lint --fix`: **no hace lo que parece**. El script de la raíz es
compuesto (`pnpm -r lint && eslint .`), así que el `--fix` se pega al final y
solo alcanza a `scripts/`. Para arreglar todo, `pnpm -r lint --fix`.

No está enganchado a CI ni a un hook de pre-commit. Es a propósito: primero que
exista y esté en verde, después que sea obligatorio.
