import { generateText } from "ai";
import { eq } from "@wa/db";
import {
  contacts,
  conversations,
  dropiOrders,
  getAgentSettings,
  requireOperationOrSole,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { contactWaId } from "../lib/phone";
import { openrouter } from "../agent/openrouter";
import { TECHO_DE_RESPUESTA } from "../agent/techo-de-respuesta";
import { NOVEDAD_TEMPLATE, sanitizeParam } from "../kapso/templates";
import { enqueueOutbound } from "./outbound";
import { DROPI_NOVEDAD_NOTIFY_QUEUE, getBoss } from "./queue";

interface NovedadNotifyPayload {
  dropiRowId: string;
}

const SYSTEM_PROMPT = `Eres un asesor de atención al cliente que escribe por WhatsApp en español, en tono natural, humano, cercano y profesional. Tu trabajo aquí es escribir UN solo mensaje inicial para informarle al cliente que su pedido tiene una novedad reportada por la transportadora, y pedirle la información que corresponda según el motivo.

Recibirás:
- El motivo crudo reportado por la transportadora (en mayúsculas, en español).
- El nombre del cliente (puede estar vacío).
- Plantillas de referencia para distintos motivos típicos. Son guía, NO copiar literal.

Cómo escribir la respuesta:
- Saluda corto, identifícate como el equipo de la tienda.
- Menciona la novedad reportada y por qué le escribes (sin tecnicismos del estado del pedido).
- Pide lo que corresponda al motivo: confirmación, dirección correcta, número actualizado, confirmación de la compra, contar qué pasó, etc.
- Sé breve (3-5 líneas máximo). Puedes usar 1 emoji al inicio si suena natural.
- Cierra invitando a responder.

Reglas DURAS — no las rompas nunca:
- NUNCA prometas fechas exactas de entrega ni reentrega.
- NUNCA confirmes que ya se reagendó la entrega.
- NUNCA hables de reembolsos, devoluciones, ni cancelaciones.
- NUNCA inventes información que no esté en el motivo.
- NO presiones al cliente, no discutas, no uses lenguaje robótico ni formal de call center.
- NO firmes con "Atentamente" ni con un nombre propio.

Plantillas de referencia (úsalas como inspiración, adapta el tono):

[Cliente no contesta llamadas/WhatsApp]
"Hola, ¿cómo estás? 😊
Te contactamos porque la transportadora nos informa que no ha logrado comunicarse contigo para realizar la entrega de tu pedido.
Queríamos confirmar si aún deseas recibirlo y validar contigo la información de entrega.
Quedamos atentos."

[Dirección incorrecta o insuficiente]
"Hola, ¿cómo estás? 😊
La transportadora nos informa que la dirección registrada en tu pedido presenta un inconveniente o no logró ser ubicada correctamente.
¿Nos ayudas por favor confirmando la dirección correcta o enviándonos más detalles de ubicación para poder coordinar nuevamente la entrega?"

[Número incorrecto]
"Hola, ¿cómo estás? 😊
La transportadora nos informa que hubo un inconveniente con el número telefónico registrado en tu pedido y no lograron comunicarse contigo.
¿Podrías por favor confirmarnos un número actualizado con WhatsApp para coordinar correctamente la entrega?"

[Cliente niega el pedido]
"Hola, ¿cómo estás? 😊
Te contactamos porque la transportadora nos informa que hubo una novedad con tu pedido y nos indican que posiblemente no reconoces la compra.
Queríamos confirmar contigo esta información."

[Cliente inconforme con el producto]
"Hola, ¿cómo estás? 😊
La transportadora nos informa que hubo una novedad con la entrega de tu pedido debido a una inconformidad reportada.
Queríamos conocer un poco más sobre lo sucedido para poder ayudarte."

Devuelve ÚNICAMENTE el texto del mensaje, sin comillas, sin etiquetas, sin explicación.`;

async function generateNovedadMessage(input: {
  reasonRaw: string;
  customerName: string | null;
  model: string;
}): Promise<string> {
  const provider = openrouter();
  const userMsg = [
    `Motivo de la transportadora: "${input.reasonRaw}"`,
    `Nombre del cliente: ${input.customerName?.trim() || "(no disponible)"}`,
    "",
    "Escribe el mensaje inicial.",
  ].join("\n");

  const result = await generateText({
    model: provider(input.model),
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
    maxOutputTokens: TECHO_DE_RESPUESTA,
  });
  return result.text.trim();
}

async function handleNovedadNotify({ dropiRowId }: NovedadNotifyPayload) {
  const [order] = await db
    .select()
    .from(dropiOrders)
    .where(eq(dropiOrders.id, dropiRowId))
    .limit(1);
  if (!order) {
    logger.warn({ dropiRowId }, "novedad-notify: order not found");
    return;
  }
  if (order.novedadFirstNotifiedAt) {
    logger.info(
      { dropiOrderId: order.dropiOrderId },
      "novedad-notify: already notified, skipping",
    );
    return;
  }
  if (!order.contactId) {
    logger.warn(
      { dropiOrderId: order.dropiOrderId },
      "novedad-notify: no contact linked",
    );
    return;
  }
  const reason = order.novedadReasonRaw;
  if (!reason) {
    logger.warn(
      { dropiOrderId: order.dropiOrderId },
      "novedad-notify: missing reason_raw, skipping",
    );
    return;
  }

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, order.contactId))
    .limit(1);
  if (!contact) {
    logger.warn(
      { dropiOrderId: order.dropiOrderId, contactId: order.contactId },
      "novedad-notify: contact missing",
    );
    return;
  }
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.contactId, contact.id))
    .limit(1);

  // El modelo que redacta la novedad es el de la operación dueña del chat, así
  // que la configuración se lee después de tener la conversación en la mano.
  // El único efecto del reordenamiento es cuál de los dos avisos se registra
  // cuando falta el contacto Y falta la configuración: ninguno de los dos
  // envía nada.
  const settings = await getAgentSettings(
    await requireOperationOrSole(conv?.operationId),
  );
  if (!settings) {
    logger.warn(
      { dropiOrderId: order.dropiOrderId, operationId: conv?.operationId },
      "novedad-notify: agent_settings missing, skipping",
    );
    return;
  }

  const text = await generateNovedadMessage({
    reasonRaw: reason,
    customerName: order.customerName ?? contact.name ?? null,
    model: settings.model,
  });
  if (!text) {
    logger.warn(
      { dropiOrderId: order.dropiOrderId },
      "novedad-notify: LLM returned empty text",
    );
    return;
  }

  const to = contactWaId(contact);
  if (!to) {
    logger.warn(
      { dropiOrderId: order.dropiOrderId, contactId: contact.id },
      "novedad-notify: contact has no wa_id",
    );
    return;
  }
  // Preferimos el mensaje rico del LLM (si la ventana de 24h está abierta);
  // fuera de ventana cae a la plantilla aprobada de novedad.
  await enqueueOutbound({
    to,
    body: text,
    source: "dropi_status",
    sourceRef: order.id,
    // uuid de la fila: el id de Dropi no es único entre operaciones.
    dedupKey: `dropi-novedad:${order.id}:first`,
    conversationId: conv?.id ?? null,
    fallbackTemplate: {
      name: NOVEDAD_TEMPLATE,
      params: [
        sanitizeParam(
          (order.customerName ?? contact.name ?? "").trim() || "👋",
        ),
        sanitizeParam(order.guideNumber ?? `Dropi #${order.dropiOrderId}`),
        sanitizeParam(reason),
      ],
    },
  });

  await db
    .update(dropiOrders)
    .set({ novedadFirstNotifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(dropiOrders.id, order.id));

  logger.info(
    { dropiOrderId: order.dropiOrderId, contactId: contact.id, reason },
    "novedad-notify: initial outreach enqueued",
  );
}

export async function enqueueNovedadNotify(
  dropiRowId: string,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(
    DROPI_NOVEDAD_NOTIFY_QUEUE,
    { dropiRowId },
    { singletonKey: `novedad-notify:${dropiRowId}` },
  );
}

export async function startDropiNovedadNotifyWorker() {
  const boss = await getBoss();
  await boss.work<NovedadNotifyPayload>(
    DROPI_NOVEDAD_NOTIFY_QUEUE,
    async (raw) => {
      const list = (Array.isArray(raw) ? raw : [raw]) as Array<{
        id?: string;
        data?: NovedadNotifyPayload;
      }>;
      for (const job of list) {
        const data = (job?.data ?? job) as NovedadNotifyPayload;
        try {
          await handleNovedadNotify(data);
        } catch (err) {
          logger.error(
            { err, jobId: job?.id },
            "novedad-notify job failed",
          );
          throw err;
        }
      }
    },
  );
  logger.info("dropi novedad-notify worker started");
}
