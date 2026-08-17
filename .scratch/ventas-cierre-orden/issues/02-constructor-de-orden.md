# 02 — Constructor de orden con validación y clamp de descuento

**What to build:** Dados los datos de cierre de una conversación y la configuración vigente, sale un pedido listo para crear en la tienda, o el conjunto de errores que impiden crearlo. Es el punto donde el límite de descuento deja de ser texto en un prompt y se vuelve una regla real.

Una sola función pura concentra validación, mapeo, clamp e idempotencia — es una sola decisión de negocio, y partirla daría varios seams para probar lo mismo.

**Blocked by:** None — can start immediately.

**Status:** resolved — worktree `constructor-orden`, tanda del 17-ago-2026 · rama `danielmedinac22/constructor-orden`, sin merge ni deploy

- [x] Valida los seis requeridos: nombre, apellido, teléfono, ciudad, departamento, y dirección **o** reclamo en oficina.
- [x] Teléfono en formato válido para el país de la operación.
- [x] **Ciudad y división administrativa contra la lista del país de la operación**, no contra una lista fija. Guatemala y Colombia tienen listas distintas.
- [x] **El pedido lleva la moneda de su operación** —quetzales o pesos— sin valor por defecto.
- [x] **El pedido se construye para la tienda de su operación.** Que un pedido de una operación pueda apuntar a la tienda de otra es el error más caro del módulo: produce un despacho al país equivocado.
- [x] Hay test que demuestra que una dirección válida en un país falla contra la lista del otro.
- [x] **Dirección y reclamo en oficina coexistiendo es un error de validación**, no una preferencia.
- [x] El payload lleva líneas con producto, variante y cantidad; cliente; dirección o etiqueta de reclamo en oficina; estado financiero pendiente por contraentrega; y las etiquetas de origen de ventas y nombre del vendedor.
- [x] **Un descuento por encima del límite configurado sale clampeado al precio válido, y el resultado señala que hubo clamp** para que el orquestador escale.
- [x] Un límite en cero con descuento pactado también clampea.
- [x] La llave de idempotencia se deriva del lead, no del momento ni de un aleatorio: dos construcciones del mismo cierre dan la misma llave.
- [x] Los tests cubren cada caso anterior más campo requerido faltante y ciudad fuera de lista.

## Answer — construido el 17-ago-2026

**Existen las dos funciones puras y están probadas.** El constructor en `apps/worker/src/sales/order.ts`; el resolutor del plan de seguimiento en `apps/worker/src/sales/followup-plan.ts`; las listas y reglas por país en `apps/worker/src/geo/`. Cada uno con su `.test.ts` al lado. Ninguna toca la base, el reloj, la red ni Shopify. **No se creó nada en la tienda y no se cableó nada:** el módulo construye el payload y ahí termina.

### La firma

```ts
buildSalesOrder(input: {
  store: SalesOrderStore;      // la tienda + moneda + país de la operación, en UN valor
  closing: SalesClosing;       // leadRef, contacto, líneas, descuento pactado
  settings: SalesSettings;     // discountLimitPct, sellerName — se RECIBEN, no se consultan
}): SalesOrderResult

type SalesOrderResult =
  | { ok: true; order: SalesOrderDraft; discount: DiscountOutcome }
  | { ok: false; errors: readonly [SalesOrderError, ...SalesOrderError[]] };
```

**Una sola función exportada, como pedía el spec.** Validación, mapeo, clamp e idempotencia viven dentro; los ayudantes no se exportan, así que no hay forma de llamar al mapeo sin haber pasado por la validación y no hay cuatro costuras para probar una decisión. Lo único que se exporta además es `salesOrderStore()`, que no es una parte de la decisión sino la fábrica del valor de entrada — y es donde está la garantía más cara del ticket.

### Los tres errores caros, y cuál de ellos dejó de ser escribible

1. **Pedido de una operación en la tienda de otra.** No es un error de validación: es un valor que no se puede construir. `SalesOrderStore` está **marcado** con un `unique symbol` privado del módulo, así que la única puerta es `salesOrderStore(operation, connection)`, que devuelve `null` si la conexión pertenece a otra operación, si no hay conexión, si falta el dominio o si la operación no dice moneda o país. Los cuatro casos significan lo mismo para quien llame —esta operación todavía no puede crear pedidos— y **hoy los cuatro son uno solo y real**: `shopify_connection` tiene 0 filas.
2. **Moneda por defecto.** Sale del mismo valor marcado. En el módulo no hay ninguna constante `"GTQ"` y no puede haberla: el tipo no ofrece de dónde sacarla si no es de la operación. El test lo demuestra construyendo el mismo cierre contra las dos tiendas y comparando `currency`.
3. **Dirección y reclamo en oficina a la vez.** En la **entrada** es escribible a propósito —el cliente puede decir las dos cosas y hay que detectarlo—, así que es `address_and_pickup_conflict`. En la **salida** no: `SalesOrderShipping` es una unión `delivery | pickup_at_office`, y el pedido con las dos no se puede representar.

### Dónde viven las listas geográficas, y por qué ahí

**Módulo de constantes indexado por `country_code`**, en `apps/worker/src/geo/`: `country.ts` (la tabla de reglas y la resolución) y `data/guatemala.ts` · `data/colombia.ts` (los nombres). Encaja con que la operación ya lleva su ISO alfa-2: quien valida recibe la operación, saca el código y tiene las reglas. Un código sin listas devuelve `null` y produce `country_unsupported` — nunca cae en un país por defecto, por lo mismo que `operations/resolve.ts` no atribuye un mensaje a la operación equivocada.

**No están en la base, y no las metí sin avisar.** El dato es de otra naturaleza que `products` u `operations`: no lo edita nadie del negocio, cambia cuando cambia la división política de un país, y es idéntico en toda instalación. En la base costaría una migración de mil quinientas filas, una consulta por validación y un estado que puede quedar a medio sembrar en un ambiente y no en otro, sin ganar nada: nadie va a editar «Sacatepéquez» desde el panel. En código se versionan con el resto y no tienen ambiente donde estar mal. **Si prefieres que vayan a la base, es una migración y el número lo repartes tú** — el cambio sería reemplazar el cuerpo de `country.ts` sin tocar a quien lo llama.

**Colombia salió de DIVIPOLA, no de mi memoria.** 33 departamentos (32 más Bogotá D.C.) y los **1.122 municipios** oficiales, generados del dataset del DANE en el portal de datos abiertos (`datos.gov.co/resource/gdxc-w37w`, corte 30-dic-2024). Escribir mil entradas a mano deja faltantes, y cada faltante es una dirección buena rechazada. Para actualizar se vuelve a bajar y se regenera el archivo entero.

**Guatemala son los 22 departamentos y los 340 municipios**, escritos con los nombres oficiales y cotejados entrada por entrada contra la división administrativa de Wikidata (`Q1872284`) y contra el conteo oficial. El cotejo encontró tres errores *en Wikidata* que no se copiaron: Palín está en Escuintla y no en Guatemala, a Petén le faltaba San Benito, y Chimaltenango tenía un municipio fantasma.

**Las tildes.** La comparación normaliza a NFD, quita diacríticos (la ñ incluida), pasa a minúsculas, borra puntos y comas y junta espacios: «Sacatepequez», «SACATEPÉQUEZ» y «sacatepequez » son el mismo departamento, y «Narino» encuentra a «Nariño». Lo que la normalización no arregla sola —nombres realmente distintos— va en una tabla de alias corta y auditable por país: «Ciudad de Guatemala» → «Guatemala», «La Antigua» → «Antigua Guatemala», «Xela» → «Quetzaltenango», «Cartagena» → «Cartagena de Indias», «Bogotá» → «Bogotá, D.C.». Sin esa tabla, el destino más frecuente de Guatemala fallaría la validación. **El pedido sale con el nombre canónico, no con lo que tecleó el cliente.**

**Un tercer error, más útil que «ciudad inválida».** El municipio se valida **dentro de su departamento**, no contra la bolsa del país, porque «San José» es municipio de Escuintla y de Petén y «La Democracia» de Escuintla y de Huehuetenango. Eso hace aparecer el caso intermedio real —«Antigua Guatemala» con departamento «Guatemala»— que sale como `city_in_other_division` **con la lista de dónde sí está**, para poder repreguntar con precisión en vez de volver a pedir la dirección entera. Y los errores salen **todos juntos**: el vendedor pide de una vez todo lo que falta.

**Teléfono.** Regla de *posibilidad*, no de existencia, parametrizada por país: Guatemala ocho dígitos empezando en 2–7; Colombia diez empezando en 3 (móvil) o 60 (fijo desde la marcación unificada de 2022). Acepta con o sin «+», con o sin indicativo, con espacios y guiones, y prueba el número tal cual **antes** de quitarle el indicativo (si no, «50212345» se leería como cinco dígitos). Devuelve E.164. No es `lib/phone.ts`: aquel resuelve el `wa_id` con el que se direcciona un mensaje, que es otra pregunta.

### El clamp y la llave

**El descuento nunca falla la construcción.** `applied = min(pactado, límite)`; si `applied < pactado`, `discount.clamped` va en `true` y el resultado trae los tres porcentajes para que el orquestador escale con datos. Con el límite en **cero** —el valor por defecto de la tabla, y el que hay hoy porque `sales_agent_settings` está vacía— cualquier descuento pactado clampea a precio de lista y avisa. Un pactado negativo se lee como cero: un «descuento» que sube el precio es un dato malo, no una negociación.

**La llave es del lead y de lo que compró, de nada más.** `ventas-<sha256(operationId, leadRef, líneas ordenadas)>`. Ni el instante ni un aleatorio entran, que es lo que hace que dos disparos del mismo cierre colisionen. Las líneas entran **a propósito**: hay una conversación por contacto para siempre (`conversations.contact_id` es único), así que una llave que fuera *solo* del lead bloquearía la recompra de ese cliente hasta el fin de los tiempos. Los datos personales **no** entran: corregir un dígito del teléfono entre dos intentos no puede crear un pedido nuevo — ese es justo el duplicado que se quiere evitar. Hay test de las cinco cosas.

### El plan de seguimiento

```ts
resolveFollowupPlan(input: {
  tags: readonly string[];    // las etiquetas del pedido, tal como quedaron en la tienda
  window: ServiceWindowState; // "open" | "closed" | "unknown", el tipo que ya existe
  directDelayMs: number;      // la demora vigente del pedido web, se devuelve TAL CUAL
}): FollowupPlan   // { origin, content, mechanism, delayMs, template }
```

**El origen decide el contenido y la demora; la ventana decide el mecanismo**, y las dos dimensiones no se tocan. El origen se lee de la etiqueta `origen-ventas`, que es el mismo string que escribe el constructor —definido una vez, en `order.ts`— así que quien escribe y quien lee no se pueden desincronizar. `template` **no es opcional**: existe siempre, también para ventas, porque el borde que obliga a separar las dimensiones es el pedido de ventas que se atrasó más de 24 horas en la cola de reintentos y se quedó sin ventana. La ventana `unknown` sale por plantilla: una plantilla dentro de ventana abierta se entrega igual (y siendo UTILITY ni se cobra), un texto libre fuera de ventana no se entrega en absoluto.

**La demora de ventas es constante (diez minutos) y la del pedido directo se recibe.** El spec pedía que dejara de ser un campo único para los dos orígenes, no que naciera un segundo campo: cada perilla es superficie de falla y soporte no cotizado, igual que el umbral de `recognition.ts`.

**La plantilla de respaldo de ventas es `confirmacion_datos_cod`, la que ya existe.** El spec se contradice a sí mismo aquí: sus *Testing Decisions* piden «la plantilla nueva» y sus *Implementation Decisions* y *Further Notes* dicen que no hace falta aprobar ninguna porque el mensaje cae en ventana abierta. Resolví a favor de las decisiones de implementación —y del encargo, que reformula el test como «contenido de venta y diez minutos»—: la plantilla aprobada ya reconoce el pedido y pide validar la dirección, que *es* el contenido de ventas, y una plantilla nueva devolvería una aprobación de Meta al camino crítico que el spec sacó de ahí. Si algún día se aprueba una, se cambia en un solo sitio.

### Lo que encontré y no está en el ticket

- **La demora de hoy en Guatemala son 120.000 ms, no cinco minutos.** El spec dice «diez en vez de cinco»; cinco es el valor por defecto del esquema y el respaldo de `routes/shopify.ts`, pero la operación tiene configurados dos minutos. No cambia el diseño —el plan **recibe** esa demora y la devuelve intacta— pero sí cambia el contraste real: 2 → 10 minutos. Verificado en producción, solo lectura.
- **`sales_agent_settings` está vacía** (0 filas), igual que `products` (0) y `shopify_connection` (0). Consecuencia para quien cablee: *sin fila no hay límite configurado*, y el valor seguro es `discountLimitPct: 0` — que es el default de la columna y hace que todo descuento clampee. No inventar otro.
- **No existe accesor de `sales_agent_settings` en `@wa/db`** (sí lo hay para `agent_settings`). Hace falta uno, por operación, cuando se cablee.
- **La ciudad de un pedido de tienda hoy no se valida contra nada** (`shopify/extract.ts`, `pickCity`, que además concatena ciudad y provincia en un solo string). Este módulo no lo toca: el pedido web conserva su camino exacto.

### Verificación

`pnpm -r typecheck` limpio en los 4 paquetes. `pnpm --filter @wa/worker test`: **202 tests en 12 archivos** — los **135 existentes sin tocar** y **67 nuevos**: 34 del constructor, 21 de las reglas por país y 12 del plan de seguimiento.

Cubren los doce casos que pide el ticket —completo con dirección · completo con reclamo en oficina · **los dos coexistiendo, que falla** · teléfono inválido para el país · ciudad y departamento fuera de lista · **la dirección colombiana válida que falla contra Guatemala, y la guatemalteca que falla contra Colombia** · moneda de la operación · requerido faltante · descuento dentro del límite · **por encima, clampeado y señalado** · límite en cero · **dos construcciones del mismo cierre con la misma llave**— más los del plan: **etiqueta de ventas → contenido de venta y diez minutos**, **sin etiqueta → comportamiento de hoy idéntico**, y **ventas con ventana cerrada → plantilla**.

Sin escrituras a producción. Sin worker levantado. Sin tocar `jobs/followup.ts`, `dropi_dry_run` ni ninguna bandera.
