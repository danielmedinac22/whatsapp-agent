import { and, eq, isNotNull, isNull, lte } from "@wa/db";
import {
  contacts,
  conversations,
  dropiOrders,
  type DropiOrder,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { enqueueOutbound } from "./outbound";
import { getDropiConnection } from "../dropi/config";
import { DROPI_NOVEDAD_REMINDER_QUEUE, getBoss } from "./queue";

const HOUR_MS = 60 * 60 * 1000;
const REMINDER_AFTER_MS = 4 * HOUR_MS;
const ESCALATE_AFTER_MS = 4 * HOUR_MS;

const REMINDER_BODY = `Hola 😊
Te escribimos nuevamente porque tu pedido continúa pendiente por una novedad de entrega y la transportadora aún no ha logrado comunicarse contigo.
Quedamos atentos a tu respuesta para poder ayudarte a coordinar nuevamente la entrega.`;

async function sendReminder(order: DropiOrder): Promise<boolean> {
  if (!order.contactId) return false;
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, order.contactId))
    .limit(1);
  if (!contact) return false;
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.contactId, contact.id))
    .limit(1);

  await enqueueOutbound({
    jid: contact.jid,
    body: REMINDER_BODY,
    source: "dropi_status",
    sourceRef: order.id,
    dedupKey: `dropi-novedad:${order.dropiOrderId}:reminder`,
    conversationId: conv?.id ?? null,
  });
  await db
    .update(dropiOrders)
    .set({ novedadReminderAt: new Date(), updatedAt: new Date() })
    .where(eq(dropiOrders.id, order.id));
  return true;
}

async function escalateOrder(order: DropiOrder): Promise<boolean> {
  if (!order.contactId) return false;
  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, order.contactId))
    .limit(1);
  if (!contact) return false;

  if (contact.agentMode) {
    await db
      .update(contacts)
      .set({ agentMode: false })
      .where(eq(contacts.id, contact.id));
  }

  const conn = await getDropiConnection().catch(() => null);
  const adminPhone = conn?.adminPhone;
  if (adminPhone) {
    const customerLabel = contact.name ?? `+${contact.phone ?? "?"}`;
    const phoneLine = contact.phone ? `\n📱 +${contact.phone}` : "";
    const body =
      `🚨 *Novedad sin respuesta*\n\n` +
      `*${customerLabel}* no respondió al mensaje inicial ni al recordatorio sobre la novedad de su pedido Dropi #${order.dropiOrderId}.${phoneLine}\n\n` +
      `Motivo reportado: _${order.novedadReasonRaw ?? "(sin detalle)"}_\n\n` +
      `El agente quedó apagado. Continúa la gestión manualmente.`;
    await enqueueOutbound({
      jid: `${adminPhone.replace(/\D/g, "")}@s.whatsapp.net`,
      body,
      source: "escalation",
      dedupKey: `dropi-novedad:${order.dropiOrderId}:escalation`,
    });
  } else {
    logger.warn(
      { dropiOrderId: order.dropiOrderId },
      "novedad-reminder: no admin_phone, cannot ping",
    );
  }

  await db
    .update(dropiOrders)
    .set({ novedadEscalatedAt: new Date(), updatedAt: new Date() })
    .where(eq(dropiOrders.id, order.id));
  return true;
}

export interface NovedadReminderResult {
  reminded: number;
  escalated: number;
  errors: number;
}

export async function runNovedadReminder(): Promise<NovedadReminderResult> {
  const now = Date.now();

  // 1) Pendientes de recordatorio: notificados hace ≥4h, sin recordatorio,
  //    sin reply, sin escalación.
  const reminderCutoff = new Date(now - REMINDER_AFTER_MS);
  const pendingReminder = await db
    .select()
    .from(dropiOrders)
    .where(
      and(
        eq(dropiOrders.status, "novedad"),
        isNotNull(dropiOrders.novedadFirstNotifiedAt),
        lte(dropiOrders.novedadFirstNotifiedAt, reminderCutoff),
        isNull(dropiOrders.novedadReminderAt),
        isNull(dropiOrders.novedadCustomerRepliedAt),
        isNull(dropiOrders.novedadEscalatedAt),
      ),
    );

  let reminded = 0;
  let errors = 0;
  for (const order of pendingReminder) {
    try {
      const ok = await sendReminder(order);
      if (ok) reminded++;
    } catch (err) {
      logger.error(
        { err, dropiOrderId: order.dropiOrderId },
        "novedad-reminder: send failed",
      );
      errors++;
    }
  }

  // 2) Pendientes de escalación: con recordatorio enviado hace ≥4h, sin reply,
  //    sin escalación previa.
  const escalateCutoff = new Date(now - ESCALATE_AFTER_MS);
  const pendingEscalate = await db
    .select()
    .from(dropiOrders)
    .where(
      and(
        eq(dropiOrders.status, "novedad"),
        isNotNull(dropiOrders.novedadReminderAt),
        lte(dropiOrders.novedadReminderAt, escalateCutoff),
        isNull(dropiOrders.novedadCustomerRepliedAt),
        isNull(dropiOrders.novedadEscalatedAt),
      ),
    );

  let escalated = 0;
  for (const order of pendingEscalate) {
    try {
      const ok = await escalateOrder(order);
      if (ok) escalated++;
    } catch (err) {
      logger.error(
        { err, dropiOrderId: order.dropiOrderId },
        "novedad-reminder: escalation failed",
      );
      errors++;
    }
  }

  if (reminded || escalated || errors) {
    logger.info(
      { reminded, escalated, errors },
      "novedad-reminder cycle complete",
    );
  }
  return { reminded, escalated, errors };
}

export async function startDropiNovedadReminderWorker() {
  const boss = await getBoss();
  await boss.work(DROPI_NOVEDAD_REMINDER_QUEUE, async (raw) => {
    const list = (Array.isArray(raw) ? raw : [raw]) as Array<{ id?: string }>;
    for (const job of list) {
      try {
        await runNovedadReminder();
      } catch (err) {
        logger.error(
          { err, jobId: job?.id },
          "novedad-reminder job failed",
        );
        throw err;
      }
    }
  });
  logger.info("dropi novedad-reminder worker started");
}

export async function scheduleDropiNovedadReminder(): Promise<void> {
  const boss = await getBoss();
  // Cada hora: la query interna decide qué órdenes corresponden.
  const cron = "0 * * * *";
  await boss.schedule(DROPI_NOVEDAD_REMINDER_QUEUE, cron, {});
  logger.info({ cron }, "dropi novedad-reminder scheduled");
}

export async function enqueueDropiNovedadReminderNow(): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(DROPI_NOVEDAD_REMINDER_QUEUE, {});
}
