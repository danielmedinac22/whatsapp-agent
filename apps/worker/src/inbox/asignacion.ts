/**
 * **Soltar la asignación de una conversación que cambió de bandeja.**
 *
 * Quien la vendía ya no la está trabajando cuando la venta cerró y la
 * conversación pasó a operaciones: las dos columnas de la asignación —
 * `assigned_user_id` y `assigned_at`— vuelven a `null`. Eso no cambió y no
 * cambia. Lo que cambió es **quién lo dispara**.
 *
 * ## Por qué esto vive acá y no en la carga del Inbox
 *
 * Vivía en `conversationIdsOfInbox` (`apps/web/src/lib/queries.ts`), colgado de
 * la derivación de la bandeja, con este argumento: el cambio de bandeja no
 * tiene un momento propio en el que engancharse —nadie mueve la conversación,
 * la mueve un pedido que nació o un clic que llegó— y se descubre al volver a
 * derivar, así que se aprovechaba el viaje.
 *
 * El argumento era correcto y la consecuencia no: **el panel llama
 * `router.refresh()` con cada evento SSE**, o sea una vez por mensaje de
 * WhatsApp que entra, por cada pestaña abierta. Un `UPDATE` sobre
 * `conversations` —la tabla más caliente del sistema— disparado por el tráfico
 * de esa misma tabla. Medido: 200 conversaciones asignadas antes de que
 * naciera su pedido, y **un solo render escribió 199 filas** sin que nadie
 * tocara un botón. Eso es lo que impide cachear la pantalla, servirla desde
 * una réplica, o razonar sobre ella como una lectura.
 *
 * Acá el conjunto que hay que mirar es otro y es el que hace que esto sea
 * barato: **solo puede haber que soltar donde hay algo asignado.** Aquella
 * versión recorría las 1.762 conversaciones de la operación para encontrar las
 * dos que tenían asignación; ésta pregunta por `assigned_user_id is not null`,
 * que es un puñado, y no crece con la tabla.
 *
 * ## Cuándo corre
 *
 * Dos disparadores, y el reparto no es redundancia:
 *
 * - **El hecho**, que es un pedido naciendo para el contacto
 *   (`routes/shopify.ts`). Es el caso normal de una venta y es donde la
 *   liberación sigue siendo **inmediata**: el mismo webhook que crea el pedido
 *   suelta la asignación que ese pedido acaba de invalidar.
 * - **El barrido periódico** (`jobs/liberar-asignaciones.ts`). Es la red, y es
 *   lo que hace que la garantía no dependa de acordarse de todos los sitios
 *   donde un pedido puede nacer: vuelve a preguntar por **todas** las
 *   asignaciones vivas, así que ningún camino olvidado se queda sin cubrir.
 *   Cubre también el otro hecho que mueve la bandeja —un clic de anuncio
 *   posterior a la asignación, la regla 1— y el atraso acumulado del día que
 *   se encienda al vendedor.
 *
 * Es el mismo reparto que ya usa el reporte de conversiones a Meta
 * (`jobs/capi-conversion.ts`) y por la misma razón que aquél da: el barrido lee
 * **hechos** —hay una fila de pedido, la bandeja de hoy no es la de entonces—
 * y no intenciones.
 *
 * ## Lo que este archivo NO decide
 *
 * Si la conversación cambió de bandeja lo dice `inboxChangedSince` (`@wa/db`),
 * que es puro y está probado con fixtures en `./asignacion.test.ts`. Acá solo
 * se cargan los hechos y se escribe. Es la misma división de siempre: una
 * decisión, un sitio.
 */

import {
  and,
  contacts,
  conversations,
  eq,
  getSalesAgentSettings,
  inArray,
  inboxChangedSince,
  isNotNull,
  salesAgentIsConfigured,
  type InboxFacts,
  type Operation,
  type SalesCutoff,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { loadOrderFactsByContacts } from "./facts";

/** Lo que una pasada de liberación dejó, para el log y para los tests del job. */
export interface LiberacionDeAsignaciones {
  /** Conversaciones asignadas que se miraron. */
  miradas: number;
  /** De ellas, cuántas quedaron libres. */
  sueltas: number;
}

const NADA: LiberacionDeAsignaciones = { miradas: 0, sueltas: 0 };

/**
 * Suelta las asignaciones de esta operación que dejaron de corresponder.
 *
 * Con `contactId` mira solo las conversaciones de ese contacto —el gancho del
 * pedido recién nacido—; sin él, todas las asignadas de la operación —el
 * barrido—. Es idempotente: una asignación ya suelta no vuelve a entrar porque
 * la consulta pide `assigned_user_id is not null`.
 *
 * **Sin vendedor configurado no hace nada, y es lo correcto, no una omisión.**
 * Sin vendedor la operación tiene una sola bandeja, así que ninguna
 * conversación puede haberse ido de la de ventas: `inboxChangedSince` sin línea
 * de corte devuelve `false` para todo. Es el estado de producción hoy, y salir
 * antes de consultar nada es lo que hace que este trabajo no le cueste ni una
 * consulta a Guatemala mientras siga así.
 */
export async function liberarAsignacionesVencidas(
  op: Operation,
  opciones: { contactId?: string } = {},
): Promise<LiberacionDeAsignaciones> {
  const vendedor = await getSalesAgentSettings(op);
  if (!salesAgentIsConfigured(vendedor)) return NADA;
  // Sin fecha de encendido tampoco hay corte, y sin corte no hay bandeja de
  // ventas de la que irse. `stampSalesAgentActivation` la pone en la primera
  // lectura, así que esto es el borde de la operación recién configurada.
  if (vendedor.activatedAt === null) return NADA;

  const asignadas = await db
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      adReferralAt: conversations.adReferralAt,
      assignedAt: conversations.assignedAt,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(
      and(
        eq(conversations.operationId, op.id),
        isNotNull(conversations.assignedUserId),
        // Sin `assigned_at` no hay instante contra el que comparar la bandeja
        // de entonces, así que no se puede decir que cambió. Es la misma
        // condición que tenía la versión anterior, y descartarla en la base en
        // vez de en memoria es lo que la vuelve una consulta y no un recorrido.
        isNotNull(conversations.assignedAt),
        opciones.contactId
          ? eq(conversations.contactId, opciones.contactId)
          : undefined,
      ),
    );

  if (asignadas.length === 0) return NADA;

  const pedidos = await loadOrderFactsByContacts(
    op,
    asignadas.map((c) => c.contactId),
  );

  const soltar: string[] = [];
  for (const fila of asignadas) {
    const facts: InboxFacts = {
      lastAdClickAt: fila.adReferralAt,
      orders: pedidos.get(fila.contactId) ?? [],
    };
    const corte: SalesCutoff = {
      activatedAt: vendedor.activatedAt,
      bornAt: fila.createdAt,
    };
    // `assignedAt` no puede ser nulo acá: la consulta lo exige.
    if (inboxChangedSince(facts, fila.assignedAt!, corte)) soltar.push(fila.id);
  }

  if (soltar.length === 0) {
    return { miradas: asignadas.length, sueltas: 0 };
  }

  await db
    .update(conversations)
    .set({ assignedUserId: null, assignedAt: null })
    .where(
      and(
        eq(conversations.operationId, op.id),
        inArray(conversations.id, soltar),
      ),
    );

  logger.info(
    {
      operation: op.countryCode,
      miradas: asignadas.length,
      sueltas: soltar.length,
      porContacto: opciones.contactId ?? null,
    },
    "bandeja: asignaciones sueltas por cambio de bandeja",
  );
  return { miradas: asignadas.length, sueltas: soltar.length };
}
