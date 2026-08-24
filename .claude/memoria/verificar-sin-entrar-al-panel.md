---
name: verificar-sin-entrar-al-panel
description: "El panel pide login y el agente no tipea contraseñas: las rutas del panel son proxies finos al worker, así que la misma lógica se ejercita con WORKER_API_TOKEN"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8b5ad116-c414-4d47-a419-db9979e8fbfe
  modified: 2026-08-23T04:06:42.120Z
---

**El panel está detrás de next-auth con email y contraseña** (`apps/web/src/app/login/page.tsx`),
así que la verificación visual de un deploy la tiene que hacer una persona: tipear
una contraseña en un formulario es de lo que el agente no hace.

**Pero casi nada de lo que hay que verificar vive en el panel.** Las rutas de
`apps/web/src/app/api/` son proxies finos: comprueban la sesión y reenvían al
worker con `workerFetch`. El banco del vendedor es el caso exacto —
`api/vendedor/probar` no hace más que pasar el cuerpo a `/api/vendedor/probar`
del worker—. Así que la misma lógica se ejercita directo, con el `WORKER_API_TOKEN`
que el propio skill de `deploy` ya prescribe para el chequeo de Kapso:

```bash
set -a && source .env && set +a
W="https://whatsapp-worker-production-2cc2.up.railway.app"
curl -s -X POST "$W/api/vendedor/probar" \
  -H "Authorization: Bearer $WORKER_API_TOKEN" \
  -H "content-type: application/json" --data-binary @cuerpo.json
```

Eso devolvió el turno del modelo real y `writeMode: "dry_run"`, que es la prueba
de que el banco no escribe ni manda WhatsApp — mejor evidencia que verlo en
pantalla, porque el campo lo dice el servidor.

Lo que **no** sustituye: que la pantalla dibuje bien. Para «abre diciendo
Sebastián está apagado» hay que mirarla, y eso lo hace Daniel.

Dos fricciones al escribir el script de comprobación, las dos ya pagadas:

* **El export es `getDb()`, no `db`.** Un `import { db }` deja `undefined` y el
  error sale como «Cannot read properties of undefined».
* **El script tiene que vivir dentro de `scripts/`.** Fuera del repo tsx lo
  resuelve como CJS y el top-level await no compila.

**Why:** verificar un deploy no es opcional, y quedarse sin forma de verificar
porque hay un login delante convierte «no puedo entrar» en «no se comprobó».
Casi siempre hay una capa debajo del login que responde lo mismo y responde
mejor, porque devuelve campos que la pantalla no muestra.

**How to apply:** antes de dar por imposible una verificación por la sesión del
panel, mirar si la ruta de `apps/web/src/app/api/` es un proxy — casi todas lo
son — y llamar al worker. Reservar para la persona solo lo que de verdad es
pintura. Es la misma lección de [[ejecutar-encuentra-lo-que-leer-no]].
