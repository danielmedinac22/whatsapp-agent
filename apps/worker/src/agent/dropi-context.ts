import { desc, dropiOrders, eq } from "@wa/db";
import { db } from "../db";

const MAX_ORDERS = 3;

const STATUS_LABEL: Record<string, string> = {
  unknown: "estado desconocido",
  pendiente_confirmacion: "pendiente de confirmación",
  pendiente: "confirmado, pendiente de generar guía",
  guia_generada: "guía generada",
  preparado_transportadora: "preparado para la transportadora",
  recolectado: "recolectado por la transportadora",
  en_transito: "en tránsito",
  con_mensajero: "con el mensajero (en reparto)",
  entregado: "entregado",
  novedad: "con novedad (revisar)",
  anulada: "anulada",
};

function formatDate(d: Date | null): string | null {
  if (!d) return null;
  return new Date(d).toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export async function buildDropiContextBlock(
  contactId: string,
): Promise<string | null> {
  const orders = await db
    .select()
    .from(dropiOrders)
    .where(eq(dropiOrders.contactId, contactId))
    .orderBy(desc(dropiOrders.updatedAt))
    .limit(MAX_ORDERS);

  if (orders.length === 0) return null;

  const lines: string[] = [];
  lines.push("## Estado de pedidos en Dropi");
  for (const o of orders) {
    const status = STATUS_LABEL[o.status] ?? o.status;
    const updated = formatDate(o.updatedAt);
    const parts: string[] = [`Pedido Dropi #${o.dropiOrderId}: ${status}`];
    if (o.guideNumber) parts.push(`guía ${o.guideNumber}`);
    if (o.carrier) parts.push(`transportadora ${o.carrier}`);
    if (updated) parts.push(`última actualización ${updated}`);
    lines.push(`- ${parts.join(" · ")}`);
  }
  lines.push("");
  lines.push(
    "Usa esta información para responder consultas sobre el estado del envío. No inventes guías ni transportadoras que no estén aquí.",
  );
  return lines.join("\n");
}
