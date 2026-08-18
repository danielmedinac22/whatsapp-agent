# 05 — Un lead nuevo no llega al agente: el guardia de `agent_mode`

**What to build:** Que un lead que escribe por primera vez reciba respuesta de Sebastián. Hoy no la recibe, y no por falta de vendedor: **el pipeline no llama al agente para un contacto nuevo.**

**Blocked by:** None — pero toca el camino que hoy factura.

**Status:** decision — levantado el 18-ago-2026 al cerrar la ola de construcción

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
