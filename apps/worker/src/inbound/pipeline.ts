import { eq } from "@wa/db";
import {
  contacts,
  conversations,
  messageMedia,
  messages,
  type Conversation,
} from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { events } from "../lib/events";
import { instantaneaDe } from "../lib/eventos";
import { onAgentInbound } from "../agent/runner";
import { scheduleConfirmationClassify } from "../agent/confirmation-classifier";
import { escalateToHuman } from "../agent/escalation";
import { handleInboundConfirmation } from "../jobs/confirmation-ack";
import { tryHandleDropi2FAInbound } from "../dropi/2fa-inbound";
import { markNovedadCustomerReply } from "../dropi/novedad-reply";
import { fetchKapsoMedia, markRead } from "../kapso/client";
import { resolveInboundOperation } from "../kapso/connection";
import type { ParsedAdReferral, ParsedInboundMessage } from "../kapso/inbound";
import {
  resolveInbox,
  type InboxDecision,
  type SalesAgentSettings,
} from "@wa/db";
import { loadOrderFacts } from "../inbox/facts";
import type { OperationId } from "../operations";
import { decideAdAttribution } from "../sales/attribution";
import { recognizeProductForReferral } from "../sales/catalog";
import { registerRecognition } from "../sales/recognition-record";
import {
  resolveConversationOwner,
  type ConversationOwner,
} from "../sales/owner";
import { getSalesAgentSettings, salesAgentIsConfigured } from "../sales/settings";
import { upsertContactByWaId } from "./contacts";

/**
 * Copia el audio entrante a `message_media`. Best-effort: si Kapso no da URL o
 * la descarga falla, el mensaje se guarda igual (sin reproductor) — perder el
 * audio no puede costar el mensaje.
 */
async function storeInboundAudio(
  parsed: ParsedInboundMessage,
): Promise<{ id: string; mime: string } | null> {
  if (!parsed.mediaUrl) return null;
  try {
    const { bytes, mime } = await fetchKapsoMedia(parsed.mediaUrl);
    if (bytes.byteLength === 0) return null;
    const resolved = parsed.mediaMime ?? mime;
    const [row] = await db
      .insert(messageMedia)
      .values({
        mime: resolved,
        bytes,
        byteSize: bytes.byteLength,
        source: "inbound",
      })
      .returning({ id: messageMedia.id });
    return row ? { id: row.id, mime: resolved } : null;
  } catch (err) {
    logger.warn(
      { err: String(err), waId: parsed.waMessageId },
      "inbound: no se pudo guardar el audio del cliente",
    );
    return null;
  }
}

/**
 * La conversación del contacto, con su operación.
 *
 * «La conversación guarda su operación y la conserva de principio a fin»: una
 * conversación que ya tiene operación **no se reescribe**, ni siquiera si el
 * entrante llegó por otro número. Cambiarle el país a una conversación viva
 * movería su historial de operación a mitad de camino; si eso llega a pasar es
 * un caso a mirar, no algo que el pipeline deba resolver solo.
 */
async function ensureConversation(
  contactId: string,
  operationId: OperationId | null,
): Promise<Conversation> {
  const existing = await db
    .select()
    .from(conversations)
    .where(eq(conversations.contactId, contactId))
    .limit(1);
  const conv = existing[0];
  if (conv) {
    if (conv.operationId || !operationId) return conv;
    const [updated] = await db
      .update(conversations)
      .set({ operationId })
      .where(eq(conversations.id, conv.id))
      .returning();
    return updated ?? conv;
  }
  const [created] = await db
    .insert(conversations)
    .values({ contactId, operationId })
    .returning();
  return created!;
}

/**
 * Reconoce el producto del anuncio y **deja registrado cómo terminó**.
 *
 * Corre **después** de que la atribución ya está guardada y por eso puede
 * fallar sin costo: el identificador de anuncio y el de clic —lo irrecuperable—
 * ya están en la base, y el producto se deriva de ellos, así que un fallo aquí
 * deja la conversación sin producto, que es justo el estado que hace que el
 * vendedor pregunte.
 *
 * Desde la `0026` se escribe **siempre**, no solo cuando resuelve: sin eso,
 * «ambiguo» y «no encontré nada» dejaban la misma huella —un `product_id` en
 * `null`— y piden cosas opuestas del asesor. Lo que no cambió es lo que se hace
 * con el producto: se escribe solo cuando la cascada resolvió, porque elegir
 * uno de varios candidatos es mandarle al cliente información del SKU
 * equivocado. La pregunta con lista corta es del ticket 05 y sale de los
 * candidatos que esto registra.
 */
async function attributeProduct(input: {
  conversationId: string;
  operationId: OperationId;
  referral: ParsedAdReferral;
}): Promise<void> {
  const recognition = await recognizeProductForReferral({
    operationId: input.operationId,
    referral: input.referral,
  });
  const registered = await registerRecognition({
    recognition,
    save: (record) =>
      db
        .update(conversations)
        .set(record)
        .where(eq(conversations.id, input.conversationId)),
    onFailure: (err) =>
      logger.error(
        {
          err: String(err),
          conversationId: input.conversationId,
          kind: recognition.kind,
        },
        "ventas: NO se pudo registrar cómo terminó el reconocimiento; el mensaje sigue su curso",
      ),
  });
  logger.info(
    {
      conversationId: input.conversationId,
      adId: input.referral.adId,
      kind: recognition.kind,
      level: recognition.kind === "unknown" ? null : recognition.level,
      reason: recognition.kind === "unknown" ? recognition.reason : null,
      candidatos:
        recognition.kind === "ambiguous" ? recognition.candidates.length : null,
      registrado: registered,
    },
    "ventas: reconocimiento de producto",
  );
}

/**
 * La configuración del vendedor de la operación que recibió el mensaje.
 *
 * De ella salen las dos cosas que el camino de ventas necesita: si hay vendedor
 * —el listón único, `salesAgentIsConfigured`: encendido y con nombre, no la
 * existencia de la fila— y **cuándo se encendió**, que es la línea de corte de
 * la bandeja. Se lee una sola vez por mensaje y se pasa hecha; la lectura está
 * cacheada por operación.
 *
 * Es el único interruptor de no-regresión del camino de ventas —el riesgo R8—.
 * Con `sales_agent_settings` a medio llenar, que es producción hoy, la respuesta
 * es siempre «no hay vendedor» y nada de lo nuevo se enciende.
 *
 * **Nunca lanza, y eso es la mitad del sentido de esta función.** Se pregunta
 * *antes* de crear el contacto, así que un error aquí sin atrapar se llevaría el
 * mensaje del cliente por delante — el pipeline entero está construido sobre lo
 * contrario. Si la lectura falla, el contacto nace apagado, que es el
 * comportamiento de siempre.
 */
async function readSalesAgentSettings(
  operationId: OperationId | null,
): Promise<SalesAgentSettings | null> {
  if (!operationId) return null;
  try {
    return await getSalesAgentSettings(operationId);
  } catch (err) {
    logger.error(
      { err: String(err), operationId },
      "ventas: no se pudo leer la configuración del vendedor; el contacto nuevo nace apagado",
    );
    return null;
  }
}

/**
 * Qué agente es dueño de la conversación en este momento.
 *
 * **No se guarda en ninguna columna**: se deriva de la bandeja, que a su vez se
 * deriva de la atribución y de los pedidos, y queda anotado en el log. Ver
 * `sales/owner.ts` para el porqué.
 *
 * Sin vendedor configurado no se consulta ni un pedido: es el riesgo R8 de la
 * no-regresión —esta lógica no puede cambiar el comportamiento del número que
 * hoy factura— y hoy, con Guatemala como única operación y sin vendedor, este
 * camino no cuesta ni una consulta. El vendedor ya se resolvió arriba, antes de
 * crear el contacto, y se pasa hecho: preguntarlo dos veces sería leer dos veces
 * lo mismo para responder lo mismo.
 */
async function resolveOwner(input: {
  contactId: string;
  salesAgentConfigured: boolean;
  lastAdClickAt: Date | null;
  /** `sales_agent_settings.activated_at` de la operación. */
  salesActivatedAt: Date | null;
  /** Cuándo nació esta conversación: la mitad de la línea de corte. */
  bornAt: Date;
}): Promise<{ owner: ConversationOwner; inbox: InboxDecision | null }> {
  if (!input.salesAgentConfigured) {
    return {
      owner: resolveConversationOwner({ salesAgentConfigured: false }),
      inbox: null,
    };
  }
  const inbox = resolveInbox(
    {
      lastAdClickAt: input.lastAdClickAt,
      orders: await loadOrderFacts(input.contactId),
    },
    { activatedAt: input.salesActivatedAt, bornAt: input.bornAt },
  );
  return {
    owner: resolveConversationOwner({
      salesAgentConfigured: true,
      inbox: inbox.inbox,
    }),
    inbox,
  };
}

/**
 * Inbound pipeline: persist + fan out one normalized Kapso message.
 * Replaces the Baileys `messages.upsert` handler; everything downstream of
 * persistence (2FA interceptor, audio escalation, confirmation flow, agent)
 * is unchanged from the Baileys era.
 */
export async function handleInbound(parsed: ParsedInboundMessage): Promise<void> {
  const hasAudio = parsed.kind === "audio";

  // A qué operación pertenece el mensaje, según el número que lo recibió.
  // Este es el primer punto del sistema donde el `phone_number_id` del webhook
  // decide algo: antes solo servía para el acuse de lectura.
  //
  // La resolución es estricta, pero el pipeline NO descarta. Un número que no
  // reconocemos deja un error en el log y el mensaje sigue su curso con la
  // operación única: un entrante descartado en silencio es la operación muda
  // sin que salte ninguna alarma. Si la resolución falla del todo, el mensaje
  // se procesa igual, sin operación.
  const decision = await resolveInboundOperation(parsed.phoneNumberId).catch(
    (err): null => {
      logger.error(
        { err: String(err), phoneNumberId: parsed.phoneNumberId },
        "inbound: no se pudo resolver la operación; el mensaje se procesa igual",
      );
      return null;
    },
  );
  if (decision?.connectionIsUnknown) {
    logger.error(
      {
        phoneNumberId: parsed.phoneNumberId,
        waId: parsed.waMessageId,
        operationId: decision.operationId,
        atendidoPorLaOperacionUnica: decision.usedSingleOperationFallback,
      },
      "inbound: el número que recibió el mensaje no pertenece a ninguna conexión conocida",
    );
  }

  // Con qué `agent_mode` nace el contacto **si resulta ser nuevo**.
  //
  // Se pregunta aquí y no más abajo porque «contacto nuevo» es un momento —el
  // `INSERT`— y después no vuelve a ocurrir: es lo que hace que un asesor que
  // apagó al agente no lo vea volver. La lectura es la misma, cacheada por
  // operación, que el dueño de la conversación hacía más abajo; ahora se hace
  // una sola vez y se pasa hecha.
  const seller = await readSalesAgentSettings(decision?.operationId ?? null);
  const salesAgentConfigured = salesAgentIsConfigured(seller);

  const contact = await upsertContactByWaId(
    parsed.from,
    { pushName: parsed.contactName },
    { origin: "inbound_message", salesAgentConfigured },
  );
  const conv = await ensureConversation(
    contact.id,
    decision?.operationId ?? null,
  );

  // ── Atribución del anuncio ───────────────────────────────────────────────
  //
  // Va aquí, antes de guardar el mensaje, porque es el único dato del sistema
  // que **no se puede recuperar**: no existe endpoint de Meta para pedir la
  // referencia después del hecho, y solo viaja en el primer mensaje. Se
  // escribe entera y de una sola vez —el identificador de anuncio y el de clic
  // juntos— y **solo cuando el mensaje la trae**: sin referencia no hay ni una
  // consulta ni una escritura de más, que es el caso de todos los mensajes de
  // Guatemala. Reescribirla si el webhook se reintenta es inocuo: el instante
  // sale del propio mensaje, así que la segunda escritura es idéntica.
  const attribution = decideAdAttribution({
    stored: conv,
    referral: parsed.adReferral,
    receivedAt: parsed.receivedAt,
  });
  if (attribution.write) {
    try {
      await db
        .update(conversations)
        .set(attribution.write)
        .where(eq(conversations.id, conv.id));
      logger.info(
        {
          conversationId: conv.id,
          adId: attribution.write.adId,
          tieneClid: attribution.write.ctwaClid !== null,
          ruta: parsed.adReferral?.path,
          pisaAtribucionAnterior: attribution.overwritesPreviousReferral,
        },
        "ingesta: atribución de anuncio guardada",
      );
    } catch (err) {
      // Perder la referencia es irreversible, pero perder el mensaje del
      // cliente además sería peor: se sigue procesando. El error va con la
      // referencia entera porque los Logs del proveedor guardan el cuerpo
      // exacto solo 7 días, y esta línea es lo que permite recuperarla a mano.
      logger.error(
        {
          err: String(err),
          conversationId: conv.id,
          referral: parsed.adReferral,
        },
        "ingesta: NO se pudo guardar la atribución del anuncio; la referencia se pierde",
      );
    }
  }

  // Los audios se copian a nuestro almacenamiento: la URL de Kapso exige API
  // key, así que el navegador del asesor no puede reproducirla directamente.
  const media = hasAudio ? await storeInboundAudio(parsed) : null;

  const [stored] = await db
    .insert(messages)
    .values({
      conversationId: conv.id,
      direction: "in",
      waId: parsed.waMessageId,
      body: parsed.text,
      status: "delivered",
      mediaUrl: media ? `/api/media/${media.id}` : null,
      mediaMime: media?.mime ?? null,
    })
    .onConflictDoNothing({ target: messages.waId })
    .returning();

  // Duplicate delivery (webhook retry) — already processed.
  if (!stored) return;

  const now = new Date();
  // Lo que la conversación pasa a decir, con nombre porque **lo que se escribe
  // es exactamente lo que viaja en el evento**. El panel repinta la fila con
  // esto en vez de volver a pedir la pantalla entera, y que salga de la
  // escritura que ya estaba es lo que hace que enriquecer el evento no cueste
  // ni una consulta más: acá no se lee nada que no estuviera en la mano.
  const huella = {
    lastMessagePreview: parsed.text.slice(0, 200),
    lastInboundAt: now,
    unreadCount: (conv.unreadCount ?? 0) + 1,
  };
  await db
    .update(conversations)
    .set(huella)
    .where(eq(conversations.id, conv.id));
  await db
    .update(contacts)
    .set({ lastMessageAt: now })
    .where(eq(contacts.id, contact.id));

  events.emitEvent({
    type: "message.created",
    // La operación de la conversación, que la ingesta resolvió por el número
    // que recibió el mensaje. Es lo que impide que este entrante mueva la
    // bandeja del otro país.
    operationId: conv.operationId,
    conversationId: conv.id,
    messageId: stored.id,
    // `conv` es la fila de antes de la escritura; `huella` es lo que acaba de
    // cambiar. Juntas son la fila como quedó.
    conversation: instantaneaDe({ ...conv, ...huella }),
  });

  // Blue ticks + typing indicator (typing only when the agent will answer).
  markRead({
    phoneNumberId: parsed.phoneNumberId,
    messageId: parsed.waMessageId,
    // Con transcripción el agente sí va a contestar el audio, así que el
    // "escribiendo…" corresponde.
    typing: contact.agentMode && (!hasAudio || Boolean(parsed.transcript)),
  }).catch(() => {
    /* best-effort */
  });

  // ── Ventas: producto del anuncio y agente dueño ──────────────────────────
  //
  // Nada de esto puede costarle el mensaje al cliente: va después de que el
  // mensaje está guardado y anunciado al panel, y cada mitad atrapa su propio
  // error. El reconocimiento solo corre cuando **este** mensaje trajo
  // referencia: un mensaje posterior —incluida una respuesta de botón— ya
  // tiene su producto y su anuncio guardados en la conversación, y volver a
  // reconocer sería pedirle a la cascada que resuelva sin referencia.
  const referral = parsed.adReferral;
  if (referral && decision?.operationId) {
    await attributeProduct({
      conversationId: conv.id,
      operationId: decision.operationId,
      referral,
    }).catch((err) =>
      logger.error(
        { err: String(err), conversationId: conv.id },
        "ventas: el reconocimiento de producto falló; la atribución ya está guardada",
      ),
    );
  } else if (referral) {
    // El catálogo es el de la operación, así que sin operación no hay contra
    // qué reconocer. La atribución sí quedó guardada, que es lo irrecuperable.
    logger.warn(
      { conversationId: conv.id, adId: referral.adId },
      "ventas: referencia de anuncio sin operación conocida; sin reconocimiento de producto",
    );
  }

  const ownership = await resolveOwner({
    contactId: contact.id,
    salesAgentConfigured,
    lastAdClickAt: attribution.effective.adReferralAt,
    salesActivatedAt: seller?.activatedAt ?? null,
    bornAt: conv.createdAt,
  }).catch((err): null => {
    logger.error(
      { err: String(err), conversationId: conv.id },
      "ventas: no se pudo derivar el dueño de la conversación",
    );
    return null;
  });
  if (ownership) {
    // `info` solo cuando hay algo que mirar —un vendedor en juego—, `debug`
    // para el caso de siempre: hoy, con una sola operación y sin vendedor
    // configurado, esta línea no aparece en producción y el volumen del log
    // queda exactamente como estaba.
    const level = ownership.owner.agent === "ventas" ? "info" : "debug";
    logger[level](
      {
        conversationId: conv.id,
        agente: ownership.owner.agent,
        regla: ownership.owner.rule,
        bandeja: ownership.inbox?.inbox ?? null,
        reglaBandeja: ownership.inbox?.rule ?? null,
      },
      "ingesta: agente dueño de la conversación",
    );
  }

  // Interceptor 2FA Dropi: si es del admin y trae código, canjea sin pasar
  // por confirmation-ack ni el agente.
  const handled2fa = await tryHandleDropi2FAInbound({
    contact,
    body: parsed.text,
  }).catch((err) => {
    logger.error({ err }, "dropi 2fa interceptor failed");
    return false;
  });
  if (handled2fa) return;

  // Audio inbound: con transcripción de Kapso sigue el pipeline normal (el
  // agente puede responder sobre el texto). Sin transcripción no hay nada que
  // leer, así que se escala a humano como siempre.
  if (hasAudio && !parsed.transcript) {
    await escalateToHuman({ contact, reason: "audio_message" }).catch((err) =>
      logger.error({ err }, "audio escalation failed"),
    );
    return;
  }

  if (!parsed.text) return; // caption-less media: stored, nothing to act on

  // Si el contacto tiene una novedad activa esperando respuesta, marcarla.
  void markNovedadCustomerReply(contact.id);

  scheduleConfirmationClassify({
    conversationId: conv.id,
    contactId: contact.id,
  });

  const acked = await handleInboundConfirmation({
    contact,
    conversation: conv,
  }).catch((err) => {
    logger.error({ err }, "confirmation-ack failed");
    return false;
  });

  if (!acked && contact.agentMode) {
    onAgentInbound({
      contact,
      conversation: conv,
      body: parsed.text,
      // El dueño se derivó arriba y hasta ahora solo se registraba en el log:
      // sin pasarlo aquí, el runner caía siempre a `confirmacion` y el vendedor
      // no contestaba nunca. Con `sales_agent_settings` vacía —que es el estado
      // de producción hoy— `resolveOwner` devuelve `confirmacion` igual, así que
      // esto no cambia el comportamiento de Guatemala.
      owner: ownership?.owner.agent,
    }).catch((err) => logger.error({ err }, "agent runner failed"));
  }
}
