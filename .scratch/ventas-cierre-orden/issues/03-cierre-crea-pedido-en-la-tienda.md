# 03 — Sebastián cierra y crea el pedido en la tienda

**What to build:** Una conversación que llega al cierre produce un pedido real en la tienda, con pago contraentrega y etiquetado como venta del agente. El lead da sus datos en el chat, se le avisa en el momento si algo quedó mal, y al final recibe confirmación de que su pedido quedó registrado.

**Blocked by:** 02 · ventas-conversacion 02 · Conversa con el contexto del producto

**Status:** abierto — el camino está construido entero **y ya se puede disparar desde la conversación**; falta la tienda conectada para verlo crear un pedido de verdad

- [x] Sebastián pide los datos de cierre dentro de la conversación, sin formularios ni enlaces externos.
- [x] Un dato inválido se le comunica al lead en el momento, con qué corregir.
- [ ] Con datos válidos se crea el pedido en la tienda y el lead recibe confirmación. *(el camino está entero; sin tienda conectada no se pudo ver)*
- [x] **Dos disparos del mismo cierre producen un solo pedido.**
- [x] Un descuento fuera de rango crea el pedido al precio válido y **escala el caso a un asesor**.
- [ ] El pedido queda visible en la tienda con sus etiquetas de origen. *(pide la tienda real)*
- [x] El lead recibe el mensaje de embudo avisando que confirmaciones lo va a contactar.

## Answer · el camino a la tienda (ola 3)

El camino del cierre a la tienda quedó **construido entero y probado**, y le
faltaba una sola cosa para poder usarse: **que el vendedor tuviera cómo entregar
los datos del cliente**. Eso vive en el turno de conversación de Sebastián
(`agent/runner.ts`), que era de otro worktree, y no se tocó — el encargo decía
parar y avisar antes que meter mano en archivo ajeno. **Lo resolvió la ola 4, más
abajo.**

### Lo que ya hace el sistema

**Crea el pedido de verdad en la tienda de su operación**, con pago contraentrega,
las líneas al precio pactado, la dirección de envío y las etiquetas de origen y
vendedor. Antes solo sabía leer de la tienda; escribir es código nuevo.

**Dos disparos del mismo cierre producen un solo pedido.** La llave del cierre
—que sale del cliente y de lo que compró, nunca del reloj— viaja como una
etiqueta del pedido, y **antes de crear se busca**. Si ya existe, no se crea otro.
Y si esa búsqueda **falla**, tampoco se crea: no saber si ya existe no es lo mismo
que saber que no existe, y confundirlos manda dos envíos contraentrega del mismo
producto al mismo cliente.

**Un dato malo se le dice al cliente en el momento, y todo junto.** «Me falta tu
apellido, el número no me cuadra, y ese municipio no lo encuentro» sale en un solo
mensaje, no en tres. Una corrección por mensaje es cómo se pierde a alguien que ya
había decidido comprar.

**Y hay una distinción que resultó importante: no todo error es del cliente.** Que
su municipio no exista, lo puede corregir. Que el carrito venga vacío o que el
país no tenga listas cargadas, **no**. Pedirle al cliente que corrija un error del
sistema lo deja intentando algo imposible y sin nadie mirando, así que esos casos
**escalan a un asesor** en vez de repreguntarle.

**Un descuento fuera de rango no pierde la venta**: el pedido se crea al precio
autorizado y el caso escala a un asesor para que decida si lo honra. La venta ya
está pagada en publicidad; rechazarla para proteger el margen las pierde las dos.

**Al final, el cliente recibe dos mensajes**: que su pedido quedó registrado —con
su número, que en contraentrega es lo único que tiene para reclamar— y el aviso de
que confirmaciones lo va a contactar. Ese segundo texto lo escribe el admin en el
panel; si está vacío, sale uno de respaldo, porque un campo sin llenar no puede
dejar al cliente sin el aviso.

### El interruptor, que va en este ticket y no después

Este es el primer camino del sistema que **escribe en un sistema externo real y
ajeno**: la tienda del cliente. Así que estrena su modo seco, y **arranca
apagado**.

Con el modo seco puesto se hace todo salvo escribir: se resuelve la tienda, se
arma el pedido completo, se comprueba en lectura si ya existe, y queda registrado
en el log qué habría salido. **Ni una escritura.** Y al cliente **no se le dice
que su pedido quedó registrado**, porque no quedó — mentirle sería el mismo fallo
silencioso que este ticket existe para evitar, solo que al revés.

Se enciende con una variable del worker, no desde el panel: encender la escritura
sobre la tienda de un cliente pide un despliegue, no un clic. Y solo la enciende
el valor exacto `live` — `true`, `1` y `on` **no** encienden, porque un valor que
el sistema no entiende no puede habilitar escrituras sobre una tienda viva.

## Answer · el eslabón que faltaba (ola 4)

**El vendedor ya tiene cómo entregar los datos del cliente, y con eso el cierre
se dispara.** Era lo único que faltaba y resultó ser, como decía la sesión
anterior, **una llamada y no un módulo**.

### Cómo pide los datos, y por qué así

Sebastián los pide **hablando**, dentro del mismo chat: nombre y apellido,
teléfono, departamento y municipio, y la dirección exacta — o que reclama en
oficina. Todo en un solo mensaje. Cuando los tiene, registra el pedido él mismo
sin salir de la conversación. No hay formulario, ni enlace, ni link de pago.

Había dos formas de sacarle datos ordenados a un modelo: darle una herramienta,
o pedirle un bloque de texto con un formato y leerlo. **Se eligió la
herramienta, y se eligió midiendo.** El proyecto tenía un antecedente que
obligaba a desconfiar: `reasoning_effort` es un campo que se guarda, se lee, se
pasa al proveedor y **no hace nada**, porque el SDK lo descarta por el camino —
y nadie lo notó hasta que alguien fue a mirar. El mapa además decía que el
agente corre hoy **sin herramientas**, así que este sería el primero en usarlas.

Así que antes de construir nada se hizo la llamada de verdad: el modelo de
producción, el mismo cliente que usa el worker, una herramienta de prueba.
**Funcionó**: la herramienta llegó, el modelo la llamó con los campos
completos, y contestó después con el resultado en la mano. Cero advertencias. Se
comprobó además en el código del proveedor que las herramientas viajan en la
petición —están en la misma lista de campos que descarta `reasoning_effort`—,
así que no fue la suerte de una corrida. El plan B quedó descartado con un
resultado, no con una intuición.

### Lo que el vendedor no puede escribir, y es lo más importante de todo

**El precio no lo pone él. Ni el precio, ni qué variante es.** Lo único que
entrega son las palabras del cliente; el precio y la presentación salen de la
tienda en el momento, igual que la ficha del producto. No es una instrucción que
se le da y ojalá cumpla: **no existe el campo donde escribirlos.**

La razón es que en contraentrega un precio equivocado no se descubre al cobrar
— se descubre con el repartidor en la puerta, pidiendo una cifra que el cliente
nunca aceptó. Ese es el momento en que se pierde el pedido, el envío y el
cliente de una vez.

Por lo mismo **la cantidad tiene techo**. Veinte unidades es holgado para el
negocio de verdad y angosto para el error que importa: un cero de más. Pasado el
techo el pedido **no se rechaza** —podría ser un mayorista real— sino que pasa a
un asesor.

### Lo que se midió que pasa, y por lo que hubo que cambiar el turno

Al probarlo con el modelo de producción apareció algo que no estaba en el
ticket y que valía todo el ejercicio: **después de registrar el pedido, el
modelo escribe por su cuenta «tu pedido quedó registrado correctamente».**

Eso es cierto cuando el pedido se creó. Cuando el modo seco está puesto, o
cuando la tienda no contestó y el cierre quedó en la cola, **es mentira** — y es
exactamente el fallo que este ticket existe para evitar, solo que al revés: el
cliente se va tranquilo con un pedido que nadie creó.

La regla que quedó es simple: **en un turno donde el cierre habló, el modelo no
habla.** El cierre ya sabe decirle al cliente lo que hay que decirle —qué dato
falta, que su pedido quedó con tal número, que lo pasan con un asesor— y esos
son los mensajes que salen. El texto que el modelo redacte encima **se
descarta**. No se le pide que no mienta: no se le manda.

Y cuando el cierre calla a propósito —modo seco, o pedido en cola— el turno
tampoco puede quedarse mudo, porque el cliente acaba de dictar su dirección. Sale
un texto fijo que dice lo único cierto en los dos casos: **que sus datos están y
que un asesor le confirma.** No dice que el pedido quedó registrado, y no promete
cuándo.

### Cuándo puede cerrar, y cuándo ni se le ofrece

La herramienta aparece **solo cuando la conversación tiene producto
identificado**. Sin producto no hay nada que vender, y lo que corresponde es que
pregunte cuál es —que ya lo hace— y no que intente registrar un pedido que solo
podría terminar en un asesor. Prometerle una forma de cerrar que no puede usar es
el mismo error que anunciarle al cliente unas fotos que nadie va a mandarle.

Con dos presentaciones y el cliente sin decir cuál, **no se elige por él**: se le
pregunta. «La más parecida» entre dos presentaciones del mismo producto es
exactamente cómo se despacha la equivocada.

### Lo que se probó, y con qué

Tres conversaciones contra el modelo de producción, con el prompt real:

| Lo que dijo el cliente | Qué hizo Sebastián |
| -- | -- |
| Todos sus datos, «2 del de 250 g» | Registró el pedido con los datos exactos. No inventó nada. |
| «Soy Ana, vivo en Mixco, quiero 1» | **No registró.** Pidió apellido, teléfono, departamento y dirección, todo junto. |
| Todos sus datos, sin decir presentación | Preguntó «¿250 g o 500 g?» antes de registrar. |

### Qué falta

- [ ] **Las credenciales de la tienda** (ticket 01) y la prueba contra un pedido
      desechable. Sin eso, un cierre hoy termina en «la tienda no está conectada»
      — que es un estado con pantalla y con alerta, no un error crudo.
- [ ] **La forma exacta del pedido no se pudo verificar contra una tienda real.**
      Dos decisiones concretas hay que mirar con los ojos en el pedido desechable:
      cómo se mueve el inventario, y que el pedido sin cliente de la tienda traiga
      lo que el flujo de confirmación necesita. Están anotadas en
      `permisos-de-la-tienda.md`.
- [ ] **Falta cargar el catálogo.** Medido el 18-ago contra producción:
      `products` tiene **cero filas**, así que hoy ninguna conversación tiene
      producto identificado y la herramienta del cierre **no se le ofrece a
      Sebastián ni una vez**. No es un problema del cierre — es que todavía no
      hay nada que vender registrado.
- [ ] **Un producto «nativo» no se puede cerrar.** Los productos que el panel
      crea a mano no tienen precio (esa columna no existe), y sin precio no hay
      línea de pedido. Hoy eso pasa a un asesor, que es lo correcto, pero
      conviene saberlo antes de cargar el catálogo a mano: **para vender, el
      producto tiene que estar conectado a la tienda.**

### Una nota sobre un criterio del encargo

El encargo pedía que «falta la dirección → escala a humano». **El sistema hace
otra cosa a propósito, y es mejor**: si falta la dirección, o el municipio no
existe, **se le pregunta al cliente en el momento** y todo junto. Escalar se
reserva para lo que el cliente *no puede arreglar* —que no haya producto, que el
país no tenga listas, que la tienda no dé precio—, porque pedirle que corrija un
error del sistema lo deja intentando algo imposible. Es la distinción que la ola
3 dejó construida y no se tocó.
