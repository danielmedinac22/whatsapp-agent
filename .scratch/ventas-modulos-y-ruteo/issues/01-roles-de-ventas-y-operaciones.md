# 01 — Roles de ventas y operaciones

**What to build:** El sistema distingue a quién vende de quién confirma. Hoy no puede: los roles son `admin` y `operator`, y la pregunta «¿esto lo toma ventas u operaciones?» no tiene dónde escribirse.

**Blocked by:** None — can start immediately.

**Status:** resolved — worktree `roles-permisos`, tanda del 17-ago-2026 · rama `danielmedinac22/roles-permisos`, sin merge ni deploy

Verificado: `user_role` tiene **solo dos referencias en el código**, así que el cambio es barato.

- [x] Existen los roles de **ventas** y **operaciones**, además de admin.
- [x] Ventas alcanza el módulo del vendedor; operaciones el de confirmación; **admin ambos**.
- [x] Un usuario con rol de ventas **no puede llegar** a las pantallas de confirmación, ni por URL directa.
- [x] Los usuarios existentes conservan exactamente el acceso que tienen hoy — nadie pierde permisos por esta migración.
- [x] **La separación la impone el rol, no el módulo**, para que quien legítimamente hace las dos cosas no quede atrapado en una.

## Answer — esquema puesto por la `0022` (17-ago-2026), la funcionalidad sigue abierta

El worktree `esquema-0022` amplió el enum en producción. **Este ticket no genera migración.**

### `user_role` = `admin` · `operator` · `sales` · `operations`

Dos valores nuevos, **agregados al final** con `ALTER TYPE ... ADD VALUE`. `sales` es ventas, `operations` es el equipo que confirma. En inglés como los que ya había; `operations` colisiona en nombre con la tabla `operations` (el país) — la colisión es del lenguaje del negocio, «ventas» y «operaciones», y se prefirió respetarlo a inventar un sinónimo. El comentario en `schema.ts` lo deja dicho.

`operator` es el valor heredado: **nadie lo tiene en producción**, y se conserva porque un valor de enum no se quita sin recrear el tipo. Sigue siendo el `default` de `users.role` — cambiar el default no era de este expand.

### Nadie perdió acceso — verificado, no supuesto

Medido antes y después de aplicar: **3 usuarios, los 3 `admin`** (`danielmedina2205@gmail.com`, `inversionescspguatemala@gmail.com`, `admin@example.com`). Agregar valores no toca ninguna fila; el criterio «los usuarios existentes conservan exactamente el acceso que tienen hoy» se cumple por construcción y quedó comprobado en lectura.

### Trampas que quedan avisadas

- **Los valores nuevos no se usaron en la migración que los agregó** — Postgres rechaza usar un valor de enum dentro de la misma transacción que lo crea, y el migrator corre en una. Ya está commiteado, así que desde aquí se pueden usar libremente: `insert ... role = 'sales'` funciona.
- **`apps/web/src/auth.ts` sigue tipando el rol como `"admin" | "operator"`** con casts (líneas 12, 67, 74). Compila hoy porque son casts, pero un usuario `sales` va a pasar por ahí con un tipo mentiroso. Ensancharlo —idealmente a `(typeof userRole.enumValues)[number]` en vez de otra unión a mano— es de este ticket, junto con la separación por rol en las pantallas. `apps/web` no se tocó desde el esquema, a propósito.
- Solo hay **dos referencias** a `user_role` en el código (`schema.ts` y `auth.ts`), como decía el ticket. Sigue siendo barato.

### Lo que sigue siendo de este ticket

Todo lo del checklist: qué módulo abre cada rol, que ventas no llegue a confirmación ni por URL, que admin llegue a ambos, y la separación impuesta por el rol y no por el módulo.

---

## Answer — construido el 17-ago-2026

**La separación existe y la impone un solo borde.** `apps/web/src/access/resolve.ts` es la función pura que decide, y `apps/web/src/proxy.ts` la aplica antes de toda ruta. No hay ninguna guarda dentro de una pantalla. **Este ticket no generó migración** y no tocó `apps/worker`.

### La firma

```ts
resolveAccess(role: Role | undefined, pathname: string): AccessDecision

type Role   = User["role"];                        // el enum real: admin · operator · sales · operations
type Module = "ventas" | "operaciones";            // los mismos nombres que las bandejas del ticket 02
type Area   = Module | "ambos" | "solo-admin";     // a qué parte del panel pertenece una ruta

interface AccessDecision {
  allowed: boolean;
  rule: "rol_sin_restriccion" | "area_comun" | "modulo_propio"
      | "modulo_ajeno" | "solo_admin" | "ruta_sin_clasificar";
}

moduleOf(role: Role): Module | null                // null = ningún módulo lo restringe
```

Se copió la forma de `inbox/resolve.ts`: función pura, `switch` exhaustivo con `never`, y una decisión que dice **qué regla la produjo** y no solo el resultado. El `rule` no es decorativo — distingue «ventas rebotó de `/orders` por ser de otro módulo» de «la ruta se quedó sin clasificar por accidente», que es justo el error que este diseño puede cometer.

`Role` sale del esquema (`User["role"]`), no de una unión a mano: si `user_role` gana un valor, `moduleOf` **deja de compilar** hasta que alguien decida qué módulo abre. Es lo que la trampa avisada arriba pedía, y de paso murieron los tres casts de `auth.ts` — ahora `next-auth` está aumentado con `User.role`, `Session.user.role` y `JWT.role`, todos `Role`.

### La guarda va en el borde común, no en cada pantalla

El proxy corre antes de **toda** ruta que no esté excluida del `matcher`: pantallas, rutas de datos y **server actions** por igual. Una pantalla nueva queda cubierta por existir. Un `page.tsx` con su propia guarda se olvida; esto no se puede olvidar porque no hay nada que recordar.

Lo único que sí se puede olvidar es una línea de la tabla `AREAS`, y **olvidarla no filtra nada**: una ruta sin clasificar queda cerrada para los roles con módulo (`ruta_sin_clasificar`). El error posible es que a ventas le falte una pantalla suya —se ve al primer clic— y nunca que alcance una que no le toca. Cierra por defecto, no abre.

El menú del layout **le pregunta a la misma función** en vez de tener su propia lista, así que no puede ofrecer una puerta que el borde rebota. Esconder el enlace no es el control de acceso; es solo no ofrecer una puerta cerrada.

### El mapa de hoy, sacado de lo que cada pantalla hace

| Ruta | Área | Por qué |
|---|---|---|
| `/inbox` · historial · enviar · `agent-mode` · `wa/status` · media | **ambos** | El historial no se separa: operaciones necesita ver qué le prometió ventas. Ya está decidido en el spec. |
| `/templates` | operaciones | **Todos** los tipos de plantilla que existen son de confirmación y logística: `followup`, `remarketing`, `confirmation_ack`, `dropi_*`. Ninguno es de venta. |
| `/agent` · `/api/agent/**` | operaciones | `agent_settings` es el agente que confirma y acompaña la entrega. Lo de ventas vive en `sales_agent_settings`, que la `0022` dejó vacía. |
| `/orders` · `/api/dropi/orders/**` | operaciones | Pedidos y logística. |
| `/api/conversations/*/confirmation` | operaciones | Marcar confirmado es *la* decisión de Katherine, y se dispara desde dentro de la bandeja. |
| `/connection` · conexiones de Shopify y Dropi | **solo-admin** | La conexión de la tienda es **de la operación, no del módulo**: ambos módulos dependen de ella, así que no cuelga de ninguno. |

`/templates` y `/agent` parecen genéricas y no lo son — es la clasificación que más fácil se hace mal. **El módulo de ventas hoy no tiene ninguna pantalla propia**: un usuario `sales` alcanza la bandeja y nada más. Eso no es un defecto de esta guarda, es que las pantallas del vendedor son del ticket 03.

### Nadie perdió acceso — medido, no supuesto

Leído en producción antes de tocar nada: **3 usuarios, los 3 `admin`**; el enum con sus cuatro valores; `users.role` con `default 'operator'`; una operación (Guatemala, `GT`, `GTQ`, `active`).

Y el diseño lo garantiza por construcción, no por suerte: **esta función solo sabe quitarle alcance a `sales` y `operations`**. Cualquier otro rol —`admin`, el heredado `operator`, un valor que el código no conozca, o una sesión cuyo token no lleve rol— devuelve `rol_sin_restriccion` y pasa por todas partes, exactamente como hoy. Cerrar ante un rol desconocido sería la forma de dejar a Katherine sin confirmar por un token viejo; es el fallo que había que hacer imposible, no improbable.

### `operator`: qué creo que debería ser, y por qué no lo hice

**Creo que `operator` debería mapear a `operations`** — es literalmente el operador que confirma, el rol de Katherine antes de que existiera el nombre, y el spec dice que hoy los roles son «`admin` y `operator`, y punto» hablando del equipo de confirmación. **No lo hice**, y no por prudencia genérica: mapearlo le cambiaría el alcance a alguien por efecto colateral de este ticket, que es exactamente lo prohibido. Devuelve `null` (sin restricción) y queda igual que hoy.

Va con una trampa que hay que decidir aparte: **`users.role` sigue teniendo `default 'operator'`**, así que cualquier usuario nuevo insertado sin rol nace con acceso a todo el panel. Hoy eso es el statu quo —no hay separación, todos ven todo— pero en cuanto `operator` signifique algo, el default también hay que decidirlo. Misma regla que con `dropi_dry_run`: se documenta y se deja, porque es una decisión con dueño y no un efecto colateral de un refactor.

### Verificación

`pnpm -r typecheck` limpio en los 4 paquetes. `pnpm --filter @wa/worker test`: **135 tests en 9 archivos**, los mismos de antes y sin tocar — este lote es de `apps/web`.

**La verificación de verdad es de comportamiento y se hizo contra el panel levantado** (`pnpm dev:web`, 3010, leyendo producción, sin una sola escritura). Para probar los cuatro roles **sin cambiarle el rol a nadie** se firmaron cuatro cookies de sesión locales con el secreto de desarrollo y una identidad sintética (`prueba-<rol>@local`): ningún usuario de producción se tocó, ninguna fila se escribió. Matriz real, `GET`:

| Ruta | admin | operator | sales | operations |
|---|---|---|---|---|
| `/` | →`/inbox` | →`/inbox` | →`/inbox` | →`/inbox` |
| `/inbox` | 200 | 200 | 200 | 200 |
| `/templates` · `/agent` · `/orders` | 200 | 200 | **→`/inbox`** | 200 |
| `/connection` | 200 | 200 | **→`/inbox`** | **→`/inbox`** |
| `/api/conversations/<id>/messages` | 200 | 200 | 200 | 200 |
| `/api/conversations/<id>/confirmation` | 405 | 405 | **403** | 405 |
| `/api/agent/settings` · `/api/dropi/orders` | 500 | 500 | **403** | 500 |
| `/api/dropi/connection` · `/api/shopify/connection` | 500 | 500 | **403** | **403** |
| ruta inventada (`/pantalla-nueva`, `/api/algo`) | 404 | 404 | **rebota / 403** | **rebota / 403** |

Los `500` son el worker apagado en local, y son **idénticos** para los roles que sí pasan: lo que importa es que ninguno es `403`. Los `405` son endpoints que solo aceptan `POST` — y prueban lo bueno: a `sales` lo para el borde (`403`) *antes* de que el handler exista. Sin sesión, `/orders` sigue redirigiendo a `/login?from=%2Forders`.

- **La respuesta a «¿y si escribe la URL a mano?»**: `sales` pidiendo `/orders` recibe un redirect 307 a `/inbox`, decidido en el proxy antes de que Next resuelva la página. La página de confirmación nunca se renderiza ni consulta la base.
- **Los tres admin de hoy, en cada pantalla**: 200 en las cinco, con datos de producción (301 filas en `/orders`, la bandeja completa en `/inbox`), y el menú con los cinco enlaces. Nada cambió para ellos.
- **El menú, renderizado**: admin y `operator` ven los 5 enlaces; `operations` ve 4 (sin Conexión); `sales` ve 1 (solo Inbox).
- **Server actions**: un `POST` de server action a `/templates` como `sales` devuelve 307 en el borde; como admin llega a la aplicación. La única pantalla con server actions es Plantillas, y quedan detrás de la misma guarda sin código extra.
- No se ejercitó ningún `POST` real contra producción: cruzan el mismo borde con la misma función, y un falso negativo en `/api/wa/send` le escribiría a un cliente real de Guatemala.

**No hay tests automáticos de esto**, y es a conciencia: los tests del repo viven solo en `apps/worker` y el spec ya decidió que «los permisos de rol se verifican a mano». La función es pura y sin dependencias, así que el día que `apps/web` tenga runner se prueba tal cual está.

### Lo que este ticket deliberadamente NO hizo

- **No construyó ninguna pantalla ni bandeja.** Ticket 03, y su forma la decide una sesión de prototipos.
- **No tocó la asignación de conversación** (ticket 04) ni `inbox/resolve.ts`: el rol decide **quién entra a un módulo**, no a qué bandeja pertenece una conversación. Son dos preguntas distintas y se dejaron distintas.
- **No tocó `apps/worker`** ni ningún test.
- **No cambió el rol de ningún usuario**, ni creó uno de prueba en producción.
- **No miró la operación (el país).** País primero, módulo dentro: `resolveAccess` no recibe operación porque es otra separación y de otro ticket.
- **No renombró ni migró `operator`**, ni cambió el `default` de `users.role`.

### Dos cosas que el ticket 03 tiene que saber

1. **El menú de confirmación sigue visible dentro del chat para `sales`.** El control de estado de confirmación vive en la cabecera del chat de la bandeja única, que es área común; si un `sales` lo pulsa, la ruta contesta 403 y no pasa nada. Hacerlo desaparecer es UI de la bandeja de ventas, no de esta guarda — pero conviene no descubrirlo en producción.
2. **Al agregar una pantalla hay que agregar su línea en `AREAS`**, y la de su ruta de datos si tiene. Olvidarlo no filtra: cierra. Con la bandeja partida en dos, `LANDING_PATH` (hoy `/inbox` para todos) pasa a depender del rol, y ahí es donde se decide a cuál cae cada uno.
