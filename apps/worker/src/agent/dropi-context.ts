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

  // Active novedad: si alguno de los pedidos visibles tiene una novedad ya
  // notificada al cliente y aún no escalada, inyectar contexto + reglas duras.
  const activeNovedad = orders.find(
    (o) =>
      o.status === "novedad" &&
      o.novedadFirstNotifiedAt &&
      !o.novedadEscalatedAt,
  );
  if (activeNovedad) {
    lines.push("");
    lines.push("## Novedad activa en gestión");
    lines.push(
      `Pedido Dropi #${activeNovedad.dropiOrderId} tiene una novedad reportada por la transportadora.`,
    );
    if (activeNovedad.novedadReasonRaw) {
      lines.push(`Motivo crudo de la transportadora: "${activeNovedad.novedadReasonRaw}"`);
    }
    const notifiedAt = formatDate(activeNovedad.novedadFirstNotifiedAt);
    if (notifiedAt) {
      lines.push(`Ya enviaste el mensaje inicial el ${notifiedAt}.`);
    }
    lines.push("");
    lines.push("Tu rol aquí es solamente:");
    lines.push("- Recibir la respuesta del cliente y agradecer si confirma o corrige datos.");
    lines.push("- Confirmar que la información será actualizada para coordinar nuevamente la entrega.");
    lines.push("- Avisarle que el caso pasará a un asesor para terminar de gestionarlo.");
    lines.push("");
    lines.push("Reglas DURAS sobre esta novedad — no las rompas:");
    lines.push("- NUNCA prometas fechas exactas de entrega ni reentrega.");
    lines.push("- NUNCA confirmes que la entrega ya fue reagendada.");
    lines.push("- NUNCA hables de reembolsos, devoluciones ni cancelaciones.");
    lines.push("- NUNCA modifiques el pedido tú mismo (eso lo hace un humano luego).");
    lines.push("- Si el cliente está molesto, amenaza, pide reembolso/devolución, o hay inconsistencias graves, agradece su mensaje y dile que un asesor humano continuará la gestión.");
  }

  return lines.join("\n");
}
