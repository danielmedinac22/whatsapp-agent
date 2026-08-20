/**
 * Quién mandó un mensaje, cuando el panel lo dice.
 *
 * `outbound_messages.sent_by_user_id` y `messages.sent_by_user_id` son claves
 * foráneas a `users`: un identificador inventado no falla al leerlo, falla al
 * **insertarlo**, o sea en medio del envío. Por eso la forma se comprueba en el
 * borde, antes de encolar nada, y lo que no la cumple se descarta.
 *
 * Acá vive solo la parte pura —la forma—; que el usuario exista lo pregunta la
 * ruta, que es la que tiene la base. Es la misma separación que `inbox/facts.ts`
 * hace con el ruteo: la regla se prueba, la consulta no.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ¿Esto tiene forma de identificador de usuario?
 *
 * Dice que no a todo lo que no sea un uuid, y **nunca lanza**: el que pregunta
 * es el camino de envío del número que factura, y la atribución es un dato de
 * más. Un valor raro hace que el mensaje salga sin firmar, no que no salga.
 */
export function esIdDeUsuario(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}
