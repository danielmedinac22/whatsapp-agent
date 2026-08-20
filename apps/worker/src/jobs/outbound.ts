import { eq } from "@wa/db";
import {
  contacts,
  conversations,
  getProductMediaForSend,
  messageMedia,
  messages,
  outboundMessages,
  setProductMediaMetaId,
  type OutboundMessage,
} from "@wa/db";
import {
  mediaKind as mediaKindOf,
  parseProductMediaRef,
  productMediaRef,
  puedeEnviarse,
  type MediaKind,
} from "@wa/shared";
import { db } from "../db";
import { events } from "../lib/events";
import { logger } from "../lib/logger";
import { huellaDelSaliente } from "../inbox/saliente-conversacional";
import {
  KapsoApiError,
  classifyKapsoError,
  isWindowClosedError,
  sendAudio,
  sendMedia,
  sendTemplate,
  sendText,
  uploadMedia,
} from "../kapso/client";
import { isStatusAdvance } from "../kapso/delivery";
import { getKapsoConnection } from "../kapso/connection";
import { isTemplateApproved } from "../kapso/provisioning";
import {
  getConversationOperationId,
  getOperationIdByWaId,
  requireOperationOrSole,
  type Operation,
} from "../operations";
import { renderTemplateBody } from "../kapso/templates";
import { OUTBOUND_QUEUE, getBoss } from "./queue";

const MAX_BODY_LEN = 4096;

export interface TemplateSend {
  name: string;
  params: string[];
}

interface EnqueueInput {
  /** Destination wa_id: E.164 digits, no "+". */
  to: string;
  /** Rendered text — what the chat history shows. For template sends, render
   *  the template body so history matches what Meta delivers. */
  body: string;
  source:
    | "followup"
    | "remarketing"
    | "agent"
    | "manual"
    | "confirmation_ack"
    | "dropi_status"
    | "dropi_2fa"
    | "escalation";
  sourceRef?: string | null;
  dedupKey: string;
  conversationId?: string | null;
  sentByUserId?: string | null;
  /** ms from now to defer the first attempt */
  delayMs?: number;
  /** Send this Meta template instead of free text (business-initiated sends). */
  template?: TemplateSend;
  /** Template to fall back to when a free-text send hits the closed 24h window. */
  fallbackTemplate?: TemplateSend;
  /** Nota de voz: fila de message_media ya persistida. */
  media?: { id: string; kind: "audio" };
  /**
   * Apoyo visual: fila de `product_media` que el vendedor manda durante la
   * conversación. Va por `source_ref` y no por `media_id` porque esa columna
   * apunta a `message_media` por clave foránea; el códec de la referencia es
   * {@link productMediaRef}, compartido con el que lo lee más abajo.
   */
  productMedia?: { id: string; kind: MediaKind };
}

export async function enqueueOutbound(input: EnqueueInput): Promise<{
  outboundId: string;
  enqueued: boolean;
}> {
  const scheduledFor = input.delayMs && input.delayMs > 0
    ? new Date(Date.now() + input.delayMs)
    : new Date();

  const inserted = await db
    .insert(outboundMessages)
    .values({
      toWaId: input.to.replace(/\D/g, ""),
      body: input.body,
      source: input.source,
      sourceRef: input.productMedia
        ? productMediaRef(input.productMedia.id)
        : (input.sourceRef ?? null),
      dedupKey: input.dedupKey,
      conversationId: input.conversationId ?? null,
      sentByUserId: input.sentByUserId ?? null,
      templateName: input.template?.name ?? null,
      templateParams: input.template?.params ?? null,
      fallbackTemplateName: input.fallbackTemplate?.name ?? null,
      fallbackTemplateParams: input.fallbackTemplate?.params ?? null,
      mediaId: input.media?.id ?? null,
      // Redundante con `source_ref` para el apoyo visual, y a propósito: es lo
      // que hace que la fila diga qué es cuando alguien la mira en la base.
      mediaKind: input.media?.kind ?? input.productMedia?.kind ?? null,
      scheduledFor,
    })
    .onConflictDoNothing({ target: outboundMessages.dedupKey })
    .returning({ id: outboundMessages.id });

  if (inserted.length === 0) {
    const [existing] = await db
      .select({ id: outboundMessages.id })
      .from(outboundMessages)
      .where(eq(outboundMessages.dedupKey, input.dedupKey))
      .limit(1);
    if (existing) {
      logger.debug(
        { dedupKey: input.dedupKey, outboundId: existing.id },
        "outbound: dedup hit, not re-enqueued",
      );
      return { outboundId: existing.id, enqueued: false };
    }
    throw new Error(
      `outbound dedup conflict but row not found for ${input.dedupKey}`,
    );
  }

  const outboundId = inserted[0]!.id;
  const boss = await getBoss();
  const startAfter = input.delayMs && input.delayMs > 0
    ? Math.floor(input.delayMs / 1000)
    : 0;

  await boss.send(
    OUTBOUND_QUEUE,
    { outboundId },
    {
      singletonKey: input.dedupKey,
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      ...(startAfter > 0 ? { startAfter } : {}),
    },
  );

  logger.info(
    { outboundId, source: input.source, to: input.to, dedupKey: input.dedupKey },
    "outbound: enqueued",
  );
  return { outboundId, enqueued: true };
}

interface OutboundJob {
  outboundId: string;
}

async function loadRow(id: string): Promise<OutboundMessage | undefined> {
  const [row] = await db
    .select()
    .from(outboundMessages)
    .where(eq(outboundMessages.id, id))
    .limit(1);
  return row;
}

function errorDetail(err: unknown): string {
  if (err instanceof KapsoApiError) return err.detail;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Motivo en español del fallo de envío, para mostrarlo en el hilo.
 *
 * Un rechazo AL ENVIAR casi nunca significa "número malo": son ventana
 * cerrada o configuración nuestra (WABA, phone_number_id, Kapso). El número
 * inválido aparece después, como fallo de ENTREGA, y ese texto lo pone
 * `metaErrorReason`. No los confundimos: el asesor decide a quién volver a
 * llamar con base en esto.
 */
function humanSendError(err: unknown): string {
  if (err instanceof KapsoApiError) {
    if (err.status === 422) {
      return "Fuera de la ventana de 24h — requiere plantilla aprobada.";
    }
    if (err.timedOut) return "WhatsApp no respondió al enviar.";
    if (err.status === 401 || err.status === 403) {
      return "WhatsApp rechazó las credenciales de envío.";
    }
    if (err.status === 404) {
      return "No hay configuración de WhatsApp activa.";
    }
    return `WhatsApp rechazó el envío por un problema de configuración (error ${err.status}).`;
  }
  return "No se pudo enviar el mensaje.";
}

/**
 * La operación por la que sale el mensaje: la de su conversación.
 *
 * `outbound_messages` no tiene operación propia y no hace falta — la
 * conversación ya la guarda desde la ingesta. Sin conversación (un envío a un
 * número con el que nunca se ha hablado) cae al puente de la operación única,
 * que es exactamente lo que hacía el sistema antes de la migración; el contract
 * le quitó el caso `null`, que leía la fila singleton y por tanto el número de
 * Guatemala.
 */
async function resolveOutboundOperation(
  row: OutboundMessage,
): Promise<Operation> {
  const operationId = row.conversationId
    ? await getConversationOperationId(row.conversationId)
    : await getOperationIdByWaId(row.toWaId);
  return requireOperationOrSole(operationId);
}

async function resolveConversationId(
  row: OutboundMessage,
): Promise<string | null> {
  if (row.conversationId) return row.conversationId;
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(contacts.waId, row.toWaId))
    .limit(1);
  return conv?.id ?? null;
}

/**
 * Espeja un envío que murió en el hilo del chat. Sin esto el mensaje
 * simplemente no existía para el asesor: veía un chat sin respuesta en vez de
 * un mensaje marcado como no entregado, que es justo la señal que necesita
 * para saber si el número está malo.
 */
async function mirrorFailedSend(
  row: OutboundMessage,
  reason: string,
): Promise<void> {
  const conversationId = await resolveConversationId(row);
  if (!conversationId) return;
  const [stored] = await db
    .insert(messages)
    .values({
      conversationId,
      direction: "out" as const,
      waId: row.waId, // null cuando nunca llegó a salir
      body: row.body,
      status: "failed" as const,
      deliveryError: reason,
      fromAgent: row.source === "agent",
      sentByUserId: row.sentByUserId ?? null,
    })
    .onConflictDoNothing({ target: messages.waId })
    .returning({ id: messages.id });
  if (stored) {
    events.emitEvent({
      type: "message.created",
      conversationId,
      messageId: stored.id,
    });
  }
}

/**
 * `reason` existe para los fallos que **no vienen de WhatsApp**: un archivo que
 * el admin desmarcó mientras estaba en la cola no falló al enviarse, se decidió
 * que no se enviara, y «No se pudo enviar el mensaje» le haría buscar al asesor
 * un problema que no existe.
 */
async function markPermanent(
  row: OutboundMessage,
  err: unknown,
  reason?: string,
): Promise<void> {
  await db
    .update(outboundMessages)
    .set({
      status: "dead",
      failedAt: new Date(),
      lastError: errorDetail(err),
      lastErrorKind: "permanent",
      attempts: row.attempts + 1,
      updatedAt: new Date(),
    })
    .where(eq(outboundMessages.id, row.id));
  await mirrorFailedSend(row, reason ?? humanSendError(err)).catch((mirrorErr) =>
    logger.error(
      { err: mirrorErr, outboundId: row.id },
      "outbound: no se pudo espejar el fallo en el hilo",
    ),
  );
}

async function markTransientFailure(
  id: string,
  err: unknown,
  attempts: number,
): Promise<void> {
  await db
    .update(outboundMessages)
    .set({
      status: "pending",
      lastError: errorDetail(err),
      lastErrorKind: "transient",
      attempts,
      updatedAt: new Date(),
    })
    .where(eq(outboundMessages.id, id));
}

async function handleOutbound(payload: OutboundJob): Promise<void> {
  const row = await loadRow(payload.outboundId);
  if (!row) {
    logger.warn({ outboundId: payload.outboundId }, "outbound: row not found");
    return;
  }

  // Idempotency guard — already terminal or completed.
  if (
    row.status === "acked" ||
    row.status === "dead" ||
    row.status === "failed" ||
    (row.status === "sent" && row.ackedAt)
  ) {
    return;
  }

  // Body length is a permanent error — don't retry.
  if (!row.templateName && row.body.length > MAX_BODY_LEN) {
    await markPermanent(
      row,
      new Error(`body too long (${row.body.length} > ${MAX_BODY_LEN})`),
    );
    return;
  }

  // La operación del mensaje sale de su conversación. Antes, un fallo aquí
  // caía en la conexión única y el mensaje salía igual; con dos operaciones eso
  // es mandar el mensaje de un país por el número de otro, que es peor que no
  // mandarlo. Ahora el mensaje **no se pierde**: queda como fallo transitorio y
  // pg-boss lo reintenta, igual que cuando la conexión no está configurada.
  let op: Operation;
  try {
    op = await resolveOutboundOperation(row);
  } catch (err) {
    logger.error(
      { err: String(err), outboundId: row.id },
      "outbound: no se pudo resolver la operación del mensaje",
    );
    const e = err instanceof Error ? err : new Error(String(err));
    await markTransientFailure(row.id, e, row.attempts + 1);
    throw e; // pg-boss reintenta
  }

  const conn = await getKapsoConnection(op);
  if (!conn?.phoneNumberId) {
    await markTransientFailure(
      row.id,
      new Error("kapso connection not configured"),
      row.attempts + 1,
    );
    throw new Error("kapso connection not configured"); // pg-boss retries
  }
  const phoneNumberId = conn.phoneNumberId;

  // Mark sending so observers see in-flight state.
  await db
    .update(outboundMessages)
    .set({
      status: "sending",
      attempts: row.attempts + 1,
      updatedAt: new Date(),
    })
    .where(eq(outboundMessages.id, row.id));

  let waId: string | null = null;
  // What actually went out — mirrors into `messages` for the chat history.
  let sentBody = row.body;
  let mediaMime: string | null = null;
  const productMediaId = parseProductMediaRef(row.sourceRef);
  try {
    if (row.mediaId) {
      // Nota de voz: los bytes ya están guardados; solo falta que Meta tenga
      // su copia. El media id se cachea para que un reintento no re-suba.
      const [media] = await db
        .select()
        .from(messageMedia)
        .where(eq(messageMedia.id, row.mediaId))
        .limit(1);
      if (!media) {
        await markPermanent(row, new Error("media row not found"));
        return;
      }
      mediaMime = media.mime;
      let metaMediaId = media.metaMediaId;
      if (!metaMediaId) {
        const uploaded = await uploadMedia({
          phoneNumberId,
          bytes: media.bytes,
          mime: media.mime,
          filename: media.mime.includes("ogg") ? "nota-de-voz.ogg" : "audio",
        });
        metaMediaId = uploaded.mediaId;
        await db
          .update(messageMedia)
          .set({ metaMediaId })
          .where(eq(messageMedia.id, media.id));
      }
      const result = await sendAudio({
        phoneNumberId,
        to: row.toWaId,
        mediaId: metaMediaId,
        // `voice: true` solo es válido con ogg/opus.
        voice: media.mime.includes("ogg"),
      });
      waId = result.waMessageId;
    } else if (productMediaId) {
      // Apoyo visual: un archivo del catálogo que el vendedor manda durante la
      // conversación. Los bytes se leen acá y de a uno —el turno solo decidió
      // cuáles— y **siempre dentro de la operación del mensaje**: aunque el
      // encolado se equivocara de archivo, uno de otra operación no existe para
      // esta consulta.
      const media = await getProductMediaForSend(op, productMediaId);
      if (!media) {
        await markPermanent(
          row,
          new Error(`product media ${productMediaId} no es de la operación ${op.id}`),
          "El archivo ya no está disponible.",
        );
        return;
      }
      // La marca se vuelve a preguntar **al enviar**, no solo al encolar: entre
      // las dos cosas hay una cola, y el admin pudo apagar el interruptor
      // mientras el archivo esperaba. El que manda es el último en preguntar.
      if (!puedeEnviarse(media)) {
        await markPermanent(
          row,
          new Error(`product media ${media.id} ya no es enviable`),
          `${media.filename} ya no está marcado como enviable: no se envió.`,
        );
        return;
      }
      mediaMime = media.mime;
      // Subir una vez y reusar el id: con un catálogo que se repite —el 77% del
      // volumen es un solo producto— la alternativa es volver a subir el mismo
      // video de 16 MB en cada conversación. Es el mismo trato que ya tienen las
      // notas de voz, y la columna `meta_media_id` de `product_media` existe
      // desde la `0025` esperándolo.
      const idGuardado = media.metaMediaId;
      let metaMediaId = idGuardado;
      if (!metaMediaId) {
        const uploaded = await uploadMedia({
          phoneNumberId,
          bytes: media.bytes,
          mime: media.mime,
          filename: media.filename,
        });
        metaMediaId = uploaded.mediaId;
        await setProductMediaMetaId(op, media.id, metaMediaId);
      }
      try {
        const result = await sendMedia({
          phoneNumberId,
          to: row.toWaId,
          kind: mediaKindOf(media.mime),
          mediaId: metaMediaId,
          filename: media.filename,
        });
        waId = result.waMessageId;
      } catch (err) {
        // El id guardado tiene dos fechas de vencimiento: Meta lo conserva ~30
        // días, y está atado al número que lo subió —si la operación cambia de
        // número, el guardado deja de valer—. Un 400 con un id guardado es la
        // firma de las dos: se tira la caché y se vuelve a subir en el reintento.
        // Solo 400: la ventana cerrada es 422 y las credenciales son 401/403,
        // y volver a subir no arregla ninguna de esas.
        if (!idGuardado || !(err instanceof KapsoApiError) || err.status !== 400) {
          throw err;
        }
        await setProductMediaMetaId(op, media.id, null).catch((cacheErr) =>
          logger.error(
            { err: cacheErr, mediaId: media.id },
            "outbound: no se pudo borrar el id de Meta vencido",
          ),
        );
        logger.warn(
          { outboundId: row.id, mediaId: media.id, err: errorDetail(err) },
          "outbound: el id de Meta guardado no sirvió; se borra y se vuelve a subir en el reintento",
        );
        // Error plano a propósito: `classifyKapsoError` lo lee como transitorio,
        // así que pg-boss reintenta y el intento siguiente sube los bytes de
        // nuevo. Envuelto como KapsoApiError moriría acá con el 400.
        throw new Error(
          `id de Meta vencido para ${media.filename}: ${errorDetail(err)}`,
        );
      }
    } else if (row.templateName) {
      const params = row.templateParams ?? [];
      if (await isTemplateApproved(op, row.templateName)) {
        const result = await sendTemplate({
          phoneNumberId,
          to: row.toWaId,
          templateName: row.templateName,
          bodyParams: params,
        });
        waId = result.waMessageId;
      } else {
        // Template not (yet) approved: degrade to free text. Works whenever the
        // 24h window is open; outside it the 422 below is a permanent failure.
        const result = await sendText({
          phoneNumberId,
          to: row.toWaId,
          body: row.body,
        });
        waId = result.waMessageId;
      }
    } else {
      try {
        const result = await sendText({
          phoneNumberId,
          to: row.toWaId,
          body: row.body,
        });
        waId = result.waMessageId;
      } catch (err) {
        // Closed 24h window → retry as the caller-provided fallback template.
        if (
          isWindowClosedError(err) &&
          row.fallbackTemplateName &&
          (await isTemplateApproved(op, row.fallbackTemplateName))
        ) {
          const params = row.fallbackTemplateParams ?? [];
          const result = await sendTemplate({
            phoneNumberId,
            to: row.toWaId,
            templateName: row.fallbackTemplateName,
            bodyParams: params,
          });
          waId = result.waMessageId;
          sentBody = renderTemplateBody(row.fallbackTemplateName, params);
        } else {
          throw err;
        }
      }
    }
    if (!waId) {
      throw new Error("kapso send returned without message id");
    }
  } catch (err) {
    const kind = classifyKapsoError(err);
    if (kind === "permanent") {
      await markPermanent(row, err);
      logger.warn(
        { outboundId: row.id, err: errorDetail(err) },
        "outbound: permanent failure, marked dead",
      );
      return; // no throw → pg-boss completes the job
    }
    await markTransientFailure(row.id, err, row.attempts + 1);
    logger.warn(
      { outboundId: row.id, err: errorDetail(err) },
      "outbound: transient failure, will retry",
    );
    throw err; // pg-boss retries with backoff
  }

  await db
    .update(outboundMessages)
    .set({
      status: "sent",
      waId,
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(outboundMessages.id, row.id));

  // Mirror the outbound into messages so the chat UI shows it for every source.
  // The Cloud API sends no echo of our own messages (statuses only), so this is
  // the single write — no race to resolve.
  const convId = await resolveConversationId(row);
  if (convId) {
    const [stored] = await db
      .insert(messages)
      .values({
        conversationId: convId,
        direction: "out" as const,
        waId,
        body: sentBody,
        status: "sent" as const,
        // El hilo sirve el audio desde nuestro propio endpoint: la URL de Meta
        // caduca en 5 minutos. El apoyo visual no tiene endpoint que lo sirva y
        // por eso va sin URL: la burbuja queda con su etiqueta —«📷
        // antes-despues.jpg»—, que es lo que el asesor necesita para saber qué
        // recibió el cliente. Verlo se ve en la ficha del producto, que es donde
        // el archivo vive.
        mediaUrl: row.mediaId ? `/api/media/${row.mediaId}` : null,
        mediaMime,
        fromAgent: row.source === "agent",
        sentByUserId: row.sentByUserId ?? null,
      })
      .onConflictDoNothing({ target: messages.waId })
      .returning({ id: messages.id });
    // Contestar deja huella. Además de la fecha del saliente y la vista previa
    // —que estampa cualquier saliente, igual que antes—, una **respuesta** pone
    // el contador de sin leer en cero: hasta hoy solo lo apagaba `markRead`, o
    // sea abrir la conversación en el panel, y contestar desde el celular
    // dejaba el rojo puesto para siempre. Va acá, después de que Meta aceptó el
    // mensaje, y no al encolar: un envío que muere en la cola no contestó nada.
    // Es una sola escritura por mensaje y sin consulta previa: sale en cada
    // saliente, que hoy son ~18.700.
    const huella = huellaDelSaliente({
      waId,
      source: row.source,
      cuerpo: sentBody,
      ahora: new Date(),
    });
    if (huella) {
      await db.update(conversations).set(huella).where(eq(conversations.id, convId));
    }

    // Meta suele confirmar la entrega ANTES de que llegue este insert, y el
    // webhook no encuentra la fila que acaba de nacer. Aplicamos aquí lo que
    // ya sepamos del outbound para que el chulo no se quede en "enviado".
    if (stored) {
      const [fresh] = await db
        .select({
          deliveryStatus: outboundMessages.deliveryStatus,
          deliveryError: outboundMessages.deliveryError,
        })
        .from(outboundMessages)
        .where(eq(outboundMessages.id, row.id))
        .limit(1);
      const advanced = fresh?.deliveryStatus;
      // "pending" nunca se escribe en esta columna (solo la reporta Meta),
      // pero el enum lo permite; descartarlo mantiene el tipo honesto.
      if (advanced && advanced !== "pending" && isStatusAdvance("sent", advanced)) {
        await db
          .update(messages)
          .set({
            status: advanced,
            ...(advanced === "failed"
              ? { deliveryError: fresh.deliveryError }
              : {}),
          })
          .where(eq(messages.id, stored.id));
      }
      events.emitEvent({
        type: "message.created",
        conversationId: convId,
        messageId: stored.id,
      });
    }
  }

  logger.info(
    { outboundId: row.id, waId, source: row.source, attempts: row.attempts + 1 },
    "outbound: sent",
  );
}

export async function startOutboundWorker(): Promise<void> {
  const boss = await getBoss();
  const workerId = await boss.work<OutboundJob>(OUTBOUND_QUEUE, async (raw) => {
    const list = (Array.isArray(raw) ? raw : [raw]) as Array<{
      id?: string;
      data?: OutboundJob;
    }>;
    for (const job of list) {
      const data = (job?.data ?? job) as OutboundJob;
      if (!data?.outboundId) {
        logger.warn({ jobId: job?.id }, "outbound worker: missing outboundId");
        continue;
      }
      await handleOutbound(data);
    }
  });
  logger.info({ workerId }, "outbound worker started");
}
