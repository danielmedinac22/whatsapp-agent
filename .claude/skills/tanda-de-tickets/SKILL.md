---
name: tanda-de-tickets
description: Trabajar VARIOS tickets a la vez desde una sesión que planea y reparte a worktrees en paralelo. Usar cuando llegan varios tickets juntos (una lista pegada, varios números de .scratch/<mapa>/issues/), cuando hay que decidir cómo agrupar trabajo entre sesiones, o cuando esta sesión va a coordinar y mergear el trabajo de otras.
---

# tanda-de-tickets — planear, repartir, verificar y cerrar

Flujo para cuando llegan varios tickets juntos y una sesión los orquesta en vez
de implementarlos.

**La sesión que planea NO implementa.** Mide, decide con el humano, reparte,
verifica y deploya. Si se pone a codear, deja de ver el conjunto — que es lo
único que ella puede ver y las sesiones hijas no.

> **De dónde sale esto.** El método viene de una tanda en `waichat-app`
> (12–13 ago 2026): siete tickets llegaron juntos y salieron los siete a
> producción en dos días, más cinco hallazgos que nadie había pedido. Los
> números que aparecen abajo como evidencia de una regla son **de esa tanda**;
> las rutas, los archivos, los comandos y las trampas son de este repo.

> **Este repo no es Aura.** Si vienes del skill homónimo de `simon/`, cuatro
> cosas están invertidas y son justo las que matan una tanda: **aquí sí hay
> producción viva y se mide consultándola**, **el piso de tests casi no
> existe**, **el push no deploya nada** y **no hay modo observador que impida
> escribirle a un cliente real**. Lee los pasos 1, 5, 6 y 9 antes de repartir.

---

## 1. Antes de repartir: aterrizar cada ticket en el código Y medirlo

No leas los tickets y los repartas. **Mídelos.** Casi siempre la medición
cambia la especificación, y cambiarla antes de que exista el código es gratis.
En la tanda de origen, cuatro de siete tickets cambiaron de spec al medirlos —
uno iba a cancelar 1.815 pedidos, 1.716 de ellos sin que jamás se les hubiera
escrito.

**Aquí medir es consultar producción, y eso se puede hacer hoy mismo.** El
sistema lleva meses corriendo con clientes reales: al cerrar el mapa del Panel
de Ventas la tasa de confirmación medida era **88,4% (1.449 de 1.640
pedidos)**, y ese número salió de la base, no de una estimación. Las cuatro
fuentes:

| Fuente | Qué responde |
| -- | -- |
| La DB de producción (Railway) | Los datos duros: cuántos pedidos, qué estados, qué se envió de verdad |
| `.scratch/<mapa>/issues/` | Si la pregunta ya se hizo, y qué alternativa se mató y por qué |
| `.scratch/<mapa>/map.md` | Los hechos ya verificados contra el código, y los términos que no se re-litigan |
| `git log` | Qué cambió y cuándo — el README no lo cuenta |

**Cómo se consulta la base.** `psql` no está instalado y `DATABASE_URL` no se
auto-carga. Script `tsx` desde la raíz, y **sin top-level await** — tsx lo
bloquea con CJS:

```bash
cat > /tmp/medir.ts <<'EOF'
import { getDb, dropiOrders } from "@wa/db";
import { sql } from "drizzle-orm";
async function main() {
  const db = getDb();
  const rows = await db.select({ n: sql<number>`count(*)`, estado: dropiOrders.status })
    .from(dropiOrders).groupBy(dropiOrders.status);
  for (const r of rows) console.log(JSON.stringify(r));
  process.exit(0);
}
main();
EOF
set -a && source .env && set +a && npx tsx /tmp/medir.ts
rm /tmp/medir.ts
```

> ⚠️ **El `DATABASE_URL` del `.env` ES el de producción** (`shuttle.proxy.rlwy.net`).
> Medir es leer: `SELECT` sí, `UPDATE`/`DELETE` nunca sin que el humano lo
> autorice explícitamente. Y **jamás `pnpm db:push` para "probar"** — reescribe
> el esquema de prod sin migración y sin registro.

**Una consulta que falla no es un dato que no existe.** Si revienta por nombre
de tabla o columna, lee `packages/db/src/schema.ts` (764 líneas, 18 tablas). Los
nombres del código son camelCase y los de SQL snake_case (`dropiOrders` →
`dropi_orders`), y varias tablas de configuración son **de fila única**
(`agent_settings` con `id=1`, `kapso_connection`, `shopify_connection`,
`dropi_connection`). Un ticket que pida "una segunda conexión" o "otro
vendedor" está pidiendo un cambio de modelo de datos, no un campo más — eso ya
está medido y escrito en `.scratch/panel-de-ventas/map.md`.

**Y ojo: aquí no hay cadena de autoridad, hay un README que miente.** No existe
`docs/decisiones.md`. La autoridad práctica, de mayor a menor, es: el `spec.md`
del mapa → los issues con `## Answer` → el código. **El `README.md` de la raíz
está desactualizado** — describe el transporte como Baileys, y desde `31fc213`
(migración a Kapso / Cloud API oficial) eso es falso. No lo cites como fuente
sin verificarlo contra el código.

## 2. Sacar las decisiones ANTES, en rondas, con recomendación

Usa `mattpocock-skills:grilling` — es el skill que ya usan los mapas de este
repo. **Los hechos son tu trabajo; las decisiones son del humano.** Nunca le
preguntes algo que puedas medir.

Cada pregunta lleva **tu recomendación**. Sin recomendación, una ronda de ocho
preguntas es una carga; con recomendación, es una revisión rápida.

Y cuando la respuesta choca con la realidad, **vuelve a preguntar con el número
en la mano** — no la implementes mal por no contradecir.

**Hay un tercer tipo de pregunta: las que no decide ni la medición ni Daniel.**
Aquí son de dos clases, y las dos congelan un worktree por días si se confunden
con decisiones nuestras:

- **Las que dependen del cliente** (Vorare): número dedicado, cuentas de Kapso y
  OpenRouter a su nombre, catálogo de productos e IDs de anuncio.
- **Las que dependen de Meta**: toda plantilla nueva pasa por aprobación, y esa
  aprobación no la controlamos. Un ticket que estrena plantilla tiene camino
  crítico externo — se manda a aprobar **primero**, antes de repartir el código
  que la usa, no al final.

Se identifican y se dejan explícitamente fuera, con el ticket que las espera.

## 3. Escribir lo decidido DENTRO del ticket

Cada sesión hija arranca en frío. Lo que no esté en el ticket, no lo hereda.

El ticket **es un archivo**: `.scratch/<mapa>/issues/NN-<slug>.md`. Al cerrar el
grilling, escribe ahí la respuesta bajo `## Answer` — qué se acordó, **por qué**,
y qué queda descartado, con los números que lo sostienen. Eso es lo que evita
que la sesión hija re-litigue lo ya resuelto, o peor, decida distinto.

El formato ya existe en el repo y no se inventa uno nuevo:

- Cabecera `Type:` / `Status:` / `Blocked by:` antes de `## Question`.
- **`Status: claimed` se pone y se guarda ANTES de trabajar** — es lo único que
  evita que dos sesiones en paralelo tomen el mismo ticket.
- **La numeración es por mapa, no global.** `panel-de-ventas` va por 11,
  `ventas-cierre-orden` por 5. Dos mapas pueden tener un `03` cada uno sin
  problema; dos sesiones dentro del **mismo** mapa, no. Ver el paso 4.
- El índice del mapa es `map.md`, no un `README.md`. Si la tanda cambia el
  alcance, la sección *Aguas abajo* de `map.md` es lo que hay que actualizar.

**`.scratch/` está commiteado a propósito** (decisión de 16 ago 2026): así el
ticket viaja en el diff y la sesión hija lo tiene en su worktree sin pedirle
nada a nadie. La contrapartida es que ahora sí se pisa — ver el paso 4 — y que
`artefacto.html` y `prd.html` llevan precios y términos de cliente: el repo es
privado y debe seguir siéndolo.

## 4. Repartir por superficie, no por ticket

**Los archivos mandan sobre el agrupamiento, no los tickets.**

Tres tickets distintos que caen en el mismo renglón de la misma tabla son UNA
conversación de diseño y UN worktree. Dos tickets que no comparten archivo van
en paralelo aunque suenen parecidos.

Regla práctica: **un archivo grande tiene un solo dueño por vez.** En la tanda
de origen, un archivo de 3.774 líneas lo tocaban cuatro tickets; se le prohibió
a todos menos a uno y no hubo un solo conflicto en esa pantalla. El repo entero
son ~16.300 líneas de TS/TSX, así que los candidatos son pocos y se saben:

| Archivo | Líneas |
| -- | -- |
| `apps/web/src/app/(app)/inbox/inbox-client.tsx` | 1.023 |
| `packages/db/src/schema.ts` | 764 |
| `apps/worker/src/dropi/auth.ts` | 585 |
| `apps/web/src/app/(app)/agent/prompt-card.tsx` | 544 |
| `apps/web/src/app/(app)/agent/agent-form.tsx` | 533 |
| `apps/worker/src/jobs/outbound.ts` | 519 |
| `apps/web/src/app/(app)/connection/dropi-panel.tsx` | 510 |
| `apps/web/src/app/(app)/orders/orders-table.tsx` | 507 |
| `apps/worker/src/kapso/client.ts` | 417 |

**Cuatro recursos globales que se pisan sin que ningún test lo vea:**

1. **`packages/db/src/schema.ts`** — es la costura del monorepo. Casi todo
   ticket que agregue algo lo toca, y de él salen tipos que usan `web` y
   `worker` a la vez. Si dos tickets lo necesitan, van juntos o van en serie.
2. **La numeración de migraciones** (`packages/db/migrations/NNNN_*.sql`, hoy
   por `0019`). Dos worktrees en paralelo generan `0020` los dos. **Repártelos
   tú desde acá.**
3. **El número del próximo ticket libre dentro de cada mapa.** Dos sesiones
   trabajando el mismo mapa crean el mismo número. Repártelos tú.
4. **`map.md` del mapa activo** — toda sesión que cierre un ticket lo toca. Si
   dos lo hacen, conflicto de merge garantizado.

Y separa **la mitad que se ve de la que no**: `apps/worker` avanza sin el
humano, `apps/web` espera su veredicto visual. Así el prototipado no bloquea el
resto — y encima son dos deploys distintos (paso 6).

## 5. El encargo va en un archivo, no en el prompt

Escribe un briefing por worktree en el scratchpad y pásale la ruta:

```bash
orca worktree create --project github:danielmedinac22/whatsapp-agent \
  --name <slug> --json
# la ruta del workspace sale del JSON — no la adivines
orca terminal create --worktree "path:<ruta-del-json>" \
  --title "NN <tema>" \
  --command "claude-personal 'Lee <ruta-absoluta>.md — es tu encargo completo. Ejecutalo de punta a punta sin pedirme permiso para arrancar.'"
```

Sin `--agent` (ese lanza el `claude` pelado con el perfil que Orca pisa). Y sin
`--linear-issue`: **este repo no tiene Linear** — el puntero al ticket va dentro
del briefing, como ruta `.scratch/<mapa>/issues/NN-<slug>.md`. El archivo evita
el infierno de comillas y deja la sesión trabajando desde el primer turno.

**El worktree nace sin `.env`.** Está gitignoreado, así que la sesión hija no
puede medir ni correr nada contra la base hasta que se lo copies. Cópialo tú
deliberadamente, ticket por ticket, y solo si ese encargo de verdad necesita
tocar datos: es la llave de producción.

**Qué lleva el briefing** — las cinco secciones que hicieron falta:

1. **Su trabajo en una frase**, y la ruta del ticket para el detalle.
2. **Lo medido, con números.** No "hay pocos pedidos sin confirmar": el número.
   El número le da criterio para decidir sola.
3. **Las trampas del repo que no debe redescubrir:**
   - **El `.env` apunta a producción.** No hay base de desarrollo. Leer sí;
     escribir, solo lo que el encargo autorice por escrito.
   - **`pnpm db:push` no se usa nunca** contra ese `.env` — reescribe el esquema
     de prod sin migración. Se genera migración y se aplica.
   - **Drizzle no escribe el backfill.** La migración generada se lee y se
     edita a mano (UPDATEs antes de los `CREATE INDEX`) **antes** de aplicarla.
     Una vez aplicada a prod, es intocable: se añade otra.
   - **La cuenta de `gh` se cambia sola.** Antes de `git push` o `git fetch`:
     `gh auth switch --user danielmedinac22`. Si está activa
     `danielmedinac2205`, falla con "Repository not found" y parece otra cosa.
   - **El autor del commit debe ser `danielmedina2205@gmail.com`** (ya está en
     la config local del repo). Vercel bloquea todo deploy cuyo autor no tenga
     asiento — y se cuelga sin error visible.
   - `psql` no está instalado; se consulta con `tsx`, sin top-level await, y
     precedido de `set -a && source .env && set +a`.
   - Los tests viven **solo** en `apps/worker` (`pnpm --filter @wa/worker test`).
     No hay script `test` en la raíz. No inventes uno a mitad de un ticket.
4. **Qué NO hacer.** Qué archivo no tocar, qué no deployar, y sobre todo:
   **no mandar mensajes a números de clientes reales.** Aquí no hay red: no
   existe allowlist ni modo observador, y `dropi_dry_run` — el único freno del
   sistema — cubre **solo las confirmaciones a Dropi**, no el envío de WhatsApp.
   Un worker corriendo en local con ese `.env` le escribe a gente de verdad. Si
   un encargo necesita probar un envío, el número de prueba y la autorización
   los pone el humano, no la sesión.
5. **Cómo verificar de verdad.** El piso es `pnpm -r typecheck` limpio. **Y el
   piso es bajísimo**: son 41 tests en 4 archivos, todos en `apps/worker`
   (`kapso/inbound`, `kapso/delivery`, `dropi/normalize`, `dropi/movements`).
   Verde no significa correcto — significa que compila y que esas cuatro cosas
   siguen igual. El criterio de terminado se escribe en términos del
   comportamiento observable: qué se ve en el dashboard, qué fila queda en la
   base, qué log sale del worker. Y quién hace la verificación visual (el
   humano, en el preview de Vercel).

Cierra con una línea que vale por sí sola: **el ticket es una hipótesis, no una
orden.** Si al medir la causa resulta ser otra, que lo diga y cambie el rumbo.
Pasó dos veces en la tanda de origen, y las dos veces el hallazgo valía más que
el ticket original.

## 6. La sesión que planea es el único que deploya

Las hijas entregan rama verde y avisan. **Ellas no mergean ni deployan** — y
aquí eso importa más que en un repo con auto-deploy, porque **el push no
despliega nada**. Son dos deploys manuales, y el orden no es negociable:

```bash
railway up --service whatsapp-worker --ci   # 1º — timeout 300000, la build tarda 90-180s
vercel --prod --yes                          # 2º — rootDirectory apps/web ya configurado
```

**Worker primero, web después**: la UI nueva casi siempre depende de endpoints
nuevos del worker. Al revés, el dashboard queda llamando a algo que no existe.
El flujo completo — preflight, migraciones, commit, push, verificación de logs y
de la conexión Kapso — está en el skill `deploy`. Úsalo; no lo reimplementes.

Antes de cada merge:

- **`git fetch` y `merge-tree --write-tree` contra el `main` de AHORA.** Dos
  ramas verdes por separado pueden romperse al unirse; el conflicto solo existe
  en la unión y ningún check local lo ve.
- **Si dos ramas tocan archivos comunes**, mergea una y manda a rebasar a la
  otra ANTES de que empiece — si rebasa antes, rebasa dos veces.
- **Revisa los cuatro recursos globales del paso 4** — `schema.ts`, número de
  migración, número de ticket del mapa, `map.md`. Son lo más fácil de pisar y lo
  más silencioso.
- **Las migraciones se aplican a mano y antes del deploy** (`pnpm --filter @wa/db
  migrate`), porque el `startCommand` de Railway no las corre. Si dos ramas
  traen migración, aplícalas en el orden en que mergeaste, y revisa que la
  primera siga siendo compatible con el worker viejo hasta que arranque el nuevo.

## 7. Verificar lo que reportan las sesiones

Los reportes son buenos y aun así hay que comprobarlos. En la tanda de origen,
dos veces:

- Una dijo "quedarán 354 → 1". Quedaron **80**: una cosa es que el mapeo
  *entienda* el estado y otra que el sync lo *reescriba*, y solo reescribe lo
  que el proveedor sigue devolviendo.
- Una rama *parecía* chocar con otra — mismos archivos en el diff. Era
  espejismo: su base era anterior. Contra la base común no se cruzaban.

Comprueba **la afirmación más riesgosa**, no todas. Suele ser una. Aquí las
candidatas son siempre del mismo tipo: "no le escribió a nadie", "la migración
es additiva", "el dry-run seguía puesto", "el webhook quedó registrado en el
número correcto". Las tres primeras se comprueban con una consulta a
`outbound_messages` o al SQL de la migración; la cuarta, con
`GET /api/kapso/status`.

## 8. Un ticket resuelto que el humano no puede usar no está resuelto

Si la lógica quedó mergeada pero la pantalla del dashboard no existe, **no
pongas `Status: resolved`** — deja el ticket abierto y escribe qué falta al
final del `## Answer`. Un ticket cerrado que el operador no puede usar es peor
que uno abierto: nadie lo va a volver a mirar.

En este repo el caso típico es un worker que ya hace algo bien y un `apps/web`
que todavía no lo muestra. Como son dos deploys, es fácil dar por terminado lo
que solo está a medio camino.

## 9. Encender por etapas — y aquí el interruptor hay que fabricarlo

Nada que toque clientes reales se enciende de una. Etapas de la operación más
chica a la más grande, y **la medición se repite antes de cada etapa** — los
números se mueven solos.

**La diferencia con Aura: aquí no hay interruptores de encendido.** El único que
existe es `agent_settings.dropi_dry_run` (default `true`), y cubre las
confirmaciones a Dropi, nada más. No hay allowlist de números, no hay modo
observador, no hay prefijo de prueba. Consecuencias prácticas:

- Si un ticket estrena un camino de envío, **el interruptor es parte del
  ticket**, no un añadido posterior. Un booleano en `agent_settings` es barato y
  ya hay precedente (`dropi_enabled`, `dropi_dry_run`).
- Mientras no exista, la etapa 1 de cualquier encendido es **un número propio**,
  no el de un cliente.
- El único freno estructural es que el worker de prod corre en Railway: si tu
  worker local está apagado, no envía. Eso no es una garantía — es una
  coincidencia. No te apoyes en ella.

El runbook va **en el ticket**, no en un cron de sesión: sobrevive a que la
sesión se cierre. Con las verificaciones numeradas y el criterio de "si esto no
cuadra, apagar".

Y **no verifiques el efecto antes de que pase el ciclo que lo produce**: el
followup sale a los 5 min por defecto, el remarketing a las 3 h, el poll de
Dropi cada 10 min y el sync cada 15 (`agent_settings`, todos configurables). En
la tanda de origen hubo un susto de un minuto por olvidar esto.

## 10. Buscar el duplicado — y lo cerrado — ANTES de crear el ticket

Una tanda produce hallazgos, y cada hallazgo tienta a abrir un ticket de una.
**Busca primero.** En la tanda de origen se crearon dos duplicados de dos
intentos, y uno duplicaba un ticket que llevaba **cinco días** abierto
describiendo lo mismo.

**Busca por el síntoma, en varias redacciones, no por tu título.** Los dos
tickets de ese caso decían lo mismo sin compartir una palabra clave. Prueba dos
o tres formas antes de rendirte; la búsqueda es literal, y aquí es un `grep`
sobre `.scratch/*/issues/` **más los cinco `map.md`** — el hallazgo puede estar
registrado como hecho verificado en un mapa sin tener ticket propio.

**Con sesiones en paralelo, vuelve a mirar justo antes de crear**, no al
empezar: el duplicado pudo nacer mientras trabajabas.

**El riesgo grande no es el duplicado — es re-litigar lo cerrado.** Los `##
Answer` de los issues resueltos y la sección *Términos comerciales fijados* de
`.scratch/panel-de-ventas/map.md` dicen explícitamente qué no se re-negocia
(el precio del módulo, quién paga los costos variables, el alcance = el PRD).
Antes de proponer cambiar algo de eso, lee el ticket que lo cerró: la
alternativa ya se consideró y se mató, con el razonamiento escrito.

**Si el duplicado existe, no lo tires: fusiónalo.** El ticket viejo suele traer
el mejor planteamiento y el nuevo los números; perder cualquiera de los dos es
perder la mitad. Y compara las fechas antes de archivar: un duplicado viejo no
es solo ruido — es la medición anterior del mismo problema, y dice si empeora.

## 11. Cerrar la tanda

- **Cada ticket con su `## Answer` y `Status: resolved`**, en lenguaje de
  operación, no técnico.
- **`map.md` del mapa al día** — sobre todo la sección *Aguas abajo*, que es lo
  que lee quien retome esto en un mes.
- **Los dos deploys hechos y verificados**, en orden (worker, luego web), con
  los logs de Railway mirados de verdad: `worker listening`, `outbound worker
  started`, `kapso template poll worker started`.
- **Worktrees borrados** (`orca worktree rm --worktree <selector>`), verificando
  con `merge-tree` que no quede trabajo único: el squash cambia el SHA, así que
  `git log main..rama` miente.
- Checkout principal (`/Users/equipo/Simetrik/whatsapp-agent`) en `main` al día
  y **pusheado** — con la cuenta `gh` correcta, o el push falla diciendo otra
  cosa.
- Los hallazgos que salieron de paso, **como tickets con sus números** (y
  pasados por el paso 10). En la tanda de origen salieron cinco, y uno era
  urgente.
- **Las decisiones que quedaron abiertas, en UN ticket propio** con
  `Type: decision`. Si viven dentro de tickets ya `resolved`, se pierden: nadie
  vuelve a abrir un ticket resuelto. Cada una con lo medido y con **por qué
  ningún agente la tomó** — aquí casi siempre porque le escribe a un cliente
  real, porque toca la DB de producción, o porque espera una aprobación de Meta
  o una cuenta del cliente.
