import { and, eq, isNotNull, isNull } from "@wa/db";
import { dropiOrders } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";

/**
 * Marks any active novedad for this contact (already notified, not yet
 * escalated, no prior reply) as having received a customer reply.
 * Idempotent and best-effort: errors are logged, not thrown.
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
    }
    logger.info(
      { contactId, count: open.length },
      "novedad: marked customer reply",
    );
  } catch (err) {
    logger.error({ err, contactId }, "novedad: failed to mark customer reply");
  }
}
