# 03 — Sebastián cierra y crea el pedido en la tienda

**What to build:** Una conversación que llega al cierre produce un pedido real en la tienda, con pago contraentrega y etiquetado como venta del agente. El lead da sus datos en el chat, se le avisa en el momento si algo quedó mal, y al final recibe confirmación de que su pedido quedó registrado.

**Blocked by:** 02 · ventas-conversacion 02 · Conversa con el contexto del producto

**Status:** ready-for-agent

- [ ] Sebastián pide los datos de cierre dentro de la conversación, sin formularios ni enlaces externos.
- [ ] Un dato inválido se le comunica al lead en el momento, con qué corregir.
- [ ] Con datos válidos se crea el pedido en la tienda y el lead recibe confirmación.
- [ ] **Dos disparos del mismo cierre producen un solo pedido.**
- [ ] Un descuento fuera de rango crea el pedido al precio válido y **escala el caso a un asesor**.
- [ ] El pedido queda visible en la tienda con sus etiquetas de origen.
- [ ] El lead recibe el mensaje de embudo avisando que confirmaciones lo va a contactar.

## Answer

**Status: open.** El camino del cierre a la tienda está **construido entero y
probado**, y le falta una sola cosa para poder usarse: **que el vendedor tenga
cómo entregar los datos del cliente**. Eso vive en el turno de conversación de
Sebastián (`agent/runner.ts`), que es de otro worktree, y no se tocó — el encargo
dice parar y avisar antes que meter mano en archivo ajeno.

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

### Qué falta

- [ ] **La captura de los datos en la conversación.** Es el primer criterio del
      ticket y lo único que falta. Requiere darle a Sebastián una herramienta en
      su turno (`agent/runner.ts`, worktree ajeno) que llame a `closeSale()`, que
      ya existe y recibe el contacto, la conversación y los datos del cierre.
      **Es una llamada, no un módulo.**
- [ ] **Las credenciales de la tienda** (ticket 01) y la prueba contra un pedido
      desechable. Sin eso, un cierre hoy termina en «la tienda no está conectada»
      — que es un estado con pantalla y con alerta, no un error crudo.
- [ ] **La forma exacta del pedido no se pudo verificar contra una tienda real.**
      Dos decisiones concretas hay que mirar con los ojos en el pedido desechable:
      cómo se mueve el inventario, y que el pedido sin cliente de la tienda traiga
      lo que el flujo de confirmación necesita. Están anotadas en
      `permisos-de-la-tienda.md`.
