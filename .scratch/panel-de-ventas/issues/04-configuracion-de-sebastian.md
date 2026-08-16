# Configuración de Sebastián: personas, descuentos y límites

Type: grilling
Status: resolved
Blocked by: —

## Question

Dos decisiones del PRD §12 que se resuelven juntas porque las dos son "cómo se configura el vendedor":

- **§12.3** — ¿Una sola persona (Sebastián) para todo, o varias según producto o campaña?
- **§12.4** — ¿Qué puede negociar Sebastián? ¿Ofrece descuentos, hasta cuánto, bajo qué condiciones? ¿Qué tiene prohibido prometer — tiempos de entrega, garantías, disponibilidad de stock?

Ambas alimentan la sección 5.1 del panel (Vendedor / Persona), y las dos hay que cerrarlas antes de publicar el documento porque definen qué se le entrega a Vorare como configurable y qué queda fijo.

## Answer

### Una sola persona

Sebastián, no varias. Tres productos concentran el 96% del volumen: varias personas serían UI, tablas y confusión para un problema que Vorare no tiene. Si algún día hace falta, entra como fase posterior cotizable.

### Configuración híbrida, no todo estructurado ni todo prompt libre

Hoy la persona del agente es un `system_prompt` de texto libre en la fila única de `agent_settings`. El PRD §5.1 pide campos estructurados. Ninguno de los dos extremos sirve: todo estructurado es mucha UI a precio fijo, y todo libre deja que una edición del cliente rompa al vendedor sin que nadie se entere.

- **Estructurado** lo que tiene consecuencia: nombre visible, mensajes base (saludo, empuje al cierre, mensaje de cierre/embudo) y el límite de descuento.
- **Campo libre** para tono e instrucciones de personalidad.

### El descuento es una regla dura, con el valor configurable

**El límite se aplica en código al crear la orden.** El prompt propone, el código valida. El *valor* del límite sale de un campo del panel que Vorare edita — incluido 0% para no permitir descuentos — pero **la validación siempre corre**: no es una perilla que se pueda apagar.

Si Sebastián pacta un descuento fuera de rango, la orden **se crea al precio válido y escala a humano**, no se crea al precio pactado ni se cae.

El razonamiento: a un LLM al que le escribes *"puedes dar hasta 10%"*, un cliente insistente eventualmente le saca 20%. Un límite que solo vive en el prompt no es un límite, es una sugerencia — y la diferencia la paga Vorare en cada pedido.

### Consecuencia de esquema

`agent_settings` es **fila única** (`id=1`) con un solo `system_prompt` y un solo `model`. Sebastián necesita su propia configuración: es cambio de modelo de datos, no un campo más. Se suma al que ya exige el segundo número en `kapso_connection`.
