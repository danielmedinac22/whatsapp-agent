# Trabajar este repo desde la nube

Cómo queda configurado el entorno de **Claude Code on the web** para que una
sesión arrancada desde el celular pueda hacer lo mismo que una sesión local:
leer la base de producción, probar el agente contra OpenRouter y deployar.

Las sesiones corren en una VM de Anthropic (Ubuntu 24.04, 4 vCPU, 16 GB de RAM,
30 GB de disco) que clona este repo. Siguen corriendo con el teléfono guardado.

## El camino corto

```bash
./docs/nube/asistente.sh
```

Te abre cada pantalla, te dice qué tocar, **lee las variables de Railway por vos**
y te va dejando en el portapapeles lo que hay que pegar. Ningún secreto pasa por
un archivo del repo ni por la conversación.

El resto de este documento es lo mismo explicado, por si el asistente falla o
querés entender qué hace cada campo.

Lo que sigue son **los cuatro campos del diálogo de entorno** en
[claude.ai/code](https://claude.ai/code), más las trampas que este repo tiene y
que no se descubren hasta que fallan.

## 1 · Setup script

Pegá el contenido de [`setup.sh`](./setup.sh). Fija la versión de pnpm que manda
el `packageManager` e instala los CLI de Railway y Vercel, que no vienen en la
imagen.

Corre **una sola vez por entorno**: después Anthropic fotografía el disco y las
sesiones siguientes arrancan de esa foto. Se vuelve a correr si cambiás el script
o los dominios, y cuando la caché cumple unos siete días.

## 2 · Network access

Poné el nivel en **Custom**, dejá marcado *«Also include default list of common
package managers»* y pegá la lista de [`dominios.txt`](./dominios.txt), que es
la copia única: el asistente la lee de ahí, así que si cambia, cambia en un solo
sitio. Sin esto la sesión no llega a la base ni al proveedor del modelo, aunque
las credenciales estén bien.

| dominio | para qué |
| -- | -- |
| `*.rlwy.net` | el proxy público de Postgres, que es la única puerta a la base desde fuera de Railway |
| `*.railway.app`, `*.railway.com`, `backboard.railway.app` | la API de Railway y la URL pública del worker |
| `openrouter.ai` | el proveedor del modelo, y el saldo de la llave |
| `api.kapso.ai` | WhatsApp: envíos, plantillas y estado de la conexión |
| `graph.facebook.com` | CAPI, las conversiones que se le reportan a Meta |
| `app.dropi.gt`, `api.dropi.gt` | la logística de Guatemala |
| `api.vercel.com`, `*.vercel.app` | deploy del dashboard y su dominio de producción |
| `*.myshopify.com` | la tienda |
| `*.frame.claudeusercontent.com` | sin esto Claude no puede leer artifacts en la sesión |

GitHub **no** hace falta listarlo: va por un proxy aparte que mantiene tus
credenciales fuera de la VM. Los conectores MCP tampoco: su tráfico pasa por los
servidores de Anthropic, no por la red de la sesión.

## 3 · Environment variables

Formato `.env`, una línea por variable. **Acá está el riesgo que aceptamos a
conciencia:** los entornos de nube no tienen almacén de secretos, y cualquiera
que use el entorno puede leer estos valores. Como el entorno es personal y de un
solo usuario, el alcance es el de tu propia cuenta de claude.ai. Si algún día
esto pasa a ser un entorno compartido de organización, **hay que sacar de acá
todo lo que sea credencial**.

| variable | de dónde sale | para qué |
| -- | -- | -- |
| `DATABASE_PUBLIC_URL` | `railway variables --service Postgres` | la base de producción por el proxy público |
| `OPENROUTER_API_KEY` | `railway variables --service whatsapp-worker` | probar el agente y consultar el saldo |
| `WORKER_API_TOKEN` | idem | pegarle a la API del worker desplegado |
| `PUBLIC_URL` | idem | `https://whatsapp-worker-production-2cc2.up.railway.app` |
| `KAPSO_API_KEY` | idem | diagnosticar envíos y plantillas |
| `RAILWAY_TOKEN` | token de proyecto, en la configuración del proyecto en Railway | deployar el worker. **Leé la advertencia de abajo** |
| `VERCEL_TOKEN` | `vercel.com/account/tokens` | deployar el dashboard |

Cada sesión copia estos valores **una vez, al arrancar**. Editarlos afecta a las
sesiones que empiecen después, no a las que ya están corriendo.

### La advertencia del `RAILWAY_TOKEN`

En la máquina de Daniel hay un `RAILWAY_TOKEN` inyectado **que es inválido**, y
por eso todos los comandos locales van con `env -u RAILWAY_TOKEN`: el CLI lo
prefiere sobre el login guardado en `~/.railway/config.json`.

**En la nube es exactamente al revés.** No hay archivo de login, así que el token
es la única credencial que existe y `env -u RAILWAY_TOKEN` deja al CLI sin nada.
El skill `deploy` ya distingue los dos casos; si escribís un comando de Railway a
mano, mirá primero cuál de los dos mundos estás pisando.

## 4 · Antes de la primera sesión

**La cuenta de GitHub tiene que ser `danielmedinac22`.** Es la dueña del repo, que
es privado. Si conectás la de Simetrik (`danielmedinac2205`), la sesión falla al
clonar con «Session creation failed» y parece un problema de capacidad. Es la
misma trampa del `gh auth switch` que documenta `CLAUDE.md`, un piso más arriba.

Se conecta de dos formas: autorizando la GitHub App de Claude durante el
onboarding, o corriendo `/web-setup` en la terminal para sincronizar el token de
tu `gh` local.

**Confirmá el workspace de Linear antes del primer write.** `.mcp.json` declara
`linear-pcd` apuntando a `mcp.linear.app`, pero la URL es la misma para todos los
workspaces: quien decide cuál es el token. Una sesión en la nube puede
autenticarse contra el workspace equivocado **sin fallar con error**, y el ticket
aparece en el tablero de otro cliente. `mcp__linear-pcd__get_workspace` primero,
siempre.

## Qué viaja y qué no

Una sesión en la nube arranca de un clon limpio. Vale la pena tener claro el
corte:

**Viaja**, porque está en el repo: `CLAUDE.md`, `CONTEXT.md`, los skills de
`.claude/skills/`, los hooks de `.claude/settings.json`, `.mcp.json`, y todo
`scripts/`.

**No viaja**: la memoria personal de Daniel (`~/.claude-personal/`), los skills
de usuario, el `.env` local y el login de Railway. Por eso existe `CONTEXT.md`:
es el intento de que lo que importa de esa memoria esté en el repo.

## Los deploys, y por qué conviene moverlos a git

Con el `RAILWAY_TOKEN` puesto, una sesión en la nube puede correr `railway up` y
deployar producción. Funciona, y es lo que se pidió.

Vale la pena decir que **hay una forma mejor**: si conectás la integración de
GitHub de Railway para que un merge a `main` deploye el worker, como Vercel ya lo
hace con el dashboard, entonces el deploy deja de necesitar credenciales dentro
de la sesión. El token pasa a ser el plan B en vez del camino principal, y desde
el celular el flujo es escribir, abrir el PR y mergear.
