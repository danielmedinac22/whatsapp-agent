import { and, eq, isNotNull, isNull } from "@wa/db";
import { dropiOrders } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { enqueueNovedadHandoff } from "../jobs/dropi-novedad-handoff";

/**
 * Marks any active novedad for this contact (already notified, not yet
 * escalated, no prior reply) as having received a customer reply, and
 * schedules a handoff job 5 min later that will summarize the customer's
 * response to the admin and turn off agentMode.
 *
 * Idempotent and best-effort: errors are logged, not thrown. Subsequent
 * calls are no-ops because the where-clause filters out rows that already
 * have customer_replied_at set.
 */
export async function markNovedadCustomerReply(
  contactId: string,
): Promise<void> {
  try {
    const open = await db
      .select({ id: dropiOrders.id, dropiOrderId: dropiOrders.dropiOrderId })
      .from(dropiOrders)
      .where(
        and(
          eq(dropiOrders.contactId, contactId),
          eq(dropiOrders.status, "novedad"),
          isNotNull(dropiOrders.novedadFirstNotifiedAt),
          isNull(dropiOrders.novedadCustomerRepliedAt),
          isNull(dropiOrders.novedadEscalatedAt),
        ),
      );
    if (open.length === 0) return;

    const now = new Date();
    for (const o of open) {
      await db
        .update(dropiOrders)
        .set({ novedadCustomerRepliedAt: now, updatedAt: now })
        .where(eq(dropiOrders.id, o.id));
      // Programar handoff a 5 min — singletonKey evita duplicados si llegan
      // varias respuestas casi simultáneas.
      await enqueueNovedadHandoff(o.id).catch((err) =>
        logger.error(
          { err, dropiRowId: o.id },
          "novedad: failed to enqueue handoff",
        ),
      );
    }
    logger.info(
      { contactId, count: open.length },
      "novedad: marked customer reply, handoff scheduled (5m)",
    );
  } catch (err) {
    logger.error({ err, contactId }, "novedad: failed to mark customer reply");
  }
}
