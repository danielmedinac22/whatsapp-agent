/**
 * **Quién apretó enviar**, para que el mensaje que sale lleve su nombre.
 *
 * Es la mitad del panel del ticket 02: la otra —`usuarioQueEnvia`, en
 * `apps/worker/src/routes/wa.ts`— ya recibe el identificador, lo comprueba
 * contra `users` y lo persiste en `outbound_messages.sent_by_user_id` y
 * `messages.sent_by_user_id`. La tubería existía entera y le faltaba el valor:
 * las dos columnas están en `null` en los 19.282 salientes de producción.
 *
 * **Lo pone el servidor, no el navegador.** Sale de la sesión de quien hace la
 * llamada, no de un campo del formulario: un identificador que viaja desde el
 * cliente es un identificador que se puede cambiar, y esto es la atribución de
 * lo que se le dijo a un cliente real. La sesión ya se resuelve en estas rutas
 * para decidir si el envío se permite; el mismo `auth()` responde las dos cosas.
 *
 * **Nunca hace fallar el envío.** Un cuerpo que no es JSON se reenvía tal cual
 * y lo rechaza el worker, que es quien valida; la atribución es un dato de más y
 * el mensaje es el trabajo.
 */

/** El cuerpo JSON del envío con `sentByUserId` agregado, o el original si no lo es. */
export function conQuienEnvia(body: string, userId: string | null): string {
  if (userId === null) return body;
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return body;
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return body;
  }
  return JSON.stringify({ ...payload, sentByUserId: userId });
}
