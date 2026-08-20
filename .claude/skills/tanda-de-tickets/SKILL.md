---
name: tanda-de-tickets
description: Trabajar VARIOS tickets a la vez desde una sesión que planea y reparte a worktrees en paralelo. Usar cuando llegan varios tickets juntos (una lista pegada, varios identificadores PRO-N de Linear, varios números de .scratch/<mapa>/issues/), cuando hay que decidir cómo agrupar trabajo entre sesiones, o cuando esta sesión va a coordinar y mergear el trabajo de otras.
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

> **Los tickets viven en Linear desde el 19 ago 2026.** Antes eran archivos en
> `.scratch/<mapa>/issues/`. Los 58 que ya existen **se quedan ahí** como
> histórico de solo lectura y no se migran; **todo ticket nuevo nace en Linear**,
> en el equipo `Producto Con Daniel` (`PRO`) del workspace
> [producto-con-daniel](https://linear.app/producto-con-daniel). Lo que sigue en
> el repo es el `spec.md` de cada mapa — ver el paso 3.

> **Hay dos MCP de Linear conectados y escriben en workspaces distintos.**
> `mcp__linear-pcd__*` → **Producto Con Daniel**, que es este repo.
> `mcp__linear__*` → `waichat-app`, que es OTRO repo. El prefijo equivocado no
> falla con error: crea el ticket en el tablero de otro cliente. Confirma con
> `mcp__linear-pcd__get_workspace` antes del primer write de la sesión.

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
| Linear, equipo `PRO` | Los tickets vivos: si la pregunta ya se hizo, y qué alternativa se mató y por qué |
| `.scratch/<mapa>/issues/` | Lo mismo para los 58 tickets anteriores a la mudanza. Solo lectura |
| `.scratch/<mapa>/spec.md` | Los hechos ya verificados contra el código, y los términos que no se re-litigan |
| `git log` | Qué cambió y cuándo — el README no lo cuenta |

**Cómo se consulta la base.** `psql` está en `/opt/homebrew/bin/psql`. Lo único
que falta es el `DATABASE_URL`, que no se auto-carga. Una medición es una línea:

```bash
export PGURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
psql "$PGURL" -c "select status, count(*) from dropi_orders group by status"
```

Que quepa en una línea decide cuántas cosas se miden. El rodeo anterior era un
script `tsx` por consulta, con archivo temporal, y costaba un turno cada vez, así
que se medía menos. Los hallazgos del lote `ventas-bandeja-honesta` salieron de
poder preguntar diez veces seguidas.

> ⚠️ **El `DATABASE_URL` del `.env` ES el de producción** (`shuttle.proxy.rlwy.net`).
> Medir es leer: `SELECT` sí, `UPDATE`/`DELETE` nunca sin que el humano lo
> autorice explícitamente. Y **jamás `pnpm db:push` para "probar"** — reescribe
> el esquema de prod sin migración y sin registro.

**Una consulta que falla no es un dato que no existe.** Si revienta por nombre
de tabla o columna, pregúntale a `information_schema.columns`, que responde antes
que abrir `packages/db/src/schema.ts` (1.675 líneas, 24 tablas). Los nombres del
código son camelCase y los de SQL snake_case (`dropiOrders` → `dropi_orders`), y
varias tablas de configuración son **de fila única**
(`agent_settings` con `id=1`, `kapso_connection`, `shopify_connection`,
`dropi_connection`). Un ticket que pida "una segunda conexión" o "otro
vendedor" está pidiendo un cambio de modelo de datos, no un campo más — eso ya
está medido y escrito en `.scratch/panel-de-ventas/map.md`.

**Y ojo: aquí no hay cadena de autoridad, hay un README que miente.** No existe
`docs/decisiones.md`. La autoridad práctica, de mayor a menor, es: el `spec.md`
del mapa → el ticket (el issue de Linear; en el histórico, su `## Answer`) → el
código. **El `README.md` de la raíz
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

El ticket **es un issue de Linear** en el equipo `Producto Con Daniel`. Al
cerrar el grilling, escribe la respuesta en la descripción del issue — qué se
acordó, **por qué**, y qué queda descartado, con los números que lo sostienen.
Eso es lo que evita que la sesión hija re-litigue lo ya resuelto, o peor, decida
distinto.

```
mcp__linear-pcd__save_issue
  team="Producto Con Daniel"   project="<mapa>"   state="Todo"
  title=…   description=…   labels=["task"]   blockedBy=["PRO-<n>"]
```

Qué cambia frente al archivo, y qué no:

- **La numeración deja de ser tuya.** Linear asigna `PRO-N` al crear, global al
  equipo. Dos sesiones ya no pueden inventar el mismo número — era el recurso
  global nº 3 del paso 4, y desapareció.
- **`Status: claimed` lo reemplaza el estado del issue**, y se pone ANTES de
  repartir: `Todo` → `In Progress` con asignado. Los estados del equipo son
  `Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`, `Duplicate`.
- **`Blocked by:` deja de ser una línea de texto** y pasa a ser relación de
  verdad (`blockedBy`), que Linear sí sabe leer.
- **El `Type:` viejo es una etiqueta**: `grilling`, `research`, `task`,
  `prototype`, `decision`.
- **Un mapa = un proyecto de Linear**, con el mismo nombre que la carpeta. Se
  crea al abrir el mapa; lo que no pertenece a ningún mapa va sin proyecto.

**El `spec.md` NO se muda, y esa es la mitad que sigue en el repo.** Vive en
`.scratch/<mapa>/spec.md`, commiteado, por la razón exacta por la que se
commiteó (16 ago 2026): **viaja en el diff, así que la sesión hija lo tiene en
su worktree sin pedirle nada a nadie.** Un issue de Linear no viaja en el diff y
el worktree no hereda el MCP — ver el paso 5. El proyecto de Linear lleva el
link al `spec.md` en GitHub, no una copia: dos copias divergen.

Si la tanda cambia el alcance, la sección *Aguas abajo* del `spec.md` es lo que
hay que actualizar. (`panel-de-ventas` es el único mapa cuyo índice se llama
`map.md`; los otros nueve usan `spec.md`.)

Y `.scratch/panel-de-ventas/` sigue guardando `artefacto.html` y `prd.html`, que
llevan precios y términos de cliente: el repo es privado y debe seguir siéndolo.

## 4. Repartir por superficie, no por ticket

**Los archivos mandan sobre el agrupamiento, no los tickets.**

Tres tickets distintos que caen en el mismo renglón de la misma tabla son UNA
conversación de diseño y UN worktree. Dos tickets que no comparten archivo van
en paralelo aunque suenen parecidos.

Regla práctica: **un archivo grande tiene un solo dueño por vez.** En la tanda
de origen, un archivo de 3.774 líneas lo tocaban cuatro tickets; se le prohibió
a todos menos a uno y no hubo un solo conflicto en esa pantalla. El repo son
42.552 líneas de TS/TSX sin contar tests, así que los candidatos son pocos y se
saben (medido el 20 ago 2026; vuelve a contarlos, crecen rápido):

| Archivo | Líneas |
| -- | -- |
| `apps/web/src/app/(app)/catalogo/catalogo-client.tsx` | 1.927 |
| `packages/db/src/schema.ts` | 1.675 |
| `apps/web/src/app/(app)/inbox/inbox-client.tsx` | 1.424 |
| `packages/db/src/products.ts` | 1.066 |
| `apps/web/src/lib/queries.ts` | 1.057 |
| `apps/worker/src/jobs/capi-conversion.ts` | 751 |
| `apps/worker/src/jobs/outbound.ts` | 689 |
| `apps/worker/src/sales/order.ts` | 671 |
| `apps/web/src/app/(app)/connection/shopify-panel.tsx` | 658 |

**Tres recursos globales que se pisan sin que ningún test lo vea** (eran cuatro;
el cuarto lo resolvió Linear, ver abajo):

1. **`packages/db/src/schema.ts`** — es la costura del monorepo. Casi todo
   ticket que agregue algo lo toca, y de él salen tipos que usan `web` y
   `worker` a la vez. Si dos tickets lo necesitan, van juntos o van en serie.
2. **La numeración de migraciones** (`packages/db/migrations/NNNN_*.sql`, hoy
   por `0030`). Dos worktrees en paralelo generan `0031` los dos. **Repártelos
   tú desde acá**, y confirma el último con `ls` antes de repartir.
3. **El `spec.md` del mapa activo** — toda sesión que cambie el alcance lo toca.
   Si dos lo hacen, conflicto de merge garantizado.

Y el que dejó de existir: **el número del próximo ticket libre dentro de cada
mapa**. Antes había que repartirlo a mano porque dos sesiones en el mismo mapa
creaban el mismo `03`. Ahora el identificador lo pone Linear al crear el issue.
Cerrar un ticket tampoco produce ya conflicto de merge: el estado vive en
Linear, no en un archivo que dos ramas editan.

Y separa **la mitad que se ve de la que no**: `apps/worker` avanza sin el
humano, `apps/web` espera su veredicto visual. Así el prototipado no bloquea el
resto — y encima son dos deploys distintos (paso 6).

## 5. El encargo va en un archivo, no en el prompt

Escribe un briefing por worktree en el scratchpad y pásale la ruta:

```bash
orca worktree create --project github:danielmedinac22/whatsapp-agent \
  --name <slug> --linear-issue PRO-<n> --json
# la ruta del workspace sale del JSON — no la adivines
orca terminal create --worktree "path:<ruta-del-json>" \
  --title "PRO-<n> <tema>" \
  --command "claude-personal 'Lee <ruta-absoluta>.md — es tu encargo completo. Ejecutalo de punta a punta sin pedirme permiso para arrancar.'"
```

Sin `--agent` (ese lanza el `claude` pelado con el perfil que Orca pisa). **Con
`--linear-issue PRO-<n>`**: ata el worktree a su ticket dentro de Orca, y así
dentro de un mes nadie tiene que adivinar de dónde salió esa rama.

**Pero el briefing sigue llevando el ticket copiado entero, no un link.** Dos
razones, y la primera no es de estilo:

- **El worktree no hereda el MCP.** `linear-pcd` está registrado con scope local
  contra la ruta `/Users/equipo/Simetrik/whatsapp-agent`; un worktree vive en
  otra ruta, así que **la sesión hija abre sin `mcp__linear-pcd__*` y no puede
  leer `PRO-<n>` aunque quiera**. Esto es deliberado, no un descuido: quien
  mueve el issue es la sesión que planea (paso 11). Si un encargo de verdad
  necesita escribir en Linear, hay que registrarle el server en su ruta primero.
- Un link obliga a un viaje de red antes del primer turno; el archivo evita el
  infierno de comillas y deja la sesión trabajando desde ese primer turno.

**El worktree nace sin `.env`.** Está gitignoreado, así que la sesión hija no
puede medir ni correr nada contra la base hasta que se lo copies. Cópialo tú
deliberadamente, ticket por ticket, y solo si ese encargo de verdad necesita
tocar datos: es la llave de producción.

**Qué lleva el briefing** — las cinco secciones que hicieron falta:

1. **Su trabajo en una frase**, y el ticket entero pegado abajo para el detalle
   — con su identificador `PRO-<n>` para que pueda nombrarlo al reportar.
2. **Lo medido, con números.** No "hay pocos pedidos sin confirmar": el número.
   El número le da criterio para decidir sola.
3. **Las trampas del repo que no debe redescubrir:**
   - **El `.env` apunta a producción.** Leer sí; escribir, solo lo que el
     encargo autorice por escrito. Base de desarrollo sí hay, pero se levanta a
     mano y nadie lo hace por ti: ver el punto 5.
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
   - Para medir se usa `psql`, que está instalado. El `DATABASE_URL` sale del
     `.env` con `grep`, y no hace falta escribir un script.
   - Los tests viven **solo** en `apps/worker` (`pnpm --filter @wa/worker test`).
     No hay script `test` en la raíz. No inventes uno a mitad de un ticket.
4. **Qué NO hacer.** Qué archivo no tocar, qué no deployar, y sobre todo:
   **no mandar mensajes a números de clientes reales.** Aquí no hay red: no
   existe allowlist ni modo observador, y `dropi_dry_run` — el único freno del
   sistema — cubre **solo las confirmaciones a Dropi**, no el envío de WhatsApp.
   Un worker corriendo en local con ese `.env` le escribe a gente de verdad. Si
   un encargo necesita probar un envío, el número de prueba y la autorización
   los pone el humano, no la sesión.
5. **Cómo verificar de verdad.** El piso es `pnpm -r typecheck` limpio más
   `pnpm --filter @wa/worker test`, que hoy son unos 830 casos en 55 archivos
   (contados el 20 ago 2026). Ese piso creció mucho: cuando se escribió este
   skill eran 41 casos en 4 archivos. Aun así verde no significa correcto,
   porque **`apps/web` no tiene un solo test** y ninguna pantalla está cubierta.
   El criterio de terminado se escribe en términos del comportamiento
   observable: qué se ve en el dashboard, qué fila queda en la base, qué log
   sale del worker. Y quién hace la verificación visual, que es el humano en el
   preview de Vercel.

   **Si el ticket trae migración o cambia una pantalla, hay base desechable y se
   usa antes de entregar.** Docker está en la máquina:

   ```bash
   docker run -d --name wa-ensayo -e POSTGRES_PASSWORD=test \
     -e POSTGRES_DB=wa -p 55987:5432 postgres:16-alpine
   ```

   Se aplican los `.sql` de `packages/db/migrations` en orden, separando por
   `--> statement-breakpoint`, se siembran filas con la forma de producción y se
   aplica la nueva encima. Es lo único que prueba que el backfill llena lo que
   dice y que un `SET NOT NULL` no revienta sobre filas que ya existen. Ojo con
   la `0020`, que ya siembra Guatemala: esa fila se lee, no se inserta.

   Para correr el panel contra esa base, `next start` desde `apps/web` con
   `DATABASE_URL` apuntando al contenedor y `WORKER_URL` a algo inalcanzable
   (`http://127.0.0.1:9`). Next no lee el `.env` de la raíz, solo el de
   `apps/web`, que no existe, así que no hay forma de tocar producción por
   descuido. Con dos operaciones sembradas se ve lo que con una sola es
   invisible. Al terminar, `docker rm -f wa-ensayo`.

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
- **Revisa los tres recursos globales del paso 4** — `schema.ts`, número de
  migración, `spec.md` del mapa. Son lo más fácil de pisar y lo más silencioso.
- **Las migraciones se aplican a mano y antes del deploy** (`pnpm --filter @wa/db
  migrate`), porque el `startCommand` de Railway no las corre. Ensáyala primero
  contra el contenedor del paso 5: aplicarla a prod es irreversible, y ahí ya
  solo se puede añadir otra encima. Si dos ramas
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

Si la lógica quedó mergeada pero la pantalla del dashboard no existe, **no lo
pases a `Done`** — déjalo en `In Review` y escribe en un comentario qué falta.
Un ticket cerrado que el operador no puede usar es peor que uno abierto: nadie
lo va a volver a mirar, y en Linear encima desaparece de la vista por defecto.

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
o tres formas antes de rendirte. Y desde la mudanza **son dos búsquedas, no
una**:

- **Lo vivo:** `mcp__linear-pcd__list_issues` con `query=<síntoma>`, que mira
  título y descripción. Repite con `includeArchived: true` antes de rendirte.
- **El histórico:** `grep` sobre `.scratch/*/issues/` **y sobre los `spec.md`** —
  el hallazgo puede estar registrado como hecho verificado en un spec sin tener
  ticket propio. Ojo con los dos dialectos que conviven ahí: los 11 de
  `panel-de-ventas` traen cabecera `Type:`/`Status:` con `## Question` y
  `## Answer`; los otros 47 empiezan con `**What to build:**` y no tienen estado
  ninguno. Buscar por `Status:` encuentra una quinta parte del histórico y
  parece exhaustivo.

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

- **Cada issue en `Done`, con el resultado escrito como comentario**, en
  lenguaje de operación, no técnico. Lo escribe la sesión que planea: la hija no
  tiene el MCP (paso 5), así que si no lo haces tú no lo hace nadie.
- **El `spec.md` del mapa al día** — sobre todo la sección *Aguas abajo*, que es
  lo que lee quien retome esto en un mes. Ese sigue viviendo en el repo.
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
- **Las decisiones que quedaron abiertas, en UN ticket propio** con la etiqueta
  `decision`. Si viven dentro de tickets ya en `Done`, se pierden: nadie
  vuelve a abrir un ticket resuelto. Cada una con lo medido y con **por qué
  ningún agente la tomó** — aquí casi siempre porque le escribe a un cliente
  real, porque toca la DB de producción, o porque espera una aprobación de Meta
  o una cuenta del cliente.
