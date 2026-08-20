import { and, asc, eq, gte } from "@wa/db";
import {
  contacts,
  conversations,
  dropiOrders,
  messages,
  requireOperationById,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { ADMIN_AVISO_TEMPLATE, sanitizeParam } from "../kapso/templates";
import { enqueueOutbound } from "./outbound";
import { getDropiConnection } from "../dropi/config";
import { DROPI_NOVEDAD_HANDOFF_QUEUE, getBoss } from "./queue";

interface NovedadHandoffPayload {
  dropiRowId: string;
}

const HANDOFF_DELAY_S = 5 * 60; // 5 min después de la primera respuesta del cliente
const MAX_INBOUND_QUOTES = 5;
const MAX_QUOTE_LEN = 280;

function quoteBody(body: string | null): string {
  const t = (body ?? "").trim();
  if (!t) return "(mensaje vacío)";
  return t.length > MAX_QUOTE_LEN ? t.slice(0, MAX_QUOTE_LEN) + "…" : t;
}

async function handleNovedadHandoff({ dropiRowId }: NovedadHandoffPayload) {
  const [order] = await db
    .select()
    .from(dropiOrders)
    .where(eq(dropiOrders.id, dropiRowId))
    .limit(1);
  if (!order) {
    logger.warn({ dropiRowId }, "novedad-handoff: order not found");
    return;
  }
  if (order.novedadEscalatedAt) {
    return; // ya se hizo handoff o escalación
  }
  if (!order.contactId) {
    logger.warn(
      { dropiOrderId: order.dropiOrderId },
      "novedad-handoff: no contact",
    );
    return;
  }
  if (!order.novedadFirstNotifiedAt) {
    logger.warn(
      { dropiOrderId: order.dropiOrderId },
      "novedad-handoff: no first_notified_at, skipping",
    );
    return;
  }

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, order.contactId))
    .limit(1);
  if (!contact) return;

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.contactId, contact.id))
    .limit(1);

  // Inbound del cliente desde que se envió el mensaje inicial.
  let clientReplies: string[] = [];
  if (conv) {
    const rows = await db
      .select({ body: messages.body, createdAt: messages.createdAt })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conv.id),
          eq(messages.direction, "in"),
          gte(messages.createdAt, order.novedadFirstNotifiedAt),
        ),
      )
      .orderBy(asc(messages.createdAt))
      .limit(MAX_INBOUND_QUOTES);
    clientReplies = rows.map((r) => quoteBody(r.body));
  }

  // El admin a avisar es el de la operación del pedido, no «el» admin. Desde
  // la `0021` la fila de logística declara su operación, así que sale de ahí y
  // no de la conversación del cliente: es la misma cuenta de Dropi que reportó
  // la novedad.
  const conn = await requireOperationById(order.operationId)
    .then((op) => getDropiConnection(op))
    .catch(() => null);
  const adminPhone = conn?.adminPhone;
  if (!adminPhone) {
    logger.warn(
      { dropiOrderId: order.dropiOrderId },
      "novedad-handoff: no admin_phone configured, cannot ping",
    );
    // Aun así marcamos handoff y apagamos agente — el cliente ya respondió.
  }

  const customerLabel = contact.name ?? order.customerName ?? `+${contact.phone ?? "?"}`;
  const phoneLine = contact.phone ? `\n📱 +${contact.phone}` : "";
  const motivoLine = order.novedadReasonRaw
    ? `\n*Motivo original:* _${order.novedadReasonRaw}_`
    : "";
  const repliesBlock = clientReplies.length
    ? clientReplies.map((q) => `> ${q}`).join("\n")
    : "_(no se encontraron mensajes inbound)_";

  const body =
    `📦 *Novedad respondida — actualizar en Dropi*\n\n` +
    `*Pedido Dropi #${order.dropiOrderId}*\n` +
    `Cliente: *${customerLabel}*${phoneLine}${motivoLine}\n\n` +
    `*Respuesta del cliente:*\n${repliesBlock}\n\n` +
    `→ Entra a Dropi y actualiza la novedad con esta información.`;

  if (adminPhone) {
    await enqueueOutbound({
      to: adminPhone.replace(/\D/g, ""),
      body,
      source: "escalation",
      // uuid de la fila: el id de Dropi no es único entre operaciones.
      dedupKey: `dropi-novedad:${order.id}:handoff`,
      fallbackTemplate: {
        name: ADMIN_AVISO_TEMPLATE,
        params: [
          sanitizeParam(
            `el cliente ${customerLabel} respondió la novedad del pedido Dropi #${order.dropiOrderId} — actualízala en Dropi`,
          ),
        ],
      },
    });
  }

  if (contact.agentMode) {
    await db
      .update(contacts)
      .set({ agentMode: false })
      .where(eq(contacts.id, contact.id));
  }

  await db
    .update(dropiOrders)
    .set({ novedadEscalatedAt: new Date(), updatedAt: new Date() })
    .where(eq(dropiOrders.id, order.id));

  logger.info(
    {
      dropiOrderId: order.dropiOrderId,
      contactId: contact.id,
      replies: clientReplies.length,
    },
    "novedad-handoff: admin notified, agent off",
  );
}

export async function enqueueNovedadHandoff(
  dropiRowId: string,
  delaySeconds = HANDOFF_DELAY_S,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(
    DROPI_NOVEDAD_HANDOFF_QUEUE,
    { dropiRowId },
    {
      singletonKey: `novedad-handoff:${dropiRowId}`,
      startAfter: delaySeconds,
    },
  );
}

export async function startDropiNovedadHandoffWorker() {
  const boss = await getBoss();
  await boss.work<NovedadHandoffPayload>(
    DROPI_NOVEDAD_HANDOFF_QUEUE,
    async (raw) => {
      const list = (Array.isArray(raw) ? raw : [raw]) as Array<{
        id?: string;
        data?: NovedadHandoffPayload;
      }>;
      for (const job of list) {
        const data = (job?.data ?? job) as NovedadHandoffPayload;
        try {
          await handleNovedadHandoff(data);
        } catch (err) {
          logger.error(
            { err, jobId: job?.id },
            "novedad-handoff job failed",
          );
          throw err;
        }
      }
    },
  );
  logger.info("dropi novedad-handoff worker started");
}
