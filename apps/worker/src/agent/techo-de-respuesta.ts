/**
 * **Cuántos tokens de salida puede pedir un turno del agente.**
 *
 * ## Por qué existe
 *
 * Sin `maxOutputTokens`, el SDK pide el techo del modelo: 65.536 tokens con el
 * `gpt-5.4-mini` que corre hoy. OpenRouter **cobra esa reserva por adelantado**,
 * no lo que la respuesta termine gastando, y si el saldo de la llave no la
 * cubre rechaza la petición entera con un 402:
 *
 * > This request requires more credits, or fewer max_tokens. You requested up
 * > to 65536 tokens, but can only afford 50612.
 *
 * Eso apagó al agente en Guatemala el 21-ago-2026 a las 16:03 y lo dejó apagado
 * 25 horas. Las plantillas siguieron saliendo porque no pasan por el modelo, así
 * que desde afuera parecía que «la IA no contesta» sin ningún error visible: la
 * capa de `@openrouter/sdk` no logra parsear el cuerpo del 402 contra su esquema
 * y lo que quedó escrito en `agent_runs` fueron 48 filas que decían
 * «Response validation failed», un error de pago disfrazado de error de parseo.
 *
 * La reserva de 65.536 tokens cuesta unos 7 centavos de dólar. Con este techo
 * cuesta menos de medio centavo, así que quedarse corto de saldo deja de apagar
 * el agente entero y pasa a ser lo que debería haber sido siempre: un problema
 * de recargar la cuenta.
 *
 * ## Por qué 2.000 y no otro número
 *
 * Medido sobre las **3.751 corridas sin error** que hay en `agent_runs`:
 *
 * | mediana | p95 | p99 | máximo histórico |
 * | -- | -- | -- | -- |
 * | 30 | 60 | 76 | 109 |
 *
 * La respuesta más larga que el agente escribió en su vida ocupó 109 tokens.
 * Este techo son dieciocho veces eso. El margen no es por las respuestas: es por
 * los **tokens de razonamiento**, que se cobran como salida y cuentan contra
 * este límite. `agent_settings.model` es un campo del panel, así que alguien
 * puede cambiar a un modelo que razone sin tocar código, y un techo ajustado a
 * los 109 tokens de hoy le truncaría la respuesta a mitad de frase. Truncar es
 * peor que reservar de más: el mensaje cortado **sale igual** hacia el cliente.
 *
 * Si algún día hace falta afinarlo, el número que hay que volver a medir es la
 * tabla de arriba, no este comentario.
 */
export const TECHO_DE_RESPUESTA = 2_000;
