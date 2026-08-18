# 01 — Configuración del vendedor

**What to build:** El admin edita quién es el vendedor y cómo se comporta, sin pedirle nada al equipo técnico: su nombre, sus mensajes base, su tono y hasta qué descuento puede dar. Los cambios aplican en la siguiente conversación, sin desplegar.

**Blocked by:** ventas-conversacion 01 · Sebastián responde con su persona

**Status:** claimed — worktree `vendedor-config`, ola del 18-ago-2026

- [ ] Campos estructurados para nombre visible, mensajes base (saludo, empuje al cierre, mensaje de embudo) y límite de descuento.
- [ ] Campo de texto libre para tono e instrucciones de personalidad.
- [ ] El límite de descuento acepta cero, y ponerlo en cero prohíbe descuentos.
- [ ] Un cambio guardado aplica en la siguiente conversación, sin reinicio ni despliegue.
- [ ] **El panel no expone ninguna perilla sobre la cascada de reconocimiento**: ni activar niveles, ni reordenarlos, ni ajustar umbrales.
- [ ] La configuración de Katherine no es alcanzable ni editable desde esta pantalla.

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
