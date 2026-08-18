# 01 — Configuración del vendedor

**What to build:** El admin edita quién es el vendedor y cómo se comporta, sin pedirle nada al equipo técnico: su nombre, sus mensajes base, su tono y hasta qué descuento puede dar. Los cambios aplican en la siguiente conversación, sin desplegar.

**Blocked by:** ventas-conversacion 01 · Sebastián responde con su persona

**Status:** claimed — worktree `assets-0025`, ola del 18-ago (2). La pantalla base ya está en producción; falta lo que esperaba la migración `0025`

- [x] Campos estructurados para nombre visible, mensajes base (saludo, empuje al cierre, mensaje de embudo) y límite de descuento.
- [x] Campo de texto libre para tono e instrucciones de personalidad.
- [x] El límite de descuento acepta cero, y ponerlo en cero prohíbe descuentos.
- [x] Un cambio guardado aplica en la siguiente conversación, sin reinicio ni despliegue.
- [x] **El panel no expone ninguna perilla sobre la cascada de reconocimiento**: ni activar niveles, ni reordenarlos, ni ajustar umbrales.
- [x] La configuración de Katherine no es alcanzable ni editable desde esta pantalla.
- [ ] El límite declara su consecuencia: qué hace el vendedor cuando el cliente pide más descuento del autorizado. **Necesita una columna nueva (`0025`): va en la ola siguiente.**

## Answer — lo que entra en esta ola, y el campo que falta (18-ago-2026)

### El seam ya existe; esto es la pantalla

`ventas-conversacion/01` dejó construido todo lo que está detrás: la tabla
`sales_agent_settings` (una fila por operación), el accesor
`getSalesAgentSettings(op)` con su función pura de aislamiento, la persona en
`apps/worker/src/sales/persona.ts` y el seam de prompt efectivo. **Este ticket no
toca nada de eso: es la pantalla que llena esa fila.**

Medido en producción el 18-ago-2026: `sales_agent_settings` = **0 filas**. La
pantalla arranca contra una tabla vacía y tiene que poder **crear** la fila, no
solo editarla.

Y eso importa más de lo que parece: **`null` en esa tabla es el interruptor de la
no-regresión.** Con la tabla vacía, toda conversación resuelve al agente de
confirmación. El listón de «hay vendedor» es `display_name` no vacío
(`isSalesAgentConfigured`), no la existencia de la fila — así que **guardar la
pantalla a medio llenar no puede encender a Sebastián sobre Guatemala.** Quien
construya debe respetar ese listón, no inventar otro.

### La forma está decidida, no se re-prototipa

`ventas-pulido-ui/02` la cerró con el usuario: **secciones apiladas, la misma
anatomía que la configuración de Katherine** — cuatro `<section class="app-card">`
como en `agent-form.tsx`, con el texto libre en tarjeta aparte como
`prompt-card.tsx`. Sin pestañas, y la razón descarta introducirlas después:
«partir una configuración en pestañas esconde la mitad de lo que se está
cambiando». Cuando la pantalla crezca, se alarga el scroll.

Tres cosas que son criterio:

1. **El límite de descuento va con borde y fondo ámbar y la etiqueta «tiene
   consecuencia»** — es el único campo del panel que gasta plata.
2. **El límite en 0 va en verde, no en ámbar.** Prohibir descuentos es el estado
   seguro, no el alarmante.
3. **Presets de tono como punto de partida editable**, nunca como opción cerrada:
   elegir uno rellena el texto y de ahí es libre.

Referencia: `ventas-pulido-ui/prototipos/nivel-2-vendedor.PROTOTIPO.html`.

### El campo que el diseño agregó y el esquema no tiene

El nivel 2 destapó que **el ticket definía el límite y nunca decía qué hace
Sebastián cuando el cliente pide más** — «un límite sin consecuencia declarada no
está definido: está numerado». El diseño lo resolvió con tres opciones:
*consultar con una persona*, *ofrecer el máximo y cerrar*, *no mencionar
descuentos*. Con el límite en 0 la pregunta cambia sola a «cuando el cliente
insista con un descuento».

**Eso es una columna que `sales_agent_settings` no tiene**, y por lo tanto una
migración. **Esta ola tiene una sola migración asignada** —la `0024`, del
worktree `selector-operacion`— porque drizzle reescribe
`migrations/meta/_journal.json` y dos ramas que generen en paralelo chocan
siempre, sin que ningún check local lo vea.

Entonces:

- **Entra en esta ola**: la pantalla completa sobre los nueve campos que ya
  existen — identidad, los tres mensajes base, tono libre con presets, límite de
  descuento con su tratamiento ámbar/verde, modelo y esfuerzo.
- **No entra**: el borde del límite. Va en la ola siguiente, con la migración
  `0025`, junto a `product_media`.
- **Este ticket no se cierra en esta ola**, y el criterio que queda sin marcar es
  ese. Lo demás sí.

### Riesgo registrado, para quien construya

Se descartó la vista previa del tono, y **era la única barrera de esta pantalla
contra que «una edición del cliente rompa al vendedor sin que nadie se entere»**.
Sin ella, el efecto de un cambio de tono solo se ve en la próxima conversación
real. No es objeción: es la decisión a revisitar si aparece un incidente así.

---

## Lo construido — worktree `vendedor-config`, 18-ago-2026

### La pantalla

`/vendedor` existe y es una sola página, sin pestañas, en el orden decidido:
**Identidad · Mensajes base · Límite de descuento · Tono e instrucciones ·
Modelo y razonamiento.** Es la anatomía de la pantalla de Katherine —secciones
apiladas con su título— porque el panel ya la tenía y heredarla es lo que hace
que esto se sienta el mismo producto y no otra aplicación.

- **Identidad** pregunta el nombre visible y muestra, sin poder editarlo, el
  número por el que sale lo que el vendedor escribe (`+502 3689 0343`), que se
  configura en Conexión.
- **Mensajes base** son los tres momentos que el negocio controla palabra por
  palabra: saludo, empuje al cierre y mensaje de embudo. Lo que se deja vacío no
  se le menciona al vendedor: un «Saludo:» sin saludo sería ruido que el modelo
  tiene que interpretar.
- **El límite de descuento** es lo único con tratamiento propio —borde y fondo
  ámbar, con la etiqueta «tiene consecuencia»—, porque es el único campo de todo
  el panel que gasta plata. **En cero, el número se pone verde**: prohibir
  descuentos no es una alarma, es el estado seguro y el valor con el que arranca.
- **El tono** tiene tres puntos de partida —Cercano, Formal, Propio— que
  **rellenan el campo y nada más**: en cuanto se edita una coma, ninguna tarjeta
  queda marcada y el texto es de quien lo escribió. Los textos de los presets
  **no nombran ningún país**, al revés del prototipo: un preset que escribe
  «guatemalteco neutro» dentro de la configuración del vendedor colombiano es la
  misma fuga entre operaciones de siempre, solo que escrita por un clic.
- **Modelo y esfuerzo de razonamiento** cierran la pantalla. Van al final y no
  al principio porque son lo menos parecido a una decisión de negocio; el orden
  de lectura de las cuatro primeras es el que se decidió y no se movió.

Guardar crea la fila si no existe —hoy la tabla está vacía— y la actualiza si ya
está. No hay dos botones ni dos estados: es la misma pantalla el primer día y el
día ciento.

### Lo que sostiene que Guatemala no cambie

**Se puede guardar la pantalla a medio llenar, y eso no enciende al vendedor.**
El nombre visible no es obligatorio a propósito: mientras esté vacío, la
conversación la sigue llevando el agente de confirmación, que es lo que pasa hoy.
Escribir un nombre es el único acto que enciende al vendedor, y el campo lo dice
en su ayuda, con esas palabras.

La pantalla **no inventa su propio criterio de «hay vendedor»**: ese listón ya
vive en el worker y es el que decide en cada mensaje quién contesta. Agregar una
segunda opinión sobre lo mismo habría sido agregar un lugar donde las dos pueden
quedar distintas.

Un nombre de puros espacios se guarda como vacío, para que la fila diga lo mismo
que la pantalla muestra.

### Un cambio guardado aplica en la próxima conversación

Y hay que decir con precisión cómo:

- **El contenido —nombre, mensajes, tono, límite, modelo— se relee entero en
  cada turno del vendedor.** No hay caché en ese camino: se guarda, y la
  siguiente respuesta ya sale con lo nuevo.
- **Encender al vendedor por primera vez puede tardar hasta medio minuto.** La
  decisión de «esta conversación la lleva el vendedor» se toma en la entrada del
  mensaje, y ahí sí hay una caché de treinta segundos por operación. No es un
  problema de esta pantalla y no hace falta reiniciar nada: es esperar.
- **Apagarlo es inmediato en lo que importa.** Aunque la entrada todavía diga
  «la lleva el vendedor», al momento de contestar se vuelve a leer sin caché, se
  ve que ya no hay vendedor configurado, y contesta el agente de confirmación.
  Ningún mensaje se queda sin respuesta en el intermedio.

### Lo que falta, y por qué

**El borde del límite** —qué hace el vendedor cuando el cliente pide más
descuento del autorizado: *consultar con una persona*, *ofrecer el máximo y
cerrar*, o *no mencionar descuentos*— **no entró y por eso este ticket queda
abierto.** Es una columna que la tabla no tiene, o sea una migración, y esta ola
tiene una sola asignada y es de otro worktree. Va en la siguiente, con la `0025`.

Mientras tanto, el campo de tono es el único lugar donde eso se puede decir —el
preset «Propio» lo dice como ejemplo— pero es una instrucción, no una regla: el
sistema no la hace cumplir.

Y algo que conviene saber antes de subir el límite de cero: **hoy el límite viaja
en las instrucciones del vendedor, no en un candado.** El recorte automático del
descuento al armar el pedido está construido y probado, pero el armado de pedidos
todavía no está conectado a la operación. Hasta que lo esté, el límite es lo que
el vendedor tiene instruido respetar, no algo que el sistema le impida pasar.

### Dos cosas para quien siga

- **La entrada de menú y el permiso de la pantalla son del worktree del
  selector.** `/vendedor` y `/api/vendedor` todavía no están clasificados en la
  tabla de accesos. Hoy no molesta —los tres usuarios de producción son admin y
  alcanzan todo—, pero el día que exista alguien con rol de ventas, la pantalla
  que es suya lo rebotaría. Las rutas se eligieron con ese prefijo justamente
  para que sean una línea allá.
- **La vista previa del tono sigue descartada, y con ella la única barrera de
  esta pantalla contra que una edición rompa al vendedor sin que nadie se
  entere.** No se reabre. Queda anotada en el reporte una barrera barata que no
  es una vista previa, sin construir.
