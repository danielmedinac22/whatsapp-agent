# Entrega · PRO-23 · El repo no tiene linter corriendo

Rama `danielmedinac22/linter`. Verde. Sin deploy, sin merge.

## Qué pasaba

Confirmado tal cual decía el ticket, y la hipótesis era correcta:

```
$ pnpm -r lint
apps/web lint$ next lint
apps/web lint: Invalid project directory provided, no such directory: …/apps/web/lint
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @wa/web@0.0.0 lint: `next lint`
```

Next 16 quitó `next lint` y `next` lee el argumento `lint` como el directorio del
proyecto. No es intermitente: no puede funcionar. Los otros tres workspaces no
tenían linter ni script — nunca lo tuvieron.

## Qué se hizo

**ESLint 9 con flat config, en los cuatro workspaces.** El razonamiento completo
—incluido por qué no Biome— está en **[`docs/linter.md`](../../docs/linter.md)**,
que es el archivo que sobrevive a esta entrega. Resumen de una línea: `apps/web`
ya tenía `eslint` y `eslint-config-next` instalados, la migración oficial de Next
es exactamente esta, y Biome no implementa las reglas de
`eslint-plugin-react-hooks` v7, que fueron **las únicas que encontraron algo
real** acá (8 de 10 hallazgos).

```
eslint.config.base.mjs         reglas compartidas — el único lugar donde tocarlas
eslint.config.mjs              raíz: scripts/ y los .mjs de config
apps/web/eslint.config.mjs     base + eslint-config-next/core-web-vitals
apps/{worker}/…                base
packages/{db,shared}/…         base
```

Cada workspace tiene `"lint": "eslint ."`, así que `pnpm -r lint` los lintea a
los cuatro. `pnpm lint` en la raíz corre eso y además `scripts/`, que no es un
workspace y `-r` no alcanza. `eslint` se instaló **solo en la raíz**; los
workspaces lo resuelven por el `.bin` de arriba.

### El conjunto de reglas: acotado, como pedía el ticket

`@eslint/js` recommended + `typescript-eslint` recommended **sin tipos**, más
`eslint-config-next/core-web-vitals` en el panel. Nada más.

El linting con tipos (`recommendedTypeChecked`) es el siguiente escalón y quedó
**medido, no adivinado**: agrega 61 hallazgos solo en el worker. `docs/linter.md`
trae el desglose por regla y la forma barata de entrar (prender solo
`no-floating-promises` y `no-misused-promises` — 4 hallazgos, no 61).

### Se arreglaron 9 hallazgos en vez de apagar 3 reglas

El repo resultó estar mucho más limpio de lo que el ticket temía: **21 hallazgos
en 303 archivos**, no cientos. Con esa cuenta, apagar reglas por comodidad no se
justificaba, así que se arreglaron los que eran triviales:

- 6 imports muertos (`contactWaId`, `contacts`, `Operation`, `bigint`, `eq`, `db`)
- 1 regex con dos espacios literales → `{2}`, semántica idéntica
  (`scripts/ensayo-bandeja-a-escala.ts`, el separador de columnas del EXPLAIN)
- 1 default export anónimo en `postcss.config.mjs`
- 1 `.eslintrc.json` viejo borrado

Ningún cambio de comportamiento. `pnpm test` da los mismos 915 + 16.

### Lo que quedó apagado, y por qué está anotado y no escondido

Todo está en `docs/linter.md`, con la lista de ocurrencias archivo por línea y el
comando para volver a verlas. En corto:

| Qué | Alcance | Por qué |
|---|---|---|
| `react-hooks/set-state-in-effect`, `react-hooks/purity` | `apps/web` | 8 ocurrencias, todas listadas. Arreglarlas es refactor de componentes con riesgo de comportamiento, no trabajo de linter |
| `@typescript-eslint/no-explicit-any` | **solo** `*.test.ts(x)` | los helpers de test arman payloads crudos a mano; `unknown` rompe ~15 sitios y no agrega seguridad. En producción sigue encendida, y hoy hay cero `any` |
| `no-unused-vars` con prefijo `_` | todos | convención de siempre |

Las dos de `react-hooks` se apagaron en vez de dejarlas en `warn` porque **tres
de las ocho viven en `inbox-client.tsx`**, que era de otro worktree: habrían sido
ruido permanente que nadie podía callar, y un aviso que no se puede atender
enseña a ignorar la salida entera. La lista completa queda como lista de tareas.

Hay **un solo** `eslint-disable` local en todo el repo:
`apps/web/src/auth.ts`, donde `import type { JWT }` parece muerto y no lo está —
es lo que mete el módulo en el programa para aumentarlo, y sin él TypeScript
falla con TS2664. El comentario en español que ya estaba ahí explicaba justo eso.
Es el caso que el encargo anticipaba: **ninguna regla castiga los comentarios en
español ni el código deliberado**, y donde el linter se equivocó, se anotó por
qué en vez de cambiar el código.

## El piso

| | |
|---|---|
| `pnpm -r lint` | exit 0 · ~3,7 s · 303 archivos |
| `pnpm lint` | exit 0 · 324 archivos (suma `scripts/`) |
| `pnpm -r typecheck` | exit 0 |
| `pnpm test` | exit 0 · 915 del worker + 16 del panel |
| `pnpm --filter @wa/web build` | exit 0 |

## Lo que hay que saber para revisar

- **Dependencias nuevas, todas en la raíz y todas devDependencies:** `eslint`,
  `typescript-eslint`, `@eslint/js`, `globals`. Las cuatro ya estaban en el store
  de pnpm como transitivas de `eslint-config-next`; el lockfile creció 30 líneas.
- **No se tocó** `apps/web/src/app/(app)/inbox/inbox-client.tsx` ni
  `apps/web/src/lib/queries.ts`. Los dos aparecen en los hallazgos y los dos
  quedaron intactos.
- **No está enganchado a CI ni a pre-commit**, a propósito: primero que exista y
  esté en verde, después que sea obligatorio. Es una línea en el workflow cuando
  se quiera.
- El diff de código de producción son 6 imports muertos y un regex equivalente.
  El resto es configuración y documentación.
