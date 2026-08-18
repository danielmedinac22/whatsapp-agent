# Estado del Panel de Ventas — punto de entrada

**Si acabas de llegar a este proyecto con contexto fresco, lee este archivo primero.** Está al día al **18-ago-2026**.

## Lo primero, antes de tocar nada

1. **`.scratch/panel-de-ventas/no-regresion.md`** — la restricción que manda sobre todo. Guatemala factura hoy (~470 pedidos/mes, 88,4% de confirmación) y no puede cambiar de comportamiento. Si un ticket obliga a elegir entre avanzar y no tocar Guatemala, **no se toca Guatemala**.
2. **`.scratch/panel-de-ventas/map.md`** — por qué cada cosa es como es, y los términos comerciales que **no se re-litigan**.
3. El ticket que vayas a trabajar y su `spec.md`.

## Reglas de trabajo, aprendidas a golpes

- **`pnpm -r typecheck` y `pnpm --filter @wa/worker test` después de CADA ticket**, no al final. Hoy: **4 paquetes limpios, 334 tests en 22 archivos.**
- **`dropi_dry_run` está en `true` a propósito.** Confirmado intencional: es el default del esquema, está expuesto como interruptor en el panel, y `84b62c0` quitó el auto-confirm dejando el botón manual como único camino. **No lo cambies.**
- **Los tests van sobre funciones puras con fixtures**, en el estilo de `kapso/inbound.test.ts`. **Nombres en español que enuncian el comportamiento**, no la mecánica.
- **Si algo del ticket contradice el código real, para y pregunta. El código gana.** Pasó varias veces y las correcciones valieron más que los tickets.
- **El `.env` ES producción.** No hay base de desarrollo. Leer sí; escribir, solo lo autorizado.
- **No mandes mensajes a números de clientes reales.** No hay allowlist ni modo observador. No arranques el worker en local.
- **Railway:** hay un `RAILWAY_TOKEN` inválido en el entorno que tapa el login. Se ignora con `env -u RAILWAY_TOKEN`. Ver `CLAUDE.md`.

## Qué está construido y en producción

**21 de 41 tickets resueltos.** Cuatro migraciones aplicadas (`0020`–`0023`). Worker en Railway y dashboard en Vercel, desplegados y verificados.

- **Migración multi-operación completa** (tickets 01–06). Existe `operations`; Guatemala registrada (`GT`/`GTQ`/`active`); **cero `eq(<tabla>.id, 1)` en toda la base** — ningún accesor devuelve conexión o configuración sin decir de qué operación.
- **La atribución del primer contacto** — referencia del anuncio y `ctwa_clid` se capturan y persisten. Era irreversible: no existe endpoint de Meta para recuperarlos después.
- **El reconocimiento de producto** — cascada pura con matcher inyectado; REVITALHAIR da *ambiguo*, nunca una elección.
- **El ruteo de bandeja** — derivado, no guardado, con el recomprador cubierto.
- **El constructor de orden** — validación geográfica de los dos países, clamp de descuento, idempotencia por lead.
- **El constructor del evento CAPI**.
- **Sebastián** — persona, contexto de producto y escalamiento.
- **Roles de ventas y operaciones**, sin que ningún admin pierda acceso.
- **El pulido de comportamiento del panel** (móvil y escritorio).
- **Los tres niveles del árbol de diseño**, cerrados con el usuario. Prototipos en `.scratch/ventas-pulido-ui/prototipos/`.

## Qué sigue, y qué lo bloquea

**Se puede construir ya** — las pantallas, que ahora tienen forma decidida en los `## Answer` de `ventas-pulido-ui`:

- `ventas-multi-operacion/07` — el selector de operación. **Bloquea la apertura de Colombia**: el panel lanza con dos operaciones activas.
- `ventas-multi-operacion/10` — las doce consultas de `apps/web/src/lib/queries.ts` **no filtran por operación**. Punto ciego estructural del contract: una consulta con Drizzle no pasa por accesor, así que no hubo parámetro que volver obligatorio.
- `ventas-panel/01–04`, `ventas-modulos-y-ruteo/03–04`, `ventas-ingesta-reconocimiento/03`.

**Depende del usuario, no del código:**

| Qué | Bloquea |
| -- | -- |
| Decidir el guardia de `agent_mode` (`ventas-conversacion/05`) | Que Sebastián conteste a un lead nuevo. **Es la última condición del camino de venta.** |
| Credenciales de administración de Shopify | Todo `ventas-cierre-orden` |
| Permiso `whatsapp_business_manage_events` de Meta | `ventas-capi/03` y `04` |
| Migrar +57 304 5430173 a Cloud API | `ventas-multi-operacion/08`. Runbook de 5 pasos en el ticket 09. |
| Crear el dataset de CAPI de Guatemala | El envío de conversiones |

## Trampas que ya costaron tiempo. No las redescubras.

- **El destino de una conversión CTWA no es el píxel**, es un *dataset* de la cuenta de WhatsApp. El mapa daba el píxel por verificado; configurarlo así habría mandado los eventos a un destino real pero equivocado, sin error y sin alarma.
- **`reasoning_effort` no llega al proveedor**: el SDK de OpenRouter descarta `providerOptions`. El campo se guarda, se lee, se pasa y no hace nada.
- **`contacts.agent_mode` no significa «un humano lo tomó»**: arranca en `false` y solo pasa a `true` cuando la confirmación habla. Derivar «humano» de ahí marca justo a los leads nuevos.
- **No inventes vocabulario para actos que el panel ya nombra.** «Tomar el chat» ya es *Agente: ON/OFF*; la cola de triage ya es `needsAttention`. Una ronda entera de prototipos se descartó por esto.
- **`shopify_orders.order_id` tiene único global** y el número de pedido es por tienda. No muerde hasta la segunda tienda; es del ticket 08.
- Al mergear ramas paralelas: **dos verdes por separado pueden romperse al unirse.** Pasó con un fixture al que otra rama le agregó un campo.

## Cómo se ha venido trabajando

Con el skill **`/tanda-de-tickets`**: esta sesión planea, mide, reparte a worktrees en paralelo y es la única que mergea y deploya. Las hijas entregan rama verde y avisan. Los encargos van en un archivo, no en el prompt.

Lo que hace que funcione: **medir antes de repartir** (las «110 referencias» del spec eran menciones del símbolo, no call sites: los reales eran 39), **repartir por superficie y no por ticket**, y **un dueño único por archivo compartido**.
