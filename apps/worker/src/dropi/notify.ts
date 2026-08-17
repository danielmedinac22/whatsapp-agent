import { eq } from "@wa/db";
import {
  agentSettings,
  contacts,
  conversations,
  dropiOrders,
  shopifyOrders,
  type DropiOrder,
  type Operation,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { contactWaId } from "../lib/phone";
import { extractOrderVariables } from "../shopify/extract";
import {
  CON_MENSAJERO_TEMPLATE,
  EN_OFICINA_TEMPLATE,
  EN_TRANSITO_TEMPLATE,
  ENTREGADO_TEMPLATE,
  GUIA_GENERADA_TEMPLATE,
  RECOLECTADO_TEMPLATE,
  renderTemplateBody,
  sanitizeParam,
} from "../kapso/templates";
import { enqueueOutbound } from "../jobs/outbound";
import { resolveDropiConnection } from "./config";
import { extractNovedadReason } from "./novedad";
import { enqueueNovedadNotify } from "../jobs/dropi-novedad-notify";

type DropiStatus = DropiOrder["status"];

const NOTIFIABLE: DropiStatus[] = [
  "guia_generada",
  "recolectado",
  "en_transito",
  "con_mensajero",
  "en_oficina",
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
    case "en_oficina":
      return s.dropiTemplateEnOficinaId;
    case "entregado":
      return s.dropiTemplateEntregadoId;
    default:
      return null;
  }
}

/** Meta template + positional params for a notifiable Dropi status. */
function metaTemplateFor(
  status: DropiStatus,
  vars: {
    nombre: string;
    guia: string;
    transportadora: string;
    pdfGuia: string;
    ciudad: string;
  },
): { name: string; params: string[] } | null {
  const { nombre, guia, transportadora, pdfGuia, ciudad } = vars;
  switch (status) {
    case "guia_generada":
      return {
        name: GUIA_GENERADA_TEMPLATE,
        params: [nombre, guia, transportadora, pdfGuia || "en camino"],
      };
    case "recolectado":
      return { name: RECOLECTADO_TEMPLATE, params: [nombre, transportadora, guia] };
    case "en_transito":
      return { name: EN_TRANSITO_TEMPLATE, params: [nombre, guia, transportadora] };
    case "con_mensajero":
      return { name: CON_MENSAJERO_TEMPLATE, params: [nombre, guia] };
    case "en_oficina":
      return {
        name: EN_OFICINA_TEMPLATE,
        params: [nombre, guia, transportadora, ciudad],
      };
    case "entregado":
      return { name: ENTREGADO_TEMPLATE, params: [nombre, guia, transportadora] };
    default:
      return null;
  }
}

async function sendStatusNotification(
  op: Operation,
  order: DropiOrder,
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
  const to = contactWaId(contact);
  if (!to) {
    logger.warn(
      { dropiOrderId: order.dropiOrderId, contactId: contact.id },
      "dropi notify: contact has no wa_id",
    );
    return false;
  }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.contactId, contact.id))
    .limit(1);

  let shopifyVars: Record<string, string | number | null | undefined> = {};
  if (order.shopifyOrderRowId) {
    const [shop] = await db
      .select()
      .from(shopifyOrders)
      .where(eq(shopifyOrders.id, order.shopifyOrderRowId))
      .limit(1);
    if (shop) {
      shopifyVars = extractOrderVariables(shop.rawPayload);
    }
  }

  // El PDF de la guía vive en el CDN de la logística de esta operación.
  const conn = await resolveDropiConnection(op);
  const assetsBase = (conn?.assetsBaseUrl ?? "").replace(/\/$/, "");
  const pdfGuia =
    assetsBase && order.guidePdfPath
      ? `${assetsBase}/${order.guidePdfPath.replace(/^\//, "")}`
      : "";

  // Status updates are business-initiated (usually outside the 24h window)
  // → Meta pre-approved templates.
  const tpl = metaTemplateFor(order.status, {
    nombre: sanitizeParam(
      String(shopifyVars.nombre || order.customerName || contact.name || "").trim() ||
        "👋",
    ),
    guia: sanitizeParam(order.guideNumber ?? "en generación"),
    transportadora: sanitizeParam(order.carrier ?? "la transportadora"),
    pdfGuia: sanitizeParam(pdfGuia, 500),
    // Dropi no dice en qué oficina quedó el paquete; la ciudad del pedido es
    // lo más concreto que podemos darle al cliente.
    ciudad: sanitizeParam(
      String(
        (order.rawPayload as { city?: unknown } | null)?.city ??
          shopifyVars.ciudad ??
          "",
      ).trim() || "tu ciudad",
    ),
  });
  if (!tpl) return false;

  await enqueueOutbound({
    to,
    body: renderTemplateBody(tpl.name, tpl.params),
    source: "dropi_status",
    sourceRef: order.id,
    // La clave lleva el uuid de la fila, no el id de Dropi: ese id es único
    // dentro de una cuenta y no entre cuentas, así que dos operaciones con el
    // mismo número se taparían el mensaje una a la otra.
    dedupKey: `dropi:${order.id}:${order.status}`,
    conversationId: conv?.id ?? null,
    template: tpl,
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
  op: Operation,
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

  // The agent_settings template ids still act as per-status on/off switches;
  // the message content itself now comes from the Meta-approved catalog.
  const tplId = templateIdFor(s, order.status);
  if (!tplId) {
    logger.info(
      { dropiOrderId: order.dropiOrderId, status: order.status },
      "dropi notify: no template configured for status, skipping",
    );
    return { notified: false, escalated: false, skipped: "no_template" };
  }

  const ok = await sendStatusNotification(op, order);
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
