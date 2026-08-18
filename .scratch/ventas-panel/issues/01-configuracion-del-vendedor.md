# 01 — Configuración del vendedor

**What to build:** El admin edita quién es el vendedor y cómo se comporta, sin pedirle nada al equipo técnico: su nombre, sus mensajes base, su tono y hasta qué descuento puede dar. Los cambios aplican en la siguiente conversación, sin desplegar.

**Blocked by:** ventas-conversacion 01 · Sebastián responde con su persona

**Status:** listo para cerrar — worktree `assets-0025`, ola del 18-ago (2). El borde del límite entró con la migración `0025`, que está **generada y sin aplicar**

- [x] Campos estructurados para nombre visible, mensajes base (saludo, empuje al cierre, mensaje de embudo) y límite de descuento.
- [x] Campo de texto libre para tono e instrucciones de personalidad.
- [x] El límite de descuento acepta cero, y ponerlo en cero prohíbe descuentos.
- [x] Un cambio guardado aplica en la siguiente conversación, sin reinicio ni despliegue.
- [x] **El panel no expone ninguna perilla sobre la cascada de reconocimiento**: ni activar niveles, ni reordenarlos, ni ajustar umbrales.
- [x] La configuración de Katherine no es alcanzable ni editable desde esta pantalla.
- [x] El límite declara su consecuencia: qué hace el vendedor cuando el cliente pide más descuento del autorizado. *(columna `discount_limit_behavior`, migración `0025`)*

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

---

## Answer — el borde del límite, cerrado (18-ago-2026, worktree `assets-0025`)

### Lo que ahora se puede configurar

Debajo del límite, en la misma tarjeta ámbar y sin pestaña nueva, la pantalla
pregunta lo que faltaba: **qué hace Sebastián cuando el cliente pide más de lo
autorizado.** Tres opciones excluyentes, en orden de más cauto a menos:
*consultar con una persona*, *ofrecer el máximo y cerrar*, *no mencionar
descuentos*.

**La pregunta se reformula sola con el límite en cero.** Deja de decir «cuando
el cliente pida más de 10%» y pasa a decir «cuando el cliente insista con un
descuento», porque prohibir descuentos no evita que se los pidan: solo cambia
qué significa pasarse. El bloque no desaparece en cero, que era la alternativa
fácil y la equivocada — el borde con descuentos prohibidos es justamente el caso
que más se va a dar.

El tratamiento del número no cambió: **en cero va en verde**, y el resto en
ámbar. Prohibir descuentos es el estado seguro, no el alarmante.

### El default es «consultar con una persona», y esa es la decisión que se pedía

La columna nace en `consultar`. La razón no es que sea la más común sino **qué
pasa con una fila a medio llenar**: la tabla la llena el panel de a poco, así
que el valor tiene que ser seguro sin que nadie lo elija.

De las tres, escalar es la única cuyo error **lo ve una persona**. `ofrecer_maximo`
decide sola y gasta margen — y con un límite alto convierte el techo en piso: el
que pida, recibe. `no_mencionar` decide sola y no gasta nada, pero cierra la
puerta en silencio y nadie se entera de que se perdió la venta. Escalar de más
cuesta atención, que se nota y se corrige; los otros dos fallan callados, que es
la clase de error que este proyecto ya decidió no aceptar por defecto.

Y hay una segunda razón, más fuerte: **es la única que coincide con lo que el
sistema ya hace donde el límite se hace cumplir de verdad.** `sales/order.ts`
recorta el descuento pasado y lo señala «para que el orquestador escale el caso a
un asesor». Poner `ofrecer_maximo` de default dejaría al prompt instruyendo lo
contrario de lo que después va a pasar al armar el pedido.

### Lo que la pantalla no promete, y por qué está escrito ahí

El prototipo describía *consultar* como «escala el chat». **No se copió esa
frase**, y conviene saber por qué: escalar es un acto del sistema
—`agent/escalation.ts`, con su cambio de `agent_mode`, su aviso al cliente y su
alerta al admin— y hoy **nadie lo dispara desde acá**. `escalation-triggers.ts`
decide mirando los turnos del *lead*, y deja el descuento fuera a propósito:
«escalarlo desde la conversación sería adivinar por el texto lo que el
constructor de orden sabe de cierto». Es una decisión del ticket 04 que sigue en
pie y no se tocó.

Así que hoy *consultar* significa: Sebastián deja de negociar, **no concede nada**
y dice que lo consulta. El traspaso a una persona ocurre por los caminos que ya
existen — el cliente pide un humano, o el pedido se arma y `order.ts` recorta y
avisa. La tarjeta lo dice con esas palabras, y debajo del bloque hay una línea
que lo cierra: *«Las tres viajan como instrucción al vendedor. El límite se hace
cumplir al armar el pedido, no en medio del chat.»*

Es la misma advertencia que este ticket ya traía para el límite —«hoy el límite
viaja en las instrucciones del vendedor, no en un candado»—, ahora también en la
pantalla y no solo en el reporte.

### Guatemala sigue igual, y se puede comprobar

La columna entra con `DEFAULT 'consultar' NOT NULL` sobre una tabla de **cero
filas** (medido contra producción antes de generar). La migración **no crea
ninguna fila**, así que `sales_agent_settings` sigue vacía y toda conversación
sigue resolviendo al agente de confirmación: Katherine sigue atendiendo
Guatemala.

Comprobado contra una base de ensayo: insertar una fila con solo la operación
—lo que hace el panel guardado a medio llenar— deja `límite=0`,
`borde=consultar`, `nombre=""`. El listón de `isSalesAgentConfigured` sigue
siendo el nombre visible, y sigue apagado. **El borde nuevo no mueve ese listón
ni le agrega una segunda opinión.**

### Cómo se verificó

- `pnpm -r typecheck` limpio en los cuatro paquetes. El tipado estricto encontró
  solo el call site real —`agent/runner.ts`, donde la fila se convierte en
  persona— y ahí se agregó la única conversión de `text` al conjunto cerrado.
- `pnpm --filter @wa/worker test`: **447 verdes** (423 antes; 24 nuevos). Nueve
  de los nuevos son del borde: las tres consecuencias con límite alto y con
  límite en cero, que *ofrecer el máximo* con el máximo en cero no ofrezca nada,
  y que *consultar* **no** le prometa al cliente un traspaso que nadie hará.
- La pantalla se levantó contra una base de ensayo en Docker y se leyó lo que
  renderiza: con la tabla vacía dice «Los descuentos están prohibidos» y
  «Cuando el cliente insista con un descuento».
- El `check` de la base rechaza una cuarta consecuencia inventada por otra vía.

### Lo que sigue sin estar

La vista previa del tono sigue descartada y no se reabrió. Y el límite —y ahora
su borde— siguen siendo instrucción y no candado hasta que el armado de pedidos
esté conectado a la operación.
