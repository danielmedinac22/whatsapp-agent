# 03 — Anuncios y assets enviables por producto

**What to build:** Por cada producto, el admin pega los identificadores de sus anuncios y marca qué archivos puede enviar el vendedor. Registrar una campaña nueva tiene que tomar segundos, porque es trabajo recurrente del cliente: cada vez que lanza un anuncio, vuelve acá.

**Blocked by:** 02

**Status:** en curso — worktree `catalogo`, ola del 18-ago-2026 mergeado y desplegado. **No se cierra en esta ola**: falta la lista de anuncios leída de Meta (credencial) y los archivos enviables (migración `0025`).

- [x] El admin pega un identificador de anuncio en un solo campo y lo asocia a uno o varios productos.
- [x] Un mismo anuncio puede quedar asociado a varios productos, y se ve claramente a cuáles.
- [ ] El admin marca por archivo si es enviable, y solo esos llegan al cliente.
- [ ] Un archivo desmarcado deja de enviarse desde la siguiente conversación.
- [ ] **La interacción de registrar un anuncio nuevo es de segundos, no de minutos** *(el campo a mano lo cumple; elegir por nombre de la lista de Meta espera la credencial)* — es la que determina cuánto soporte recurrente genera el módulo después de entregado.

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
