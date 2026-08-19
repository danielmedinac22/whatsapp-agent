# 05 — Un lead nuevo no llega al agente: el guardia de `agent_mode`

**What to build:** Que un lead que escribe por primera vez reciba respuesta de Sebastián. Hoy no la recibe, y no por falta de vendedor: **el pipeline no llama al agente para un contacto nuevo.**

**Blocked by:** None — pero toca el camino que hoy factura.

**Status:** resolved — ola del 18-ago (2), mergeado y desplegado. **No es observable en producción hasta que la operación tenga vendedor configurado**, y eso es un acto del dueño de la operación, no trabajo pendiente
`danielmedinac22/lead-nuevo`, sin merge ni deploy. La regla no se ve en
producción hasta que la operación tenga vendedor configurado, y eso es un acto
del dueño de la operación. Ola del 18-ago (2)

## Lo medido

En `apps/worker/src/inbound/pipeline.ts`, el runner solo se invoca así:

```ts
if (!acked && contact.agentMode) {
  onAgentInbound({ contact, conversation: conv, body: parsed.text, owner: ownership?.owner.agent });
}
```

Y `contacts.agent_mode` **tiene `false` por defecto**. Solo pasa a `true` cuando la confirmación empieza a hablar — `followup`, `confirmation-ack`, `remarketing`—, es decir **después de que existe un pedido**.

Consecuencia: un lead que hace clic en un anuncio y escribe «hola» tiene `agent_mode = false`, así que **el pipeline nunca llama al agente** y Sebastián no contesta, por bien configurado que esté. Todo lo demás del camino de venta está construido y probado: la referencia del anuncio se captura, el producto se reconoce, el dueño se deriva y el runner ramifica correctamente cuando el dueño es el vendedor.

**Es una sola condición, y es la última.**

## Por qué es una decisión y no un arreglo

`agent_mode` es el interruptor que hoy separa «el agente contesta» de «responde un humano», y el panel lo muestra como **Agente: ON / OFF** por contacto. Tocarlo cambia el camino que hoy factura:

- Si el guardia pasa a `contact.agentMode || esLeadDeVenta`, un contacto que un asesor apagó a mano podría volver a recibir respuestas automáticas si más tarde hace clic en un anuncio. Puede ser lo correcto —es intención de compra nueva— o puede ser exactamente lo que el asesor quiso evitar.
- Si en cambio se enciende `agent_mode` al crear un contacto con atribución de anuncio, hay que decidir qué pasa cuando ese lead compra y pasa a postventa.

Ninguna de las dos es obviamente correcta, y las dos tocan el R1/R8 del [no-regresión](../panel-de-ventas/no-regresion.md).

## Lo que ya quedó hecho

El dueño **sí se pasa al runner** desde el 18-ago-2026; antes se derivaba y solo se registraba en el log. Ese cableado es seguro y no cambió el comportamiento de Guatemala: con `sales_agent_settings` vacía, el dueño resuelto es siempre `confirmacion`.

## Criterios

- [x] Se decide, con el usuario, cómo entra un lead nuevo al agente sin alterar el comportamiento de los contactos que ya existen.
- [x] Un contacto al que un asesor apagó el agente a mano **no** vuelve a automatizarse sin que alguien lo decida.
- [x] La operación de Guatemala no cambia mientras no haya vendedor configurado.
- [x] Hay test que fija la regla elegida.

## Answer — el contacto nuevo nace con el agente encendido (18-ago-2026)

**Decidido por el usuario:** «si un contacto nuevo escribe, inicie con Sebastián
encendido». Se descartaron las dos opciones que este ticket planteaba.

### La regla

Al **crear** el contacto —primer mensaje entrante de un número desconocido—,
`agent_mode` nace en `true` **si la operación tiene vendedor configurado**. Si no
lo tiene, nace en `false`, como hoy.

El guardia de `pipeline.ts:423` **no se toca**. Sigue siendo
`if (!acked && contact.agentMode)`.

### Por qué esta forma no necesita la columna que se propuso

La alternativa que se le recomendó al usuario era distinguir «nadie decidió
nunca» de «un humano lo apagó», con una columna nueva, porque el guardia
`agentMode || dueño es ventas` habría resucitado a un contacto que un asesor
silenció.

**Su respuesta disuelve el problema en vez de resolverlo.** «Contacto nuevo» es
un **momento**, no un estado: ocurre una sola vez, al crear la fila, y no vuelve
a ocurrir nunca. Un asesor que apaga el agente queda protegido sin necesidad de
guardar nada — ese contacto ya no es nuevo, y ninguna regla lo vuelve a
encender, ni siquiera si más tarde hace clic en otro anuncio.

**El criterio 2 de este ticket se cumple solo.** Y no hay migración.

### El guardia de no-regresión, y por qué es obligatorio

Sin la condición del vendedor configurado, la regla **sí cambiaría a Guatemala**.
Encadenado, hoy:

- `resolveInbox` (`inbox/resolve.ts:241`) manda a **ventas** toda conversación
  sin pedido — regla `no_order`.
- `resolveConversationOwner` devuelve **`confirmacion`** siempre que no haya
  vendedor configurado — regla `no_sales_agent`.

Así que un contacto nuevo con el agente encendido y sin vendedor configurado
sería **Katherine contestándole a un desconocido**, y hoy esos contactos no
reciben nada. Medido el 18-ago-2026: **109 contactos con el agente apagado y sin
ningún pedido** están en esa situación exacta.

Con el guardia puesto, hoy no cambia absolutamente nada: `sales_agent_settings`
tiene **0 filas**, así que ningún contacto nuevo nace encendido hasta que alguien
configure a Sebastián. Es el criterio 3 del ticket, y es el mismo interruptor de
no-regresión que ya usa `resolveConversationOwner`.

### Lo medido (18-ago-2026, producción)

| Dato | Valor |
| -- | -- |
| contactos con `agent_mode = true` | 1.547 |
| contactos con `agent_mode = false` | 179 |
| **contactos con el agente apagado y sin pedido** | **109** |
| `sales_agent_settings` | 0 filas |

Los 1.547 encendidos lo están porque pasaron por un pedido: `agent_mode` solo se
enciende hoy desde `followup`, `confirmation-ack` y `remarketing`, y los tres
corren **después** de que existe el pedido. Esa es la causa de que la venta no
funcione — en venta la persona escribe **primero**, cuando todavía no hay pedido,
así que nadie encendió el interruptor y **al agente no se le pregunta**.

### Lo que queda por resolver al construir, y no es una decisión nueva

**Un contacto también puede nacer del webhook de la tienda**, no solo de un
mensaje entrante. Hay que mirar por dónde se crean las filas de `contacts`
—`inbound/contacts.ts` tiene el `onConflictDoNothing` sobre `wa_id`— y decidir
deliberadamente si un contacto nacido de un pedido entra también encendido.

El riesgo es bajo y acotado: un contacto nacido de un pedido tiene pedido, así
que `resolveInbox` lo manda a **operaciones** y el dueño es **Katherine** — que
es quien le habla igual hoy, porque `followup` le enciende el agente a los cinco
minutos. Pero es una decisión que hay que tomar mirando el código, no de paso.

### Criterios

- [x] Se decide, con el usuario, cómo entra un lead nuevo al agente.
- [x] Un contacto al que un asesor apagó el agente a mano **no** vuelve a
      automatizarse. *Se cumple por construcción: solo se enciende al crear.*
- [x] La operación de Guatemala no cambia mientras no haya vendedor configurado.
- [x] Hay test que fija la regla elegida, incluido el caso «sin vendedor
      configurado, el contacto nuevo nace apagado».

## Answer — construido (18-ago-2026)

### Qué se construyó

El nacimiento del contacto ahora es una **decisión escrita**, no un valor por
defecto de la base. Hay una función pura —`inbound/agent-mode.ts`— que recibe de
dónde viene el contacto y, si viene de un mensaje entrante, si la operación tiene
vendedor configurado; devuelve con qué `agent_mode` nace la fila y **por qué
regla**, con el mismo vocabulario que ya usan el ruteo de bandeja y el dueño de
conversación:

| Nace de | Vendedor configurado | Nace | Regla |
| -- | -- | -- | -- |
| un mensaje entrante | no | **apagado** | `no_sales_agent` |
| un mensaje entrante | sí | **encendido** | `new_lead` |
| un pedido de la tienda | *no se pregunta* | **apagado** | `born_from_order` |

El pipeline resuelve el vendedor **una sola vez**, antes de crear el contacto, y
se lo pasa hecho tanto al nacimiento como al dueño de la conversación — donde
antes se leía dos veces para responder lo mismo. Esa lectura **no puede tumbar el
mensaje del cliente**: si falla, queda un error en el log y el contacto nace
apagado, que es el comportamiento de siempre.

**El guardia de `pipeline.ts` no se tocó.** Sigue siendo
`if (!acked && contact.agentMode)`, en la misma línea y con la misma forma.

**Un contacto que ya existe quedó fuera de alcance por tipo, no por disciplina.**
El camino que actualiza un contacto existente ahora devuelve un parche cuyo tipo
solo admite el nombre: escribirle `agent_mode` a una fila que ya existía no es
algo que alguien deba acordarse de no hacer — no se puede escribir. Eso incluye
el contacto viejo de Baileys que se reencuentra por teléfono: se le estampa el
identificador y nada más.

### Qué se decidió sobre el contacto nacido de un pedido

**Nace apagado, como hoy.** Mirando el código, encenderlo no le daría nada al
negocio y le quitaría un control que hoy existe:

- **No escribió.** Un contacto que nace del webhook de la tienda no dijo nada;
  no hay nada que contestarle. Lo que este ticket vino a arreglar es al que
  escribe primero.
- **Ese interruptor ya tiene dueño.** A un contacto con pedido lo enciende el
  seguimiento al mandar la plantilla, y el acuse de confirmación al acusar —este
  último **solo si el admin dejó prendida la perilla «activar agente al
  confirmar»**, que existe en el panel. Nacer encendido pasaría por encima de esa
  perilla: un admin que la apagó vería al agente contestar igual desde el segundo
  mensaje del cliente.
- **El dueño de esa conversación es Katherine de todas formas**, porque tiene
  pedido. Encenderlo antes solo adelanta el momento, no cambia quién habla.

Además, el tipo de la decisión **no deja** pasarle la configuración del vendedor
al camino de la tienda: por ahí entran los pedidos que facturan, y no gana ni una
lectura de más ni puede ganarla por descuido.

### Con qué test queda fijada

`inbound/agent-mode.test.ts` — catorce casos sobre la cadena real encadenada como
la encadena el pipeline: nacimiento → bandeja → dueño → guardia. Prueba **quién
le contesta al cliente**, que es lo que se puede observar, no la mecánica:

- **Sin vendedor configurado**, el contacto nuevo nace apagado y **no le contesta
  nadie** — escriba de la nada o llegue desde un anuncio. Y el contacto de
  siempre, con pedido y el agente encendido, sigue siendo de Katherine.
- **Con vendedor configurado**, el contacto nuevo nace encendido y **le contesta
  el vendedor desde el primer mensaje**.
- **Un asesor que apagó el agente no lo ve volver**, ni con un clic de anuncio
  nuevo: la bandeja y el dueño dicen «ventas» y aun así no le contesta nadie.
- **Un contacto que ya existe** solo recibe nombre, nunca `agent_mode`.
- **Un contacto nacido de un pedido** nace apagado.

Los tres cambios posibles de la regla —quitar el guardia del vendedor, encender
al nacido de un pedido, dejar el lead apagado— se probaron a mano contra la
suite: los tres la ponen en rojo, cada uno en los casos que le tocan.

`pnpm -r typecheck` limpio en los cuatro paquetes; `pnpm --filter @wa/worker
test`, **437 pruebas en 28 archivos**, todas verdes (eran 423 en 27).

### Qué falta para que esto se vea en producción

**Nada de esto es observable hoy, y es a propósito.** Medido contra producción el
18-ago-2026 al terminar, solo lectura: `sales_agent_settings` tiene **0 filas**
—ninguna con nombre visible—, hay **una sola operación** (Guatemala) y 108
contactos con el agente apagado y sin ningún pedido, que son la forma exacta del
problema. (Eran 109 al decidir la regla, esa misma mañana: el número se mueve con
el tráfico y ninguna de las dos lecturas escribió nada.)

Con esa tabla vacía, la regla responde «apagado» siempre: el comportamiento de
Guatemala es **idéntico** al de antes de este cambio, hasta en el volumen del
log. Para que un lead nuevo reciba respuesta hacen falta dos cosas, y ninguna es
código:

1. Que **el dueño de la operación configure al vendedor** en el panel — como
   mínimo su **nombre visible**, que es el listón. Es el acto que enciende todo
   el camino de ventas, no solo esto.
2. Que ese vendedor esté configurado **en la operación correcta**. Hoy la única
   operación es Guatemala, y ponerle vendedor a Guatemala es ponerle vendedor al
   número que factura: es la decisión que la colombiana existe para no tener que
   tomar.

Mientras tanto el ticket **no es `resolved`**: el código está, el lead llegará al
agente, y **nadie lo va a ver** hasta que ese acto ocurra.
