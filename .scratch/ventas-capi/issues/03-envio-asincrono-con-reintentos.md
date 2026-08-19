# 03 — Envío asíncrono con reintentos

**What to build:** El evento llega a Meta después de que el pedido está creado y el cliente ya recibió su confirmación. Si Meta falla, se reintenta; si sigue fallando, se registra y se sigue.

**Blocked by:** 02 · ventas-cierre-orden 03 · Sebastián cierra y crea el pedido en la tienda

**Status:** resolved — worktree `capi-envio`, migración `0027` **generada y sin aplicar**

- [x] El envío ocurre **después** de que el pedido está creado y confirmado al cliente.
- [x] **Un fallo de Meta no afecta la venta ni la conversación.** Nunca bloquea ni demora la respuesta al cliente.
- [x] Se usa el **token de usuario de sistema**, no el de usuario.
- [x] Un evento fallido entra a cola de reintentos.
- [x] Agotados los reintentos se registra y se sigue: **nunca escala a un humano**.
- [x] Un reintento no produce un evento duplicado en Meta.
- [x] El admin puede saber si el reporte está funcionando, sin esperar un mes.

## Answer

**Qué queda funcionando.** Cuando Sebastián cierra un pedido que vino de un
anuncio, esa venta le vuelve a Meta como conversión, para que la pauta que
Vorare paga aprenda a quién buscar. Está construido de punta a punta y **queda
apagado**: hoy no hay ninguna credencial de Meta en el entorno y el interruptor
nace en `off`, así que **no sale ni una llamada**. Encenderlo es poner dos
variables y desplegar.

**Cómo se dispara, y por qué así.** Cada cinco minutos un barrido mira los
pedidos ya cerrados y pregunta cuáles falta reportar. **No se llama desde el
cierre**, y no es casualidad: si el reporte colgara del cierre, cualquier
lentitud de Meta se la cobraría el cliente que está esperando saber si compró. Y
el criterio pide que el evento salga *después* de que el cliente recibió su
confirmación — desde el cierre ese mensaje recién se está encolando. El barrido
mira hechos ya ocurridos: el pedido existe en la tienda porque ella mandó su
webhook, y la confirmación al cliente tiene fecha de salida.

### Lo que gobierna todo: una venta no se puede contar dos veces

Meta **no deduplica** este flujo — lo dice su documentación y lo dejó anotado el
ticket 02. Si mandamos el mismo pedido dos veces, cuentan dos ventas, y el
algoritmo aprende un ticket promedio y una tasa de conversión falsos. Eso **no se
arregla borrando datos**. Es el riesgo R7, y de él salen las tres decisiones de
fondo:

**1 · Hay un libro de conversiones reportadas, y es una tabla.** No alcanzaba con
la cola: pg-boss ya evita jobs repetidos, pero esa protección solo dura mientras
el job vive — al terminar se archiva a los catorce días y se borra, y a partir de
ahí el barrido volvería a ver el pedido «sin reportar» y lo mandaría de nuevo. La
memoria de una conversión tiene que durar más que la memoria de una cola. Es la
migración `0027`.

**2 · La fila se escribe antes de llamar a Meta, no después.** Primero se pide el
turno, después se manda. Al revés queda un hueco: si el proceso se muere entre
mandar y anotar, la próxima vez se manda otra vez. Al derecho el hueco también
existe, pero se paga distinto — queda una conversión sin mandar, visible en el
tablero. **De los dos errores posibles se eligió el que se puede arreglar.**

**3 · Un fallo se clasifica en tres cosas, no en dos.** Es el hallazgo del
ticket. Lo habitual es partir entre «temporal, reintentá» y «permanente, avisá», y
eso mete en la misma bolsa dos cosas opuestas:

- **No poder conectarse** con Meta significa que Meta *no vio nada*. Reintentar
  es seguro.
- **Colgarse esperando la respuesta** significa que la petición ya salió y Meta
  *puede tenerla adentro*. Reintentar acá es exactamente cómo se fabrica la venta
  contada dos veces.

Así que hay un tercer desenlace: **en duda**. No se reintenta nunca y queda a la
vista. Se distingue mirando el código de error de la red, no su texto, que cambia
entre versiones. *Si alguien lee esto en seis meses y le parece que sobran
estados: son tres a propósito, y colapsarlos a dos reabre la puerta al duplicado
que no se puede deshacer.*

### Cuándo se reintenta y cuándo no

| Qué pasó | Qué se hace |
| -- | -- |
| No se pudo conectar con Meta | Se reintenta (Meta no vio nada) |
| Meta pidió bajar el ritmo, o está caída | Se reintenta |
| Salió y Meta no respondió | **No** se reintenta · queda **en duda** |
| Meta rechazó: token vencido, falta permiso, evento mal formado | **No** se reintenta · queda **fallida** |
| Se agotaron los seis reintentos | Queda **fallida** y se registra |

**Nunca escala a una persona**, ni al fallar ni al agotarse. Es telemetría, no una
venta: despertar a alguien de madrugada por una conversión no reportada gasta la
atención que después hace falta para un cierre que no llegó a la tienda. Lo que
sí hace es quedar registrado y visible.

### Cómo sabe el admin si esto funciona

`GET /api/capi/estado` contesta tres cosas, y la tercera es la que suele faltar:

1. **Si está funcionando** — y distingue *«no hubo nada que reportar»* de
   *«funciona»*, que se ven igual y no son lo mismo. Cero conversiones enviadas
   es el estado normal cuando no hubo ventas por anuncio, y también el estado de
   un reporte roto. El tablero dice **qué miró**: cuántos pedidos hubo, cuántos
   los tomó el vendedor, cuántos vinieron de un anuncio y cuántos esperan algo.
2. **Qué quedó a medias** — las conversiones que pidieron turno y nunca se
   resolvieron, casi siempre porque el worker se reinició en el medio. **No se
   reintentan solas**, a propósito: no se sabe si la petición salió.
3. **Qué quedó en duda, y cómo comprobarlo** — cada fila viaja con el dataset, el
   momento exacto y el valor, que es lo que hace falta para buscar ese evento en
   el administrador de eventos de Meta. Comprobarlo es el ticket 04. *Un estado
   que nadie sabe cómo verificar es un estado que nadie verifica.*

### Las decisiones que tomé, y que alguien podría querer discutir

**La credencial vive en el entorno, no en una columna.** El destino sí es por
operación —`capi_dataset_id` ya existe—, pero el token de usuario de sistema es
del Business Manager que contiene a las dos operaciones: es **una** credencial
para ambas, y guardarla por operación sería guardar el mismo secreto dos veces
esperando que nadie los desincronice. Además así **no se puede encender desde el
panel**: empezar a reportar de verdad pide un despliegue, no un clic — lo mismo
que se decidió para la escritura sobre la tienda.

**El modo de prueba y el real no comparten llave de deduplicación.** Si la
compartieran, el ensayo del ticket 04 dejaría marcadas como «ya reportadas» las
primeras ventas reales —justo las que alguien está mirando durante la prueba— y
esas nunca llegarían al dataset de verdad. Un ensayo no puede consumir el turno
del envío.

**Solo se reportan las ventas del vendedor**, no los pedidos del formulario web.
Es el alcance del ticket, y además un pedido web puede llegar días después del
clic por un camino distinto: atribuirlo es otra pregunta. Ampliarlo después es
quitar una condición en un solo lugar. Hoy no cambia nada — los 1.735 pedidos de
Guatemala son todos del formulario.

**Un pedido de más de siete días no se reporta.** No es criterio nuestro: Meta
rechaza eventos más viejos que eso. Y pone techo al día que alguien encienda el
interruptor después de un mes apagado — entra la última semana, no el mes.

### Lo que encontró el ensayo, y que ningún test podía ver

Se probó el camino entero contra una base desechable (`scripts/ensayo-capi.ts`,
que **se niega a correr contra producción**). Encontró dos errores que ni el
tipado ni los tests de funciones puras podían detectar, porque estaban en **qué
datos llegaban a la decisión**, no en la decisión:

1. **El reintento no reintentaba.** El envío reusaba la búsqueda del barrido, que
   salta todo pedido que ya tiene fila en el libro — incluida la fila que su
   propio primer intento acababa de escribir. El reintento no encontraba nada que
   hacer, terminaba contento, y **la conversión quedaba perdida para siempre al
   primer fallo temporal**.
2. **El tablero mentía sobre lo que había mirado.** Como el barrido descarta los
   pedidos que no son de ventas antes de contarlos, el estado habría dicho «no
   hubo pedidos en el período» sobre una operación que factura 470 al mes.

Y al traer `main` apareció un tercero: la cola de descarte tiene que crearse
**antes** que la que la referencia, o falla y el worker queda sin cola. La cola de
cierres ya había pagado eso en su primer despliegue; acá habría sido peor, porque
sin cola no hay fallas que contar y el tablero habría dicho que todo estaba bien.

### Qué falta para que esto reporte de verdad

Nada de código. Cuatro cosas de configuración, en este orden:

1. **El permiso `whatsapp_business_manage_events`** sobre un **token de usuario de
   sistema** (el de usuario no sirve: choca con la certificación de no
   discriminación). Requiere acceso avanzado, que se le solicita a Meta.
2. **Crear el dataset de la cuenta de WhatsApp** (`POST
   /{whatsapp_business_account_id}/dataset`) y cargarlo en la operación. **No es
   el píxel** — es la trampa más cara del proyecto: el píxel es un destino real y
   equivocado, y mandar ahí no da error ni alarma.
3. **Poner `META_CAPI_MODE=test` con `META_CAPI_TEST_EVENT_CODE`** y comprobar en
   el administrador de eventos que el evento llega bien formado. Es el ticket 04 y
   no es opcional.
4. **Recién entonces `META_CAPI_MODE=live`.**

Hay una quinta condición que no depende de nadie de este equipo: hoy **ninguna
conversación tiene identificador de clic**, porque la pauta apunta a otra cuenta
de WhatsApp. Hasta que los dos números se unifiquen no hay una sola venta que
reportar, ni siquiera con credencial.

**Variables del entorno:** `META_CAPI_MODE` (`off` por defecto · `test` · `live`),
`META_CAPI_SYSTEM_USER_TOKEN`, `META_CAPI_TEST_EVENT_CODE` (obligatoria en modo
prueba), `META_GRAPH_API_VERSION` (por defecto `v26.0`). Cualquier otro valor del
interruptor —`true`, `1`, `on`, un error de tipeo— **deja el reporte apagado**, y
sin token se apaga solo aunque el interruptor esté puesto.

**Guatemala no cambia.** Tabla nueva y vacía, ninguna columna tocada en el camino
que factura, y el reporte apagado por partida triple: sin credencial, sin
interruptor y sin dataset. Medido el 19-ago-2026: 0 conversaciones con
identificador de clic, 0 pedidos con etiqueta de ventas.
