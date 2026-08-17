# 02 — La función de ruteo de bandeja

**What to build:** Dada una conversación y los hechos que la rodean, el sistema sabe **a qué bandeja pertenece** — la de ventas o la de operaciones — sin que nadie lo marque a mano.

Es una función pura y derivada. Como se deriva de hechos que ya existen, **no puede quedar desactualizada**: nadie puede olvidar mantenerla.

**Blocked by:** ventas-multi-operacion 02 · La conexión de WhatsApp cuelga de la operación

**Status:** resolved — worktree `ruteo-bandeja`, tanda del 17-ago-2026 · rama `danielmedinac22/ruteo-bandeja`, sin merge ni deploy

Reglas, de mayor a menor precedencia:

1. Atribución de anuncio **más reciente que el último pedido** → **ventas**.
2. Pedido creado y aún no entregado ni cancelado → **operaciones**.
3. Pedido entregado o cancelado, sin clic posterior → **operaciones**.
4. Nada de lo anterior → **ventas**. Un mensaje sin pedido es un lead.

- [x] Función pura: recibe hechos, devuelve bandeja. No consulta base de datos por dentro.
- [x] **No se guarda ningún estado nuevo.** El sistema ya tiene tres máquinas de estado; una cuarta guardada tendría que mantenerse de acuerdo con todas.
- [x] Los tests cubren: lead sin pedido · pedido recién creado · pedido en tránsito · pedido entregado · pedido cancelado · contacto sin nada.
- [x] **Test obligatorio del recomprador:** pedido entregado en el pasado **más un clic de anuncio posterior** debe dar **ventas**. Es el caso que rompe los diseños ingenuos y por eso va escrito como test, no como intención.

## Answer — construido el 17-ago-2026

**La función existe, es pura y está probada.** `apps/worker/src/inbox/resolve.ts`, con su test al lado. No toca la base, no guarda nada, no importa ninguna tabla. Recibe hechos, devuelve bandeja.

### La firma

```ts
resolveInbox(facts: InboxFacts): InboxDecision

interface InboxFacts {
  lastAdClickAt: Date | null;        // el clic de anuncio MÁS RECIENTE de la conversación
  orders: readonly OrderFacts[];     // todos los pedidos del contacto, en cualquier orden
}
interface OrderFacts {
  createdAt: Date;                            // shopify_orders.received_at, o created_at de la fila Dropi si nunca pasó por la tienda
  pipelineStatus: OrderPipelineStatus | null; // order_status  · null si el pedido no vino por la tienda
  logisticsStatus: OrderLogisticsStatus | null; // dropi_status · null si aún no existe en logística
}
interface InboxDecision {
  inbox: "ventas" | "operaciones";
  rule: "ad_click_after_last_order" | "order_in_progress" | "order_finished" | "no_order";
}
```

Y una segunda función exportada, `resolveOrderPhase(order): "in_progress" | "finished"`, que es la clasificación de las reglas 2 y 3 hecha pieza aparte para que la bandeja de operaciones (ticket 03) la use sin volver a derivarla.

**Se copió la forma de `operations/resolve.ts`**, como pedía el encargo: función pura, tipos estructurales de dos o tres campos, y una decisión que dice *qué regla la produjo* y no solo el resultado. Ese `rule` no es decorativo: es lo que vuelve verificable en un test que el recomprador cayó en ventas *por el clic* y no por casualidad.

**Los tipos de los estados son el enum real del esquema, no una copia a mano**: `type OrderLogisticsStatus = DropiOrder["status"]` — un `import type` de `@wa/db`, sin tabla ni cliente en tiempo de ejecución, y el mismo idioma que ya usan `jobs/dropi-poll.ts` y `dropi/notify.ts`. La consecuencia es que los dos `switch` son exhaustivos con `never`: si el esquema gana un estado logístico, este módulo **deja de compilar** hasta que alguien decida en qué fase cae. Se verificó en negativo: un `Record` al que le falta `retornado` no compila, y un estado inventado tampoco. Es la garantía dada por el tipo y no por un comentario. El test tiene además una tabla `Record<OrderLogisticsStatus, …>` con los 16 estados: si aparece uno nuevo, el fixture tampoco compila.

### Qué decidí con los estados ambiguos de logística, y por qué

**Cuando la logística sabe, la logística manda.** El pipeline de tienda solo decide cuando no hay información logística (`null` o `unknown`). Esto no es estético: en producción hay **49 pedidos `followup_sent` + `entregado`** —la tienda nunca los confirmó por WhatsApp y Dropi los confirmó y entregó por su cuenta— y **42 `followup_sent` + `anulada`**. El pipeline habla de la confirmación y se queda quieto en cuanto el pedido entra a Dropi; leerlo como fuente de verdad diría «en curso» de pedidos que llegaron hace un mes. Corolario: `cancelled` en tienda + `en_transito` en Dropi = **en curso** (a operaciones le queda anularlo antes de que salga).

**`en_oficina` → en curso.** No es entregado: el paquete está en la oficina esperando a que el cliente lo reclame, y a operaciones le queda lograr que lo reclame. Hay 47 así hoy.

**`novedad_solucionada` → en curso.** La novedad se resolvió; la entrega sigue. Tratarlo como terminal sería el mismo error que mapearlo a `novedad`, en la otra dirección.

**`devolucion`, `rechazado`, `retornado` → terminales (`finished`), junto con `entregado` y `anulada`.** La entrega no se dio y el paquete volvió; un nuevo intento en Dropi es un pedido nuevo, no una continuación de este. Tres evidencias: `dropi/normalize.ts` ya los agrupa como «terminales de devolución»; `@wa/shared` los pone en la situación «Devuelto / retornado» junto a DEVUELTO; y en producción son 159 filas y **ninguna ha cambiado de estado después de entrar** (mediana 17 días sin cambio, y `rechazado` llega desde `pendiente_confirmacion` — es el cliente diciendo que no en la llamada de confirmación, que es un cierre). `retornado para reproceso` es el único con nombre ambiguo: hay 1 fila, y «reproceso» en Dropi es que el proveedor lo vuelve a inventariar, no que el mismo pedido se reenvíe.

**`unknown` → no opina.** No es una fase: es «Dropi reportó algo que no supimos mapear» o la fila recién creada. Ahí decide el pipeline de tienda; y si tampoco lo hay, el pedido cuenta como en curso: existe, y nadie dijo que terminó.

**`no_response` (tienda) → en curso.** No es cancelado: el cliente no contestó el seguimiento, pero el pedido sigue sin confirmar ni anular. Solo `cancelled` termina desde la tienda. Nota: ni `no_response` ni `cancelled` se escriben hoy en producción (el pipeline vive en `confirmed` 1.476 / `followup_sent` 209); están decididos igual porque el enum los tiene y el `switch` los exige.

**Nada de esto cambia la bandeja hoy** —las dos fases rutean a operaciones— pero es la decisión que las reglas 2 y 3 enuncian por separado, queda escrita como test y no como `else`, y le da al ticket 03 la diferencia entre «por confirmar y en camino» y «terminado».

### Las reglas, con los bordes decididos

- **El clic tiene que ser estrictamente posterior al último pedido.** El pedido que nace de una venta se crea *después* del clic que la trajo, así que «clic anterior o igual» = «esa venta ya cerró» → operaciones. Es exactamente cómo un lead convertido desaparece de la bandeja de ventas y aparece en la de operaciones, solo (criterio del ticket 03). Empate de instantes → no es posterior.
- **Con varios pedidos, el clic se compara contra el más reciente por `createdAt`**, no contra el primero, y los pedidos se pueden pasar en cualquier orden. 142 conversaciones tienen hoy más de un pedido — no es un borde teórico.
- **Basta un pedido en curso para que la conversación cuente como en curso**; solo con todos terminados es `order_finished`.
- **Regla 1 gana aunque el pedido anterior siga en camino.** Pedido `en_transito` + clic posterior → ventas. Es lo que dice el spec por precedencia y quedó fijado como test para que sea una decisión y no un accidente. Consecuencia consciente: la venta nueva la toma ventas, y las notificaciones logísticas del envío en curso siguen saliendo por su cuenta porque no dependen de la bandeja.
- **No existe «ninguna bandeja».** Toda conversación cae en una; si no se sabe nada del contacto, es un lead. Mismo criterio que la decisión de operación sin caso «descartar».

### Verificación

`pnpm -r typecheck` limpio en los 4 paquetes. `pnpm --filter @wa/worker test`: **118 tests en 8 archivos** — los 73 existentes sin tocar y **45 nuevos**, que cubren los siete casos del ticket (lead sin pedido · recién creado · en tránsito · entregado · cancelado en tienda y anulado en logística · sin nada · **el recomprador**) más los bordes de arriba y la tabla completa de estados.

Además se alimentó la función con los hechos reales de producción, solo lectura: **1.693 conversaciones, todas caen en una bandeja** — 1.207 operaciones/terminado, 376 operaciones/en curso, 110 ventas/sin pedido (con `lastAdClickAt = null`, que es el estado real hoy porque las columnas de atribución no existen). Y la simulación del recomprador —contacto con todo terminado más un clic de hoy— devuelve `ventas / ad_click_after_last_order`.

### Lo que este ticket deliberadamente NO hizo

- **No guardó nada.** Ni columna, ni caché, ni campo derivado. Ni migración ni `schema.ts`.
- **No consultó la base desde la función.** El smoke contra producción vive en el scratchpad de la sesión, no en el repo.
- **No copió los enums a mano** (como hace `dropi/normalize.ts` con su `DropiStatusEnum` local): una copia deriva en silencio; el tipo del esquema rompe el build, que es lo que se quiere.
- **No tomó `confirmation_status` como entrada.** Es la segunda máquina de estado, pero habla del mismo hecho que `order_status` (la confirmación) y las reglas no la nombran. Meterla habría sido inventar una regla.
- **No construyó bandejas, pantallas ni asignación.** Tickets 03 y 04.
- **No tocó `dropi-poll.ts`**, cuya lista `QUIESCENT` sigue siendo solo `entregado`/`anulada`. Es otra pregunta (cuándo dejar de sondear) y ser conservador ahí es barato; se deja anotado, no se cambia de paso.

### Dos cosas que otros tickets tienen que saber

1. **`lastAdClickAt` tiene que ser el clic más reciente, no el primero.** El spec de ingesta dice «atribución persistida en el primer contacto», y si `0022` la modela como columnas que se escriben una sola vez, **el recomprador nunca vuelve a ventas**: su clic de agosto quedaría tapado por el de julio. Quien persista la atribución (esquema `0022`, ingesta 02, CAPI 01) tiene que actualizarla en cada mensaje que traiga referral, o guardar historial. Está dicho en el doc del módulo y en el tipo, pero es un contrato entre tickets, no algo que este código pueda garantizar.
2. **Hoy 1.207 conversaciones caerían en operaciones como «terminado» «hasta que algo cambie».** Es lo que el spec pide, pero la bandeja de operaciones (ticket 03) tiene que ordenar o filtrar por actividad; el `rule` está para eso.
