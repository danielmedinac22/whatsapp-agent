/**
 * El alcance de operación de una consulta del panel, en cuatro funciones.
 *
 * **Por qué existe un archivo para tres `eq`.** El ticket 06 cerró la fuga por
 * accesores: volvió obligatorio el parámetro de operación y el tipado estricto
 * encontró los call sites. Su punto ciego es estructural — una consulta que lee
 * filas directo con Drizzle no pasa por ningún accesor, así que no hay
 * parámetro que volver obligatorio y **el compilador no tiene nada que
 * señalar**. `listConversations` no pregunta por «la conexión»: hace
 * `select().from(conversations)` y ordena por actividad.
 *
 * Estas funciones son el marcador que sí se puede revisar sin compilador. La
 * prueba `apps/worker/src/operations/consultas-del-panel.test.ts` lee
 * `queries.ts` y falla si una función exportada toca una tabla con dueño sin
 * llamar a ninguna de ellas. Escribir `eq(conversations.operationId, op.id)` a
 * mano funciona igual de bien en ejecución y **la prueba lo acepta**: lo que la
 * prueba atrapa es la consulta que no filtra en absoluto, que es la fuga real.
 *
 * Nada de esto reemplaza al contract del ticket 06. Lo complementa: aquel cubre
 * lo que pasa por accesor, esto cubre lo que no.
 */

import type { PgColumn } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { and, contacts, conversations, eq, sql } from "./db";
import type { Operation } from "@wa/db";

/**
 * Las filas que son de esta operación.
 *
 * Sirve igual para una columna `NOT NULL` (`templates`, `wa_templates`,
 * `dropi_orders`) que para una nullable (`conversations`, `shopify_orders`), y
 * en las nullable **deja fuera las filas sin atribuir** a propósito: una fila
 * que no dice de qué operación es no es de esta. Hoy no hay ninguna —cero en
 * NULL en las 1.719 conversaciones y en los 1.712 pedidos, medido el
 * 18-ago-2026—, así que filtrar devuelve exactamente lo mismo que antes.
 */
export function ofOperation(op: Operation, operationColumn: PgColumn): SQL {
  return eq(operationColumn, op.id);
}

/**
 * Una fila concreta **que además tiene que ser de esta operación**.
 *
 * Es la forma de las escrituras por id, y el criterio que más importa del
 * ticket 10: `markRead`, `setAgentMode` y `setConfirmationStatus` reciben un id
 * y escriben. Sin la segunda mitad de este `and`, un id viejo en una pestaña
 * abierta —o una URL escrita a mano— apaga el agente de la conversación de otro
 * país. Que la pertenencia viaje **dentro del `where` del `UPDATE`** y no en un
 * `SELECT` previo es lo que la hace atómica: entre leer y escribir la fila
 * puede cambiar de dueño.
 */
export function rowOfOperation(
  op: Operation,
  idColumn: PgColumn,
  id: string,
  operationColumn: PgColumn,
): SQL {
  return and(eq(idColumn, id), ofOperation(op, operationColumn))!;
}

/**
 * Lo que cuelga de una conversación de esta operación.
 *
 * `messages` y `message_media` no llevan `operation_id` y no la necesitan
 * —cuelgan de la conversación, y filtrar la conversación alcanza—, pero
 * `listMessages` recibe el id de la conversación desde la URL, así que la
 * pertenencia hay que verificarla igual. Va como `exists` y no como `join` para
 * no cambiarle la forma a lo que la consulta devuelve.
 */
export function throughConversationOfOperation(
  op: Operation,
  conversationIdColumn: PgColumn,
): SQL {
  return sql`exists (
    select 1 from ${conversations}
    where ${conversations.id} = ${conversationIdColumn}
      and ${conversations.operationId} = ${op.id}
  )`;
}

/**
 * Un contacto que esta operación atiende.
 *
 * **`contacts` no lleva `operation_id` y no es un olvido**: una persona puede
 * existir en las dos operaciones y eso no es un error — el mismo cliente puede
 * escribirle a Guatemala y a Colombia. Lo que sí es de una operación es la
 * conversación, y el índice único sobre `contact_id` garantiza que sea una
 * sola. De ahí que el alcance de un contacto se resuelva por su conversación.
 */
export function contactOfOperation(op: Operation, contactId: string): SQL {
  return and(
    eq(contacts.id, contactId),
    sql`exists (
      select 1 from ${conversations}
      where ${conversations.contactId} = ${contacts.id}
        and ${conversations.operationId} = ${op.id}
    )`,
  )!;
}
