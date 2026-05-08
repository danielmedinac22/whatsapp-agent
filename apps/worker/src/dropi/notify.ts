import { eq } from "@wa/db";
import {
  agentSettings,
  contacts,
  conversations,
  dropiOrders,
  shopifyOrders,
  templates,
  type DropiOrder,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { renderTemplate } from "../lib/template";
import { extractOrderVariables } from "../shopify/extract";
import { enqueueOutbound } from "../jobs/outbound";
import { getDropiConnection } from "./config";
import { extractNovedadReason } from "./novedad";
import { enqueueNovedadNotify } from "../jobs/dropi-novedad-notify";

type DropiStatus = DropiOrder["status"];

const NOTIFIABLE: DropiStatus[] = [
  "guia_generada",
  "recolectado",
  "en_transito",
  "con_mensajero",
  "entregado",
];

function templateIdFor(
  s: typeof agentSettings.$inferSelect,
  status: DropiStatus,
): string | null {
  switch (status) {
    case "guia_generada":
      return s.dropiTemplateGuiaId;
    case "recolectado":
      return s.dropiTemplateRecolectadoId;
    case "en_transito":
      return s.dropiTemplateEnTransitoId;
    case "con_mensajero":
      return s.dropiTemplateConMensajeroId;
    case "entregado":
      return s.dropiTemplateEntregadoId;
    default:
      return null;
  }
}

async function sendStatusNotification(
  order: DropiOrder,
  templateBody: string,
): Promise<boolean> {
  if (!order.contactId) {
    logger.warn(
      { dropiOrderId: order.dropiOrderId, status: order.status },
      "dropi notify: no contact linked, cannot notify",
    );
    return false;
  }
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

  let shopifyVars: Record<string, string | number | null | undefined> = {};
  let shopifyOrderNum: string | null = null;
  if (order.shopifyOrderRowId) {
    const [shop] = await db
      .select()
      .from(shopifyOrders)
      .where(eq(shopifyOrders.id, order.shopifyOrderRowId))
      .limit(1);
    if (shop) {
      shopifyVars = extractOrderVariables(shop.rawPayload);
      shopifyOrderNum = shop.orderId;
    }
  }

  const conn = await getDropiConnection();
  const assetsBase = (conn?.assetsBaseUrl ?? "").replace(/\/$/, "");
  const pdfGuia =
    assetsBase && order.guidePdfPath
      ? `${assetsBase}/${order.guidePdfPath.replace(/^\//, "")}`
      : "";

  const vars: Record<string, string | number | null | undefined> = {
    ...shopifyVars,
    nombre: shopifyVars.nombre || order.customerName || contact.name || "",
    pedido: shopifyOrderNum || String(order.dropiOrderId),
    guia: order.guideNumber ?? "",
    transportadora: order.carrier ?? "",
    estado: order.status,
    pdf_guia: pdfGuia,
  };

  const text = renderTemplate(templateBody, vars);

  await enqueueOutbound({
    jid: contact.jid,
    body: text,
    source: "dropi_status",
    sourceRef: order.id,
    dedupKey: `dropi:${order.dropiOrderId}:${order.status}`,
    conversationId: conv?.id ?? null,
  });
  return true;
}

export interface MaybeNotifyResult {
  notified: boolean;
  escalated: boolean;
  skipped: "not_notifiable" | "already_notified" | "no_template" | null;
}

/**
 * Single source of truth for dropi status notifications.
 * Triggers on: status ∈ NOTIFIABLE && status != last_notified_status.
 * Idempotent: dedupKey on enqueueOutbound prevents double-sends across
 * concurrent sync/poll observations.
 */
export async function maybeNotifyDropiStatus(
  order: DropiOrder,
  s: typeof agentSettings.$inferSelect,
): Promise<MaybeNotifyResult> {
  // novedad → enqueue LLM-driven outreach if a concrete reason is available.
  // No reason yet (e.g. raw status "INCIDENCIA EN RUTA" without detail) → wait.
  if (order.status === "novedad") {
    const reason = extractNovedadReason(order.rawPayload);
    if (!reason) {
      return { notified: false, escalated: false, skipped: "not_notifiable" };
    }
    if (!order.contactId) {
      logger.warn(
        { dropiOrderId: order.dropiOrderId },
        "dropi notify: novedad without contact, cannot notify",
      );
      return { notified: false, escalated: false, skipped: "not_notifiable" };
    }
    if (order.novedadFirstNotifiedAt) {
      return { notified: false, escalated: false, skipped: "already_notified" };
    }
    if (order.novedadReasonRaw !== reason) {
      await db
        .update(dropiOrders)
        .set({ novedadReasonRaw: reason })
        .where(eq(dropiOrders.id, order.id));
    }
    await enqueueNovedadNotify(order.id);
    logger.info(
      {
        dropiOrderId: order.dropiOrderId,
        contactId: order.contactId,
        reason,
      },
      "dropi notify: novedad enqueued for LLM outreach",
    );
    return { notified: false, escalated: false, skipped: null };
  }

  if (!NOTIFIABLE.includes(order.status)) {
    return { notified: false, escalated: false, skipped: "not_notifiable" };
  }
  if (order.lastNotifiedStatus === order.status) {
    return { notified: false, escalated: false, skipped: "already_notified" };
  }

  const tplId = templateIdFor(s, order.status);
  if (!tplId) {
    logger.info(
      { dropiOrderId: order.dropiOrderId, status: order.status },
      "dropi notify: no template configured for status, skipping",
    );
    return { notified: false, escalated: false, skipped: "no_template" };
  }
  const [tpl] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, tplId))
    .limit(1);
  if (!tpl) {
    logger.warn(
      { dropiOrderId: order.dropiOrderId, tplId },
      "dropi notify: template missing",
    );
    return { notified: false, escalated: false, skipped: "no_template" };
  }

  const ok = await sendStatusNotification(order, tpl.body);
  if (ok) {
    await db
      .update(dropiOrders)
      .set({
        lastNotifiedStatus: order.status,
        lastNotifiedAt: new Date(),
      })
      .where(eq(dropiOrders.id, order.id));
    logger.info(
      {
        dropiOrderId: order.dropiOrderId,
        status: order.status,
        contactId: order.contactId,
      },
      "dropi notify: enqueued",
    );
  }
  return { notified: ok, escalated: false, skipped: null };
}
