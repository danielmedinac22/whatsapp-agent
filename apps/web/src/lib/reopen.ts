import {
  NOVEDAD_TEMPLATE,
  REABRIR_TEMPLATE,
  RECOMPRA_TEMPLATE,
  RECORDATORIO_PEDIDO_TEMPLATE,
  renderTemplateBody,
  sanitizeParam,
} from "@wa/shared";

/**
 * Reopen options for a thread outside the Meta 24h window: each option is one
 * approved template with its variables resolved from what we know about the
 * conversation. Non-sendable options are returned too (not filtered) so the
 * operator sees WHY they can't be used — waichat's pattern.
 */

export interface ReopenContext {
  contactName: string | null;
  /** Título del último producto pedido en Shopify, si lo hay. */
  producto: string | null;
  dropiGuide: string | null;
  novedadReason: string | null;
  /** Template names Meta has approved for the current WABA. */
  approvedTemplates: string[];
}

export interface ReopenOption {
  templateName: string;
  label: string;
  params: string[];
  /** The exact text the customer would receive. */
  preview: string;
  sendable: boolean;
  /** Why the option can't be sent (shown when sendable is false). */
  reason: string | null;
}

function option(
  ctx: ReopenContext,
  templateName: string,
  label: string,
  params: string[],
  missing: string | null,
): ReopenOption {
  const approved = ctx.approvedTemplates.includes(templateName);
  const reason = !approved
    ? "Pendiente de aprobación de Meta"
    : (missing ?? null);
  return {
    templateName,
    label,
    params,
    preview: renderTemplateBody(templateName, params),
    sendable: reason === null,
    reason,
  };
}

export function buildReopenOptions(ctx: ReopenContext): ReopenOption[] {
  const nombre = sanitizeParam(ctx.contactName ?? "") || "👋";
  const producto = ctx.producto ? sanitizeParam(ctx.producto) : null;

  return [
    option(ctx, REABRIR_TEMPLATE, "Retomar conversación", [nombre], null),
    option(
      ctx,
      RECORDATORIO_PEDIDO_TEMPLATE,
      "Recuperar pedido sin confirmar",
      [nombre, producto ?? "tu pedido"],
      ctx.producto ? null : "Sin pedido Shopify vinculado",
    ),
    option(
      ctx,
      NOVEDAD_TEMPLATE,
      "Novedad de entrega",
      [
        nombre,
        ctx.dropiGuide ? sanitizeParam(ctx.dropiGuide) : "?",
        ctx.novedadReason ? sanitizeParam(ctx.novedadReason) : "?",
      ],
      ctx.dropiGuide && ctx.novedadReason
        ? null
        : "Sin novedad activa de Dropi",
    ),
    option(
      ctx,
      RECOMPRA_TEMPLATE,
      "Recompra del mes (marketing, ~25x más cara)",
      [nombre, producto ?? "tu producto"],
      ctx.producto ? null : "Sin compra previa vinculada",
    ),
  ];
}
