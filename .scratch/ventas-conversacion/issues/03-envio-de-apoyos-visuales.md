# 03 — Envía los apoyos visuales

**What to build:** Durante la conversación, Sebastián manda las fotos y videos del producto para que el lead decida con más confianza. Solo manda lo que el admin autorizó, y un archivo demasiado pesado no rompe la conversación.

**Blocked by:** 02

**Status:** resolved — ola del 18-ago (3), rama `danielmedinac22/apoyos-visuales`,
sin merge ni deploy. **No es observable en producción hasta que la operación
cargue el catálogo y configure al vendedor**, y las dos cosas son actos del dueño
de la operación, no trabajo pendiente.

- [x] Solo se envían archivos marcados como enviables para el producto identificado.
- [x] Los archivos no marcados nunca se envían, aunque estén cargados.
- [x] Un video que excede el límite de tamaño de la API de WhatsApp no se envía y la conversación continúa con normalidad.
- [x] El envío queda registrado en el hilo como cualquier otro mensaje saliente.
- [x] Un fallo de envío de un archivo no interrumpe la venta ni deja al lead sin respuesta.

## Answer — el lead decide con lo que ve (18-ago-2026)

Cuando Sebastián contesta y la conversación ya sabe de qué producto habla, los
archivos que el admin marcó como enviables **salen detrás de su respuesta**, por
la misma cola que manda todo lo demás. El admin no aprende nada nuevo: sigue
subiendo archivos a la ficha del producto y sigue marcando cuáles se pueden
mandar. Lo que cambió es que ahora esa marca tiene consecuencia.

### Cómo se comporta, visto desde la operación

**Salen tres por turno, y el resto en los turnos siguientes.** Un producto con
cuatro archivos marcados no le dispara cuatro mensajes al lead apenas dice
«hola»: manda tres, y el cuarto sale cuando Sebastián vuelve a contestar. Seis
mensajes seguidos no es mostrar el producto, es una ráfaga — y lo que sobra del
turno **queda pendiente, no se descarta**.

**Cada archivo sale una sola vez por conversación.** Un lead que pregunta cinco
veces no recibe las mismas fotos cinco veces. Lo que lo recuerda no es una
columna nueva ni un estado en memoria: es el mismo outbox donde vive el envío,
con la llave `apoyo:<conversación>:<archivo>` bajo índice único. Dos turnos que
se crucen no pueden mandar la misma foto dos veces, porque el segundo no es un
mensaje repetido — es una fila que la base no deja insertar.

**Desmarcar un archivo lo saca del envío desde la conversación siguiente, sin
reiniciar ni desplegar nada.** La lista se lee entera en cada turno, sin caché.
Y si el admin lo apaga **mientras el archivo ya está en la cola**, tampoco sale:
la marca se vuelve a preguntar en el momento de mandar, y el hilo dice por qué no
salió con el nombre del archivo.

**Un archivo que no cabe en WhatsApp no se manda y no rompe nada.** El rechazo
por tamaño sigue ocurriendo al subir, que es cuando el admin puede recomprimir;
esto es la última pregunta antes de enviar, para el día en que Meta baje un
límite y filas ya guardadas dejen de caber sin que nadie las toque. Los demás
archivos del producto salen igual.

**Un archivo que falla no cuesta la respuesta.** Lo primero que se encola es el
texto de Sebastián, y los archivos van después: si algo sale mal con ellos, el
lead se queda sin fotos, nunca sin respuesta. Cada archivo es un envío
independiente con sus propios reintentos — uno que muere no arrastra a los otros
ni a la conversación.

**Un archivo de otra operación no se puede mandar, ni por error de código.** El
archivo se busca siempre dentro de la operación del mensaje, así que uno de la
operación vecina sencillamente no existe para esa consulta.

**Sebastián sabe qué está recibiendo el lead.** Su prompt lleva la lista de los
archivos que salen, con instrucción de no prometer ninguno que no esté ahí ni
ofrecer enlaces. Sin eso pasaba una de dos: ofrecía fotos que no existen, o se
quedaba callado mientras al cliente le llegaban tres.

### La decisión que el encargo pedía: subir una vez o subir siempre

**Se sube una vez y se reutiliza el identificador.** Kapso no es una API propia
sobre WhatsApp: es un proxy del Cloud API de Meta, y lo que viaja es el JSON de
Meta tal cual —verificado en el código que ya está en producción y en la
referencia de la API del proyecto—. Subir devuelve un id y los envíos lo aceptan;
es exactamente lo que la nota de voz ya hace desde hace meses, y la columna
`meta_media_id` de `product_media` existía desde la migración `0025` esperando
esto.

Importa porque el catálogo se repite: **el 77% del volumen es un solo producto**.
Sin reutilizar, un video de 16 MB se vuelve a subir en cada conversación.

**Y se borra solo cuando deja de servir.** El id tiene dos vencimientos: Meta lo
conserva alrededor de 30 días, y está atado al número que lo subió —si la
operación cambia de número, el guardado deja de valer—. Cuando un envío con id
guardado es rechazado por eso, el id se tira y el reintento vuelve a subir el
archivo. Sin esa mitad, la caché sería una trampa permanente para el archivo que
la tuvo.

### Lo que se descartó, y por qué

- **Que el modelo decidiera cuándo mandar cada archivo.** Habría hecho falta
  darle herramientas al agente —que hoy no tiene ninguna— y el resultado sería
  que mandar una foto dependa de que el modelo se acuerde. La regla es del
  sistema: si el admin autorizó el archivo y el producto está identificado, sale.
- **Mandar los archivos con pie de foto.** El texto del vendedor ya sale como
  mensaje aparte; repetirlo como pie lo mandaría dos veces cuando los dos salen,
  y a medias cuando uno falla.
- **Rechazar formatos que Meta no acepta —un `.webp`, un `.mov`— al subir.** Es
  un cambio al criterio de la pantalla de catálogo, que ya está cerrado y en
  producción, y no es lo que este ticket pide. Hoy ese archivo se sube, se puede
  marcar, y al mandarlo falla: el envío muere visible en el hilo y la
  conversación sigue. **Queda anotado como candidato**, no como pendiente de este
  ticket.

### Lo que el asesor ve en el hilo, dicho sin adornos

El mensaje queda registrado como cualquier otro saliente —con su estado de
entrega y sus chulos—, y la burbuja dice **«📷 antes-despues.jpg»**: el nombre
del archivo, no la imagen. El panel no tiene hoy por dónde servir los bytes de un
archivo de catálogo, y fabricar un enlace roto sería peor que no ponerlo. Ver el
archivo se ve en la ficha del producto, que es donde vive. Mostrarlo dentro del
hilo es una pantalla más, y es de otro dueño.

### Cómo verificarlo sin tocar producción

`scripts/apoyos-visuales-ensayo.ts` corre el camino real contra una base de
ensayo —se niega a correr contra producción— y muestra, en un Postgres de
verdad: qué sale y qué no por producto, el archivo que se pasó del límite después
de subido, los turnos repartiendo tres y uno, las filas que quedan en el outbox
con sus llaves distintas, el bloque que recibe Sebastián, el archivo de la
operación vecina que no existe desde acá, y el archivo desmarcado que deja de
salir en la conversación siguiente. **No manda nada**: encolar deja una fila, y
sin worker levantado nadie la consume.
