# 04 — Cola de reintentos y alerta ante fallo

**What to build:** Si la tienda rechaza la creación del pedido, la venta no se pierde: entra a una cola de reintentos y el equipo recibe una alerta. El cliente ya se despidió creyendo que compró, así que un fallo silencioso es peor que no vender — nadie lo descubre hasta que el cliente escribe molesto.

Es alcance contractual explícito, no mejor esfuerzo.

**Blocked by:** 03

**Status:** abierto — construido entero; **el primer despliegue destapó que la cola no llegaba a crearse**, y eso ya está arreglado. Falta verla mover un cierre de verdad

- [x] Un fallo al crear el pedido no descarta el cierre: queda encolado con sus datos completos.
- [x] La cola reintenta, y un reintento exitoso **no duplica** el pedido.
- [x] El equipo recibe alerta cuando un cierre no logra crearse. *(el teléfono de alerta está configurado — verificado en producción)*
- [ ] Un cierre en cola es visible para el equipo, con el motivo del fallo. *(la pantalla está; falta un cierre real que mirar)*
- [x] Agotados los reintentos, el caso queda marcado para intervención humana en vez de desaparecer.

## Answer · la cola (ola 3)

Construido entero, pero **no observable todavía**: hasta que el vendedor pudiera
cerrar una venta (ticket 03), no había cierres que encolar. **La ola 4 cableó el
cierre y destapó un fallo de esta cola — está más abajo.**

### Lo que hace

**Una venta cerrada que no llega a la tienda no se descarta.** Queda guardada con
sus datos completos —cliente, dirección, qué compró, cuánto— y el equipo recibe
una alerta por WhatsApp, al mismo teléfono al que ya le llegan los escalamientos.
No se inventó un segundo canal de alertas: un segundo canal es un segundo canal
que un día deja de funcionar sin que nadie lo note.

**El reintento no duplica el pedido.** Cada intento vuelve a pasar por el mismo
camino, y ese camino **busca antes de crear**. El caso feo —la tienda creó el
pedido y se cayó al contestar— encuentra el pedido en el reintento y no crea otro.

**Solo se reintenta lo que mejora reintentando.** La tienda saturada, caída o sin
respuesta: sí, con esperas cada vez más largas. Una variante que no existe, un
permiso que falta o un token revocado: **no**, porque dentro de seis intentos van
a seguir igual y lo único que se logra es que el cliente espere seis veces más
antes de que alguien mire. Esos casos saltan derecho a la bandeja de una persona.

Hay un detalle de esta API que estaba esperando para morder: **«bajá el ritmo»
llega con código de éxito**, dentro del cuerpo de la respuesta. Leído a la ligera
se ve como un fallo definitivo y tiraría la venta. Está contemplado.

**Agotados los reintentos, el caso no desaparece**: queda en la lista de los que
esperan a una persona, con sus datos y su motivo, y vuelve a sonar la alerta —
porque agotarse es información nueva.

**El equipo los ve.** En Conexión → Shopify hay una lista de «Cierres que no
llegaron a la tienda», partida en dos: los que el sistema sigue reintentando solo
(con qué intento va y cuándo es el próximo) y los que esperan a una persona. Cada
uno dice **por qué** falló. Vive dentro de la tarjeta de la tienda a propósito:
casi siempre el motivo es algo de la conexión, así que el sitio donde se mira es
el mismo donde se arregla.

Si no hay cierres pendientes, la lista **no se dibuja**. Una tarjeta vacía que
dice «no hay nada» ocupa el mismo espacio que una con problemas y entrena a no
mirarla.

### Una decisión que vale anotar

**No se creó tabla nueva ni migración.** La cola de trabajos que el sistema ya usa
para el seguimiento, el remarketing y el envío de mensajes guarda el cierre entero
con sus datos, sobrevive reinicios y sabe reintentar con esperas crecientes: es
exactamente lo que este ticket pedía. El esquema de esta ola tiene otro dueño, y
esto no lo necesitaba.

Los casos que esperan a una persona se guardan **un mes**, no las dos semanas por
defecto: son justamente lo que la cola existe para no perder.

## Answer · la cola no se estaba creando (ola 4)

**La cola prometida no existía en producción, y nadie se enteraba.** Lo destapó
el primer despliegue: el worker arrancó completo —seguimiento, remarketing,
envíos y los seis de logística— y **las dos colas del cierre no se crearon
ninguna de las dos**. El error quedó en una línea del log y el proceso siguió
como si nada.

Es el peor sitio posible para un fallo callado: **este ticket existe justo para
que una venta no se pierda en silencio, y lo primero que se perdía en silencio
era la cola misma.** Si eso llega vivo al día que se enciendan las ventas, el
primer cierre que falle no lo rescata nadie.

### Por qué pasaba

La base guarda «a qué cola caen los descartes» como una referencia de verdad, así
que **una cola no se puede crear apuntando a otra que todavía no existe**. Se
estaba creando primero la de reintentos, que apunta a la de descarte, que aún no
estaba. La base la rechazaba y se caían las dos.

Se comprobó contra producción, en lectura: la restricción es exactamente esa, y
hoy **no existe ninguna de las dos colas** — ni siquiera a medias. No hay nada
que reparar a mano: el próximo despliegue las crea de cero, en el orden bueno.

### Los tres arreglos, porque el orden era solo el primero

**1. Se crean en orden, y ahora el orden es un dato que un test vigila.** La
lista de colas está escrita como lista, y hay una prueba que falla si alguien las
invierte — incluida la prueba de que la prueba sirve: al invertirlas, salta.

**2. Un arranque fallido se lee como un fallo.** Antes decía «no arrancó» y ya.
Ahora dice qué queda roto y en qué se traduce para el negocio —«una venta que
falle NO se va a reintentar sola, el pedido hay que crearlo a mano»— y el proceso
lo registra como error, no como una línea más. Queda además un estado consultable
para cuando alguien se pregunte, dos semanas después, por qué una venta no se
reintentó.

**3. Y el que más importaba, que no estaba en el reporte: la alerta ya no depende
de la cola.** Antes, si la cola fallaba, el fallo se propagaba hacia arriba y se
llevaba por delante **la alerta al equipo** — o sea que el fallo de la cola se
comía justo el mecanismo que existe para que ningún fallo se coma una venta.
Ahora, si el cierre no se puede encolar, **el equipo se entera igual**, y se le
avisa por lo que realmente es: un caso que necesita una persona, no uno que el
sistema va a reintentar solo. Decirle «quedó en la cola de reintentos» cuando no
quedó sería mentirle sobre lo único que separa esa venta de perderse.

El worker no se detiene por esto, y es deliberado: tumbar el proceso dejaría a
Guatemala sin confirmar pedidos por una cola que hoy no tiene nada que mover.

### Qué se pudo verificar y qué no

**Verificado**, en lectura contra producción: la restricción que causaba el
fallo, que hoy no existe ninguna de las dos colas, que el consumidor de la cola
está enganchado al arranque del worker, y que **el teléfono al que va la alerta
está configurado** para la operación de Guatemala — o sea que la alerta tiene a
dónde llegar.

**Verificado con pruebas**: que el cierre viaja entero por la cola sin perder ni
cambiar un campo. Es lo que hace que un reintento de dentro de tres horas arme el
mismo pedido que el cliente pidió, y no hay ningún otro control que lo mire: los
datos van como texto y el tipo dice que están.

**No verificado**: que un cierre real caiga en la cola en producción. Hacerlo
pedía encolar de verdad, y eso dispara la alerta por WhatsApp a una persona real.
No se hizo. **Es la afirmación más frágil de este ticket** y se cierra sola con
la prueba de abajo.

### Qué falta

- [ ] **Verlo funcionar, una sola vez.** Ya se puede: el ticket 03 quedó
      cableado, así que cerrar una venta con la tienda desconectada encola y
      alerta por sí solo, sin romper nada. Es la prueba barata y hay que hacerla
      **después del próximo despliegue**, que es el que crea las colas.
- [ ] **Mirar la lista de «Cierres que no llegaron a la tienda»** en Conexión →
      Shopify con ese cierre dentro. La pantalla está construida; lo que no se ha
      visto nunca es con datos.
