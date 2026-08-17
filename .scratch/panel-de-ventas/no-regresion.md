# No-regresión · la operación de Guatemala no puede cambiar

**Restricción permanente de todo el proyecto.** Guatemala factura hoy: 1.678 pedidos, 88,4% de confirmación, un número en calidad verde. Ningún ticket puede alterar su comportamiento observable. Si un ticket obliga a elegir entre avanzar y no tocar Guatemala, **no se toca Guatemala**.

## La red de seguridad que ya existe

- **`strict: true` y `noUncheckedIndexedAccess: true`** en toda la base. Al volver obligatorio el parámetro de operación, el compilador encuentra los call sites que falten. El paso de *contract* no puede fallar en silencio.
- **`pnpm typecheck`** corre en los tres paquetes. **`pnpm --filter @wa/worker test`** corre vitest.
- Ejecutar ambos **después de cada lote** de la migración, no al final.

## Riesgos concretos, por severidad

### R1 · El heurístico de «el cliente ya respondió» marca pedidos como confirmados

`jobs/followup.ts` — si existe cualquier mensaje entrante posterior a `receivedAt`, el job **salta la plantilla, marca el pedido `confirmed` con fecha, activa el modo agente y retorna**.

Ese heurístico asume que un mensaje entrante significa «ya estamos hablando, la plantilla sobra». Es correcto para un pedido web. **Es falso para un pedido de ventas**, donde la conversación *es* el origen: el cliente acaba de hablar con Sebastián, así que siempre habrá respuesta reciente.

Consecuencia si no se aborda: **todo pedido de ventas quedaría auto-confirmado sin verificación de dirección.** En contraentrega, la dirección sin verificar es la causa número uno de devolución — y el pedido diría «confirmado» mientras nadie lo confirmó.

Es responsabilidad de *ventas-cierre-orden 05*. No se puede resolver bajando el heurístico: hay que distinguir el origen del pedido antes de aplicarlo.

### R2 · Migración de la configuración de agente

Sesenta y cinco referencias, quince archivos, y de ahí cuelgan el seguimiento, el remarketing, el acuse de confirmación y todas las plantillas de logística. Es el lote de mayor radio del proyecto. Si rompe, Katherine deja de confirmar.

Mitigado por el tipado estricto, pero **partir el lote por área** si no logra quedar verde de una.

### R3 · Migración de la conexión de WhatsApp

Si el accesor cambia mal, deja de salir todo mensaje. Es el lote de menor radio —diez referencias— y por eso va primero: sirve de ensayo del patrón.

### R4 · El receptor de pedidos de la tienda

Por ahí entran los 1.678 pedidos. Cualquier cambio ahí toca el camino que factura. El criterio de *ventas-cierre-orden 05* —que un pedido no originado en ventas conserve exactamente el comportamiento actual— es el que más importa de ese ticket.

### R5 · La logística está en modo simulación

`dropi_dry_run` está en `true`: las confirmaciones a logística **no se envían de verdad**. Quien haga la migración va a ver esa bandera y le va a parecer un error.

**No la cambies de paso.** Si es intencional, cambiarla dispararía confirmaciones reales sobre 1.755 pedidos. Si es un olvido, es una decisión aparte y con dueño, no un efecto colateral de un refactor.

### R6 · Credenciales de escritura sobre una tienda viva

La conexión de administración de la tienda está vacía hoy, así que el sistema no puede escribir. Al configurarla se le da capacidad de **crear pedidos en la tienda real**.

Pedir solo los permisos necesarios, verificar primero en lectura, y probar la creación contra un pedido desechable antes de conectarla al cierre automático.

### R7 · Eventos de conversión sobre el píxel real

CAPI reporta al píxel de producción, del que depende la optimización de la pauta que Vorare paga. Un evento mal formado o duplicado **envenena el aprendizaje del algoritmo**, y eso no se revierte borrando datos.

Usar el código de prueba de Meta y confirmar en el administrador de eventos **antes** de habilitar el envío real. Es el ticket *ventas-capi 04* y no es opcional.

### R8 · Dueño de conversación sobre el número vivo

Introducir la lógica de agente dueño en el número que hoy atiende a clientes reales puede rutear a postventa hacia el vendedor. Mientras exista un solo agente configurado, el comportamiento debe ser idéntico al actual — la lógica nueva solo se activa cuando hay un vendedor configurado para esa operación.

## Reglas de trabajo

1. **Guatemala primero, sin cambios.** Se migra la operación existente antes de crear la colombiana, y su comportamiento no cambia en ningún paso intermedio.
2. **Verde entre lotes.** `typecheck` y tests después de cada ticket de migración, no al final.
3. **Nada de banderas ajenas.** Si un refactor tropieza con una configuración rara —modo simulación, un valor por defecto extraño— se documenta y se deja como está.
4. **Escrituras externas, primero en seco.** Tienda y píxel se prueban en modo prueba antes de operar de verdad.
5. **Si hay duda, no se toca.** El costo de retrasar un ticket es un día. El de romper la confirmación es la operación entera.
