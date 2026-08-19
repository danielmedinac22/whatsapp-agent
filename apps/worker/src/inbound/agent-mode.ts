/**
 * Con qué `agent_mode` **nace** un contacto.
 *
 * Todo lo de este archivo es PURO: recibe hechos y devuelve una decisión. No
 * toca la base, ni el reloj, ni la configuración.
 *
 * **El problema que resuelve.** `contacts.agent_mode` es el interruptor que
 * decide si al agente se le pregunta —`pipeline.ts` solo llama al runner cuando
 * está encendido— y nace apagado. Hoy solo lo encienden `followup`,
 * `confirmation-ack` y `remarketing`, y los tres corren **después de que existe
 * un pedido**. La confirmación funciona porque toda su conversación empieza con
 * un pedido: llega el pedido, sale la plantilla, ahí se enciende el interruptor.
 * La venta es al revés —el lead escribe **primero**, cuando todavía no hay
 * pedido—, así que nadie enciende nada y al vendedor no se le pregunta nunca,
 * por bien configurado que esté.
 *
 * **Por qué al crear y no ensanchando el guardia.** `agentMode || es un lead`
 * resucitaría a un contacto que un asesor apagó a propósito: hoy `false`
 * significa a la vez «nadie lo tocó nunca» y «un humano lo apagó», y el sistema
 * no los distingue. «Contacto nuevo» es un **momento**, no un estado: ocurre una
 * sola vez, al crear la fila, y no vuelve a ocurrir. Decidido ahí, el asesor
 * queda protegido sin guardar nada —ese contacto ya no es nuevo, y ninguna regla
 * lo vuelve a encender, ni siquiera si más tarde hace clic en otro anuncio— y no
 * hace falta la columna que distinguiría los dos ceros.
 */

/**
 * De dónde nació el contacto — y **solo** los hechos que cada nacimiento
 * necesita.
 *
 * Es una unión discriminada a propósito, como `ConversationOwnerFacts`: el
 * contacto que nace de un pedido de la tienda no puede ni pasar la
 * configuración del vendedor, porque su respuesta no depende de ella. Así el
 * receptor de pedidos —por donde entran los que facturan, el riesgo R4 de la
 * no-regresión— no gana ni una lectura de más, y nadie puede cablearle una por
 * descuido.
 */
export type NewContactFacts =
  /** Primer mensaje entrante de un número desconocido. El lead. */
  | { origin: "inbound_message"; salesAgentConfigured: boolean }
  /** El webhook de la tienda vio un pedido de alguien que no teníamos. */
  | { origin: "store_order" };

/** Cuál de las tres reglas decidió el nacimiento. */
export type NewContactAgentModeRule =
  /** La operación no tiene vendedor configurado. El comportamiento de siempre. */
  | "no_sales_agent"
  /** Nació de un pedido, no de un mensaje: el interruptor es de la postventa. */
  | "born_from_order"
  /** Escribió primero y hay vendedor: es el lead que este ticket vino a atender. */
  | "new_lead";

export interface NewContactAgentMode {
  agentMode: boolean;
  rule: NewContactAgentModeRule;
}

/**
 * El `agent_mode` con el que se inserta la fila, y por qué.
 *
 * El `rule` no es decorativo —igual que el del ruteo y el del dueño—: es lo que
 * hace verificable en un test que un contacto nuevo de Guatemala nace apagado
 * **por no haber vendedor** y no por casualidad del origen.
 *
 * **`no_sales_agent` es el guardia de no-regresión, y es obligatorio.** Sin él,
 * un contacto nuevo nacería encendido en una operación sin vendedor, y
 * encadenado eso es Katherine contestándole a un desconocido: `resolveInbox`
 * manda a **ventas** toda conversación sin pedido (regla `no_order`) y
 * `resolveConversationOwner` devuelve **`confirmacion`** mientras no haya
 * vendedor (regla `no_sales_agent`). Hoy esos contactos no reciben nada. Con el
 * guardia puesto no cambia absolutamente nada mientras `sales_agent_settings`
 * siga vacía, que es el estado de producción.
 *
 * **El contacto nacido de un pedido nace apagado, y es deliberado.** No escribió
 * —no hay nada que contestarle—, y el interruptor de un contacto con pedido ya
 * tiene dueño: `followup` lo enciende al mandar la plantilla y
 * `confirmation-ack` lo enciende al acusar, este último solo si el admin dejó
 * `activate_agent_on_confirm` prendido. Nacer encendido pasaría por encima de
 * esa perilla: un admin que la apagó vería al agente contestar igual desde el
 * segundo mensaje del cliente. Encender aquí no le daría al negocio nada que no
 * tenga —el dueño de esa conversación es el de confirmación, porque tiene
 * pedido— y le quitaría un control que hoy existe.
 */
export function decideNewContactAgentMode(
  facts: NewContactFacts,
): NewContactAgentMode {
  if (facts.origin === "store_order") {
    return { agentMode: false, rule: "born_from_order" };
  }
  if (!facts.salesAgentConfigured) {
    return { agentMode: false, rule: "no_sales_agent" };
  }
  return { agentMode: true, rule: "new_lead" };
}
