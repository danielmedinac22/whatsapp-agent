# 05 — Un lead nuevo no llega al agente: el guardia de `agent_mode`

**What to build:** Que un lead que escribe por primera vez reciba respuesta de Sebastián. Hoy no la recibe, y no por falta de vendedor: **el pipeline no llama al agente para un contacto nuevo.**

**Blocked by:** None — pero toca el camino que hoy factura.

**Status:** claimed — decidido con el usuario el 18-ago-2026; worktree `lead-nuevo`, ola del 18-ago (2)

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

- [ ] Se decide, con el usuario, cómo entra un lead nuevo al agente sin alterar el comportamiento de los contactos que ya existen.
- [ ] Un contacto al que un asesor apagó el agente a mano **no** vuelve a automatizarse sin que alguien lo decida.
- [ ] La operación de Guatemala no cambia mientras no haya vendedor configurado.
- [ ] Hay test que fija la regla elegida.

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
- [ ] Un contacto al que un asesor apagó el agente a mano **no** vuelve a
      automatizarse. *Se cumple por construcción: solo se enciende al crear.*
- [ ] La operación de Guatemala no cambia mientras no haya vendedor configurado.
- [ ] Hay test que fija la regla elegida, incluido el caso «sin vendedor
      configurado, el contacto nuevo nace apagado».
