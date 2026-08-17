# 04 — Escalamiento a asesor

**What to build:** Cuando la conversación se sale de lo que Sebastián puede resolver, queda marcada para que un humano la tome. Un lead que pide hablar con una persona no tiene que insistir.

**Blocked by:** 02

**Status:** claimed — worktree `sebastian-persona`, tanda del 17-ago-2026

- [x] El módulo de escalamiento existente suma los triggers del vendedor, sin duplicar lógica.
- [x] Escala ante palabra clave de petición de humano.
- [x] Escala ante objeción repetida sin avance.
- [x] Escala tras dos intentos sin identificar el producto.
- [x] Escala ante petición fuera de las reglas configuradas.
- [x] Una conversación que avanza normalmente no escala.
- [x] Los tests cubren cada trigger y el caso de no escalamiento.

**Nota:** el escalamiento por descuento fuera de rango **no se implementa aquí** — se dispara desde el constructor de orden, en el spec de cierre, que es donde el límite se aplica de verdad.

## Answer — los cuatro disparadores (17-ago-2026, worktree `sebastian-persona`)

### **Sin duplicar lógica**: son triggers puros que el módulo existente compone

Lo pregunta la sesión que coordina y la respuesta es la primera de las dos, con la prueba a la vista: **`agent/escalation.ts` no perdió ni ganó una sola línea de lógica — ganó cuatro valores en su tipo de motivo y sus filas en las dos tablas que ya tenía** (`REASON_LABEL` y `CUSTOMER_NOTICE`). La transición de `agent_mode`, la idempotencia por hora, el aviso de cortesía al cliente, la alerta al admin **de la operación de la conversación** y su caída a plantilla fuera de la ventana de 24h siguen existiendo una sola vez, en ese archivo, y el vendedor pasa por ahí exactamente igual que el audio sin transcripción.

Lo nuevo son dos archivos que **no escalan a nadie**:

- `sales/escalation-triggers.ts` — **puro**. Recibe los turnos del lead y dos hechos del reconocimiento; devuelve un disparador o `null`. No toca la base, ni el reloj, ni `agent_mode`. Por eso el nombre dice `triggers` y no `escalation`.
- `sales/escalation-facts.ts` — la única parte que lee la base: traer los turnos del lead. Separado igual que en el reconocimiento y el ruteo — lo que se prueba con fixtures no puede necesitar una conexión.

La traducción entre los dos vocabularios es una tabla, `SALES_ESCALATION_REASON`, y vive en el módulo existente: allá se nombra **por qué la conversación se atascó**, aquí **qué lee el asesor en la alerta**. Si esto fuera un segundo módulo de escalamiento habría un segundo sitio que apaga el agente, un segundo mensaje al cliente y un segundo camino al admin. Hay uno de cada.

### Los cuatro, y por qué léxicos

`human_requested` · `out_of_rules_request` · `repeated_objection` · `product_unidentified`. Precedencia en ese orden, y **solo decide qué se reporta**: los cuatro hacen lo mismo. La petición explícita gana porque es lo más informativo que el asesor puede leer antes de abrir el chat.

Son reglas léxicas y no un clasificador: preguntarle a un modelo «¿pidió un humano?» agrega una llamada, su latencia y su costo **a cada turno** para decidir algo que en WhatsApp se dice con cuatro frases, y agrega su propio modo de fallar —un «sí» alucinado apaga al vendedor en una conversación que iba bien—. Reglas legibles, con sus tests.

Dos decisiones que conviene mirar:

- **«Objeción repetida sin avance»** se mide sobre los turnos del **lead**, no sobre las respuestas del vendedor: la misma categoría de objeción en dos turnos distintos, y ningún turno de avance —pedir el total, dar la dirección, decir que lo quiere— entre el primero y el último. Volver sobre el precio después de pedir el total es negociación normal, y no escala. Cambiar de objeción tampoco: eso es avanzar por la lista.
- **«Petición fuera de las reglas configuradas»** tuvo que resolverse contra el código y no contra el ticket: **no hay campo de reglas que configurar**. La `0022` le dio al vendedor nombre, mensajes base, tono, límite de descuento, modelo y esfuerzo — ninguna lista. Así que es un **catálogo fijo y documentado** de las promesas que el negocio no hace, las mismas de las reglas duras del prompt: garantías y devoluciones, crédito/cuotas/factura, fecha u hora comprometida, venta al por mayor, envío fuera del país. Cuando el panel gane un campo de reglas, esta lista es su valor por defecto, no un competidor suyo.

**El descuento no está entre los disparadores**, y hay un test que lo fija: pedir un descuento no escala. Se valida al construir la orden, que es donde se sabe de cierto que se pasó del límite; escalarlo desde la conversación sería adivinar por el texto lo que el otro worktree sabe con un número.

### Tests

`sales/escalation-triggers.test.ts`, 20 casos: cada disparador con sus variantes reales (acentos, mayúsculas, teclado de teléfono), **y los que no deben escalar** — «gracias asesor» (Sebastián *es* asesor: sin verbo de pedir no es una petición), pedir descuento, una sola objeción, objeción resuelta con avance en medio, y la conversación completa que pregunta, duda y compra. Ese último importa tanto como los cuatro: un vendedor que escala ante la primera objeción no vende nada y le llena la bandeja al asesor.
