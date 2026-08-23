---
name: el-panel-y-la-base-en-costas-opuestas
description: El worker llega a Postgres por cable privado y el panel lo cruza de costa a costa por proxy público; por eso el Inbox se siente lento y el worker no
metadata: 
  node_type: memory
  type: project
  originSessionId: da231b67-e54c-4976-99d7-5690fda8678e
  modified: 2026-08-20T15:00:39.503Z
---

Medido el 20-ago-2026. El worker y el panel leen la MISMA base por caminos distintos:

- `apps/worker` corre en Railway US West y usa `postgres.railway.internal:5432` — red privada, menos de 1 ms.
- `apps/web` corre en Vercel `iad1` (Virginia) y usa `shuttle.proxy.rlwy.net:48788` — sale a internet, cruza el país y entra por el proxy TCP público.

Un render de `/inbox` hacía **10 viajes a la base** —13 cuando se midió con la regla de PRO-9— y desde PRO-15+PRO-16 hace **4** (23 → 8 idas y vueltas). Están en la rama `danielmedinac22/viajes-cortos`, **sin mergear ni deployar** al 20-ago-2026: hasta que salga, producción sigue en 23. Postgres ejecuta cada consulta en 1,5–3,2 ms: **menos del 1% del tiempo es la base pensando**, el resto es esperar la red. Y ese render entero se repite con cada `router.refresh()`, o sea con cada mensaje de WhatsApp que entra, porque las siete pantallas son `force-dynamic`.

**Why:** cualquier diagnóstico de lentitud del panel que empiece por optimizar SQL o agregar índices busca donde no está. Con 1 762 conversaciones y 27 527 mensajes el volumen no es el problema; el multiplicador es el conteo de viajes por la distancia.

**How to apply:** ante «el panel está lento», medir primero cuántos viajes hace el render, no cuánto tarda la consulta — con `WA_SQL_TRACE=1 npx tsx scripts/viajes-del-panel.ts`, y ver [[reproducir-la-linea-base-antes-de-tocar]] para cómo dejar el antes y el después comparables. Bajar el conteo de viajes y acercar la función a la base rinde más que cualquier índice. Ver [[contar-sobre-lo-cargado-miente]] y [[la-bandeja-definida-por-resta]] para otras trampas del mismo Inbox.
