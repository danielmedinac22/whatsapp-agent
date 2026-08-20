# 03 — Anuncios y assets enviables por producto

**What to build:** Por cada producto, el admin pega los identificadores de sus anuncios y marca qué archivos puede enviar el vendedor. Registrar una campaña nueva tiene que tomar segundos, porque es trabajo recurrente del cliente: cada vez que lanza un anuncio, vuelve acá.

**Blocked by:** 02

**Status:** la mitad de Meta está **cerrada** (19-ago-2026: llegó el token con `ads_read` y la lista está en producción). Quedan abiertos los dos criterios de archivo, que no dependen de este ticket sino de que el vendedor esté encendido

- [x] El admin pega un identificador de anuncio en un solo campo y lo asocia a uno o varios productos.
- [x] Un mismo anuncio puede quedar asociado a varios productos, y se ve claramente a cuáles.
- [ ] El admin marca por archivo si es enviable, y solo esos llegan al cliente. *(el interruptor, el conteo y la lectura que filtra, sí — migración `0025`; **el envío todavía no existe**: es `ventas-conversacion/03`)*
- [ ] Un archivo desmarcado deja de enviarse desde la siguiente conversación. *(verificado en la lectura, sin caché; de punta a punta no se puede ver hasta que haya envío)*
- [x] **La interacción de registrar un anuncio nuevo es de segundos, no de minutos** *(llegó el token: el anuncio se elige por su nombre de la lista de Meta, con el campo a mano como respaldo)* — es la que determina cuánto soporte recurrente genera el módulo después de entregado.

## Answer — el alcance sin la credencial de Meta (18-ago-2026)

### La forma está decidida, y estrena una dependencia que hoy no existe

`ventas-pulido-ui/03` la cerró con el usuario (variante F): **el anuncio se elige
por su nombre de una lista leída de la cuenta publicitaria de Meta; no se
escribe ningún identificador.** «DHT ANTICALVICIE · Video · testimonial» es un
dato de persona; `24019338702` es un dato de máquina — y con cuatro SKUs
REVITALHAIR de nombre casi idéntico, el nombre del anuncio es lo único que los
distingue al elegir. Desaparece la clase entera de error del pegado.

**Pero no hay ninguna credencial de Meta en el entorno.** Hace falta un token de
usuario de sistema con `ads_read` sobre `act_2042265076620189`, y eso lo trae
Daniel, no un agente. Hasta hoy registrar un anuncio no dependía de nadie.

### Qué se construye igual, y por qué alcanza

El propio diseño lo resuelve: **«F no reemplaza a las otras, las envuelve»** — el
campo a mano sobrevive como respaldo, y el estado «sin conectar» **va a pasar
solo** porque el token vence. Así que esta ola construye:

- La pantalla completa de anuncios por producto, con el N:M visible en los dos
  sentidos.
- **El camino de respaldo**: el campo a mano, que es el que funciona sin
  credencial.
- **El estado «cuenta publicitaria sin conectar»** como pantalla honesta y
  esperada, no como error.
- La asociación de un anuncio a **varios productos a la vez** por selección
  múltiple en la tabla — que el nivel 2 identificó como el camino más corto del
  N:M.

Queda fuera hasta que llegue el token: la lista de anuncios leída de Meta. **Y
por eso este ticket no se cierra en esta ola.**

También quedan fuera **los archivos enviables** (el interruptor por archivo, el
conteo «2 de 4 enviables»): dependen de la tabla `product_media`, que es
migración, y esta ola tiene una sola migración asignada — la `0024` del worktree
`selector-operacion`. Ver el `## Answer` de `ventas-panel/02`.

### La trampa que hay que dejar escrita, porque el diseño la esconde

**F resuelve registrar, no reconocer.** El registro llena `product_ads`; el
reconocimiento hace lo contrario — toma el `ad_id` del mensaje entrante y lo
busca ahí. Si el `referral` no llega, **el mapa queda perfecto y nunca se
consulta**, la pantalla se ve completa y correcta, y no pasa nada.

Con una bandeja de pendientes eso gritaba; con F no hay bandeja. **Elegir F hace
más urgente verificar que el referral llega, no menos.**

Medido en producción el 18-ago-2026: `conversations` = 1.714, **con `ad_id` = 0**.
La causa está identificada y no es un bug: de 500 conjuntos de la cuenta
publicitaria, 10 tienen destino WhatsApp y **ninguno apunta al número que escucha
el panel** — la pauta va a +502 4722 4176, otra WABA, y los dos números se unen
después. Queda pendiente de validación con datos reales en producción.

Por eso: **quien construya debe dejar una señal explícita de «llegaron N clics de
anuncios registrados esta semana»**. Sin ella el módulo puede estar muerto y
verse sano.

## Answer — lo construido sin la credencial (18-ago-2026, worktree `catalogo`)

### El registro funciona, por el camino de respaldo

Registrar un anuncio es: pegar el id en el campo de la ficha y Enter. Y el N:M
**se ve en los dos sentidos**:

- Desde el producto, cada anuncio compartido dice a qué otros apunta —
  `23851094999 · también apunta a REVITALHAIR – DHT BLOCKER ANTICALVICIE,
  REVITALHAIR Serum Capilar`. Verificado en pantalla contra el catálogo real
  cargado. Sin eso, desde la ficha de un producto un anuncio N:M **parece
  exclusivo**, y el N:M existiría en la base y no en la pantalla.
- Desde la tabla, la selección múltiple asocia **un anuncio a varios productos a
  la vez**. Acá no es un control genérico: es literalmente el N:M del ticket y su
  camino más corto — es como se registra un anuncio de familia o de combo sin
  inventar un producto falso.

Registrar dos veces el mismo par no es error ni duplica: el admin acaba de pegar
el mismo id. Y el pegado con espacios o saltos de línea encuentra igual su
mapeo — un id que no encuentra el suyo se ve idéntico a un anuncio sin
registrar, que es la clase de error silencioso que este módulo no puede tener.

### El estado «cuenta publicitaria sin conectar» es pantalla, no error

La ficha lo dice donde importa, junto al campo: la cuenta de Meta no está
conectada, así que el anuncio no se puede elegir por su nombre todavía, y
mientras tanto se pega el ID — **que es el mismo camino que queda cuando el token
vence**. El `## Answer` del nivel 3 ya lo había anticipado: F no reemplaza a las
otras, las envuelve, y este estado va a pasar solo.

### La señal que el nivel 3 pidió, y el fallo que destapó

Está construida y es lo primero que se ve en `/catalogo`: **«llegaron N clics de
anuncio en los últimos 7 días · M de anuncios registrados»**, con cuatro
lecturas distintas —nunca llegó una referencia, llegan clics sin registrar, el
mapa se está consultando, sin clics en la ventana— porque no significan lo mismo
ni se arreglan igual. Con el estado de producción de hoy (1.723 conversaciones,
`ad_id` = 0) la pantalla dice: *«Nunca llegó una referencia de anuncio al panel.
Registrar anuncios acá no sirve de nada hasta que la pauta apunte al número que
escucha el panel»*.

**Y la señal misma casi nace rota.** Escrita con una subconsulta correlacionada
dentro del `select`, drizzle emite las columnas sin calificar la tabla, así que
la condición se resolvía contra la propia `product_ads` y **contaba todos los
clics como reconocidos**: el número se veía sano y era falso. Lo destapó el
ensayo contra una base cargada con un clic registrado y uno que no — ni el
typecheck ni un test de función pura podían verlo. Está reescrita con `join` y
`count(distinct)`.

Que la contra-medida de «el módulo puede estar muerto y verse sano» haya podido
mentir exactamente así es la mejor evidencia de que hacía falta.

### Por qué este ticket queda abierto

Dos cosas, ninguna de código:

1. **La lista de anuncios leída de Meta** —la forma decidida, elegir por nombre—
   necesita un token de usuario de sistema con `ads_read` sobre
   `act_2042265076620189`. No hay ninguna credencial de Meta en el entorno. Lo
   trae Daniel.
2. **Los archivos enviables** (el interruptor por archivo, el conteo «2 de 4
   enviables») dependen de `product_media`, que es migración: va con la `0025` de
   la ola siguiente.

Cuando llegue el token, lo que se agrega es la lista; el campo a mano y todo el
N:M ya construido no cambian.

---

## Answer — la mitad de archivos, y por qué el ticket sigue abierto (18-ago-2026, worktree `assets-0025`)

### El interruptor existe, y arranca apagado

Cada archivo de un producto tiene el suyo, con el conteo en la cabecera de la
ficha —«2 de 3 enviables»— y en la tabla como columna. **Nace apagado y eso es la
mitad del criterio**: marcar es un acto explícito y aparte de subir, porque el
error que evita —mandarle al cliente la hoja de márgenes internos que el admin
cargó para tenerla a mano— no se deshace. El caso está sembrado en la base de
ensayo a propósito: `margen-interno.xlsx` cargado y sin marcar.

El conteo cuenta **lo que le llega al cliente**, no lo que está marcado. Un
archivo marcado que excede el límite de WhatsApp no sale, y contarlo haría que la
cabecera prometa de más.

El filtro **«Sin archivos enviables»** de la tabla mira lo mismo: un producto con
cuatro archivos, todos desmarcados, le manda al cliente exactamente lo mismo que
uno sin ninguno, y esconderlo detrás de «tiene archivos» sería un producto que se
ve completo y no manda nada.

### «Solo esos llegan al cliente» — lo que se puede afirmar hoy, y lo que no

Con precisión, porque acá es fácil sonar más terminado de lo que se está:

- **Lo que decide qué sale ya está construido y probado.**
  `listSendableProductMedia(op, productId)` filtra por operación, por producto,
  por la marca **y por el tamaño**, y **no tiene caché**. Que no la tenga es lo
  que hace verdadera la frase «desde la siguiente conversación, sin reinicio ni
  despliegue»: comprobado en un solo proceso, desmarcar un archivo lo saca de la
  lectura siguiente sin reiniciar nada.
- **Lo que manda el archivo no existe todavía.** Es `ventas-conversacion/03`
  —«Envía los apoyos visuales»—, con sus propios criterios: que quede registrado
  en el hilo y que un fallo de envío no interrumpa la venta. Ese ticket está
  `ready-for-agent` y no se tocó desde acá: meterse en `jobs/outbound.ts`, que es
  el camino por el que salen los mensajes de Guatemala, no es un efecto colateral
  aceptable de un ticket de panel.

Por eso los dos criterios de archivo quedan **sin marcar** aunque su mitad de
panel esté terminada. Marcarlos diría que un archivo autorizado le llega al
cliente, y hoy no le llega ninguno: no hay quien los mande.

**El tamaño se vuelve a preguntar en la lectura** y no solo al subir. No es
desconfianza del panel: el límite es de Meta y puede bajar, y entonces filas
guardadas como enviables dejan de serlo sin que nadie las toque. Esa es la última
pregunta antes de mandar, y está donde el que mande la va a hacer.

### La mitad de Meta sigue bloqueada, y no cambió nada

**La lista de anuncios leída de la cuenta publicitaria sigue sin construirse.**
Necesita un token de usuario de sistema con `ads_read` sobre
`act_2042265076620189`, que no existe en el entorno y lo trae el cliente. El
campo a mano —el camino de respaldo que el propio diseño dejó, «F no reemplaza a
las otras, las envuelve»— funciona y no se tocó, igual que todo el N:M en los dos
sentidos y el estado «cuenta publicitaria sin conectar».

Tampoco cambió lo que el nivel 3 dejó anotado como la trampa: **F resuelve
registrar, no reconocer.** La señal de «llegaron N clics de anuncio» sigue siendo
lo primero que se ve en `/catalogo` y sigue diciendo, con el estado de producción
de hoy, que nunca llegó una referencia de anuncio al panel.

### Qué falta para cerrarlo

Dos cosas, ninguna de esquema:

1. **El token de Meta** (`ads_read` sobre `act_2042265076620189`). Lo trae Daniel.
   Cuando llegue, lo que se agrega es la lista; el campo a mano y el N:M ya
   construido no cambian.
2. **El envío de los archivos**, que es `ventas-conversacion/03`. La lectura que
   ese ticket necesita ya está hecha y probada; lo que falta es mandar el archivo
   y registrarlo en el hilo.

---

## Answer — llegó el token, y el anuncio ya se elige por su nombre (19-ago-2026)

**La mitad de Meta está cerrada.** El token de usuario de sistema con `ads_read`
sobre `act_2042265076620189` llegó, está cargado en Railway
(`META_ADS_SYSTEM_USER_TOKEN`) y la lista se lee en producción.

### La forma decidida, funcionando

En la ficha de un producto hay un buscador que filtra **por nombre de anuncio y
por nombre de campaña a la vez**, con el estado (activo/pausado) a la vista y los
ya registrados marcados en vez de escondidos — desaparecer haría que el admin
busque un anuncio, no lo encuentre, y crea que Meta no lo devolvió.

**El campo a mano sigue abajo y no se tocó.** Es la regla del nivel 3 —«F no
reemplaza a las otras, las envuelve»— y es el camino que queda el día que
revoquen el token. La pantalla de «cuenta sin conectar» tampoco desapareció:
ahora aparece solo cuando de verdad no hay cuenta.

### El defecto que solo se vio ejecutando

La cuenta tiene **905 anuncios y 24 activos** (medido, no estimado). Con una sola
pasada con tope, el recorte pasaba **antes** del orden: un anuncio recién lanzado
podía caer en la posición 700 y la pantalla habría dicho «ningún anuncio
coincide» sobre el anuncio que la persona acaba de crear — que es literalmente el
caso para el que existe la lista.

Ahora son dos pasadas: **los activos filtrados por Meta primero, completos**, y
después el resto hasta el tope. Así el recorte solo se lleva pausados viejos. En
producción: 500 leídos, truncado, **24 activos, todos presentes y primeros**,
incluida la campaña `BERBERINE WHATSAPP CBO GTM 19 08 2026`, creada ese mismo
día.

### La cuenta publicitaria es por operación, no una constante

`operations.meta_ad_account_id` (migración `0029`), configurable en Conexión →
Meta. Elegir un anuncio colombiano de la lista de Guatemala es exactamente el
error que la migración multi-operación salió a borrar.

### Por qué el ticket no se cierra entero

Los dos criterios de archivo (`el admin marca por archivo si es enviable` y `un
archivo desmarcado deja de enviarse`) siguen sin marcar, y **no por esta ola**:
lo que decide qué sale está construido y probado, pero comprobar que «solo esos
llegan al cliente» pide una conversación real con el vendedor encendido, y
`sales_agent_settings.display_name` sigue vacío a propósito.

Y sigue en pie la trampa del nivel 3, que este ticket no puede resolver: **F
resuelve registrar, no reconocer.** La señal de «llegaron N clics de anuncio»
sigue siendo lo primero que se ve en `/catalogo`, y con `ad_id` = 0 sigue
diciendo que registrar acá no sirve de nada hasta que la pauta apunte al número
que escucha el panel.
