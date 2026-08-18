# 03 — Anuncios y assets enviables por producto

**What to build:** Por cada producto, el admin pega los identificadores de sus anuncios y marca qué archivos puede enviar el vendedor. Registrar una campaña nueva tiene que tomar segundos, porque es trabajo recurrente del cliente: cada vez que lanza un anuncio, vuelve acá.

**Blocked by:** 02

**Status:** claimed — worktree `catalogo`, ola del 18-ago-2026

- [ ] El admin pega un identificador de anuncio en un solo campo y lo asocia a uno o varios productos.
- [ ] Un mismo anuncio puede quedar asociado a varios productos, y se ve claramente a cuáles.
- [ ] El admin marca por archivo si es enviable, y solo esos llegan al cliente.
- [ ] Un archivo desmarcado deja de enviarse desde la siguiente conversación.
- [ ] **La interacción de registrar un anuncio nuevo es de segundos, no de minutos** — es la que determina cuánto soporte recurrente genera el módulo después de entregado.

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
