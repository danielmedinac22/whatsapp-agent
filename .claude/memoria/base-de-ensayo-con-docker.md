---
name: base-de-ensayo-con-docker
description: "Hay Docker en la máquina — se puede ensayar migraciones y correr el panel contra una base desechable, sin tocar producción"
metadata: 
  node_type: memory
  type: project
  originSessionId: abe4be37-1077-46b2-a57c-f30eb6552c3c
  modified: 2026-08-18T18:10:25.253Z
---

**Docker funciona en esta máquina, y con eso hay base de desarrollo.** El
`.env` apunta a producción, lo que hace parecer que la única base es la viva. No
lo es. El skill `tanda-de-tickets` decía que no había base de desarrollo; quedó
corregido el 20 ago 2026 y ahora lleva estos comandos en su paso 5.

```bash
docker run -d --name wa-ensayo -e POSTGRES_PASSWORD=test -e POSTGRES_DB=wa -p 55987:5432 postgres:16-alpine
```

Dos cosas que esto destraba, y que valen mucho más que medir con `SELECT`:

1. **Ensayar una migración de verdad antes de entregarla.** Se aplican los `.sql`
   de `packages/db/migrations` en orden (separando por `--> statement-breakpoint`),
   se siembran filas con la forma de producción y se aplica la nueva. Es lo único
   que prueba que el backfill llena lo que dice y que un `SET NOT NULL` no revienta
   sobre filas existentes. Ojo: la migración `0020` **ya siembra Guatemala**, así
   que hay que leer esa fila, no insertarla.

2. **Correr el panel contra esa base, con el estado difícil.** `next start` desde
   `apps/web` con `DATABASE_URL` apuntando al contenedor y `WORKER_URL` a algo
   inalcanzable (`http://127.0.0.1:9`). Next **no** carga el `.env` de la raíz del
   repo —solo el de `apps/web`, que no existe—, así que no hay riesgo de tocar
   producción. Sin arrancar el worker no se le escribe a ningún cliente.
   Con dos operaciones sembradas se verifica lo que con una sola es imposible ver
   (ver [[no-romper-guatemala]] y [[vorare-opera-en-guatemala]]).

**Tres trampas al sembrar, que cuestan una hora entre las tres** (medidas el
20 ago 2026, ensayando PRO-32):

1. **El correo del usuario necesita dominio con punto.** `auth.ts` valida con
   `z.string().email()`, así que `ensayo@local` no pasa y el login responde
   «Email o contraseña incorrectos» — que se lee como un hash mal generado y no
   lo es. `ensayo@vorare.test` entra. El hash se acuña con
   `cd apps/web && node -e "console.log(require('bcryptjs').hashSync('...',10))"`.
2. **La operación elegida vive en una cookie `httpOnly`** que pone una acción de
   servidor. Sembrar dos operaciones no alcanza: hasta que no se aprieta una
   baldosa del riel, **todas** las pantallas dibujan `<ChooseOperation>` y no hay
   nada que medir.
3. **`sales_agent_settings.activated_at` decide en qué bandeja caen las filas
   sembradas.** Con el vendedor activado hace 30 días, las conversaciones nuevas
   son todas de ventas y `/inbox` —que es la de confirmación, definida por
   resta— sale en cero, como si la siembra hubiera fallado. Poniendo
   `activated_at = now()` caen del otro lado. Ver [[la-bandeja-definida-por-resta]].

Sin navegador se maneja con `curl`: login por `/api/auth/csrf` +
`/api/auth/callback/credentials` con un cookie jar, y **las acciones de servidor
se pueden disparar** porque Next las degrada a formularios — se postea a la URL de
la página con el campo oculto `$ACTION_ID_<hash>` que aparece en el HTML.

**Why:** medir producción con `SELECT` dice cómo están los datos, pero no prueba
que la migración corra ni que la pantalla se comporte. Los dos hallazgos que más
valieron en la ola del selector de operación —que el panel quedaba sin salida con
dos operaciones activas, y que una prueba de vigilancia pasaba estando rota—
salieron de ejecutar, no de leer.

**How to apply:** ante cualquier ticket con migración o con comportamiento de
pantalla, levantar el contenedor antes de dar por terminado. Borrarlo al final
(`docker rm -f wa-ensayo`).

**Cuarta trampa, medida el 21-ago-2026: `next dev` no hidrata bajo CDP.** Con
`next dev --turbopack` la pantalla se dibuja (el HTML del servidor está entero)
pero React nunca hidrata: `self.__next_f` queda en 0, ningún nodo lleva
`__reactFiber$`, los `useEffect` no corren y el hilo del Inbox sale con cero
mensajes aunque su `/api/.../messages` responda 200. No hay error en consola ni
petición fallida, así que se lee como un bug del producto y no lo es. Pasa igual
con Chrome con cabeza, así que no es cosa de headless.

`npx next build && npx next start -p 3010` **sí hidrata**, y además es el
artefacto que corre en Vercel. Para cualquier verificación de pantalla, construir
— la vuelta cuesta ~40s y ahorra la hora que cuesta perseguir el fantasma. Ver
[[chrome-sin-cabeza-por-cdp]].
