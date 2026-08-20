import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { eq, messageMedia, users } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { getKapsoConnection } from "../kapso/connection";
import { isTemplateApproved } from "../kapso/provisioning";
import {
  renderTemplateBody,
  sanitizeParam,
  templateByName,
} from "../kapso/templates";
import { esIdDeUsuario } from "../lib/atribucion";
import { normalizePhone } from "../lib/phone";
import { enqueueOutbound } from "../jobs/outbound";
import {
  getConversationOperationId,
  getOperationIdByWaId,
  panelOperation,
  requireOperationOrSole,
} from "../operations";

export const wa = new Hono();

/**
 * Sirve los bytes de una nota de voz (nuestra o del cliente). El hilo apunta
 * aquí porque la URL de Meta caduca en 5 minutos y la de Kapso exige API key.
 */
wa.get("/media/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "bad id" }, 400);
  const [media] = await db
    .select()
    .from(messageMedia)
    .where(eq(messageMedia.id, id))
    .limit(1);
  if (!media) return c.json({ error: "not found" }, 404);
  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "content-type": media.mime,
      "content-length": String(media.byteSize),
      // Los bytes son inmutables: se cachean sin miedo.
      "cache-control": "private, max-age=31536000, immutable",
      "accept-ranges": "none",
    },
  });
});

/**
 * Connection status — fed by kapso_connection (no QR/session lifecycle).
 * La conexión que se reporta es la de la operación elegida en el riel. Ya no es
 * `null` = la fila singleton = Guatemala.
 */
wa.get("/status", async (c) => {
  const conn = await getKapsoConnection(await panelOperation(c));
  return c.json({
    status: conn?.phoneNumberId ? "connected" : "disconnected",
    phone: conn?.displayPhoneNumber ?? null,
    phoneNumberId: conn?.phoneNumberId ?? null,
    displayName: conn?.displayName ?? null,
    kind: conn?.kind ?? null,
    connectedAt: conn?.connectedAt ?? null,
  });
});

/**
 * Quién mandó el mensaje, si el panel lo dijo.
 *
 * Los tres envíos manuales de acá son los únicos que tienen una persona detrás,
 * y hasta hoy no la anotaban: `messages.sent_by_user_id` está en `null` en los
 * 19.281 salientes de producción. La tubería ya existía —`enqueueOutbound`
 * acepta el parámetro y lo persiste—; lo que faltaba era que alguien se lo
 * pasara. El panel es quien sabe el valor (ticket 03); esta mitad lo recibe, lo
 * comprueba y lo guarda, y funciona con `null` mientras tanto.
 *
 * Nunca hace fallar el envío, y por eso no vive en el esquema de zod: la
 * atribución es un dato de más, el mensaje es el trabajo, y este es el camino
 * del número que factura. `sent_by_user_id` es clave foránea a `users`, así que
 * un identificador inventado reventaría el insert del outbox y el asesor vería
 * «no se pudo enviar» por un campo que no tiene nada que ver con enviar. Ante
 * cualquier duda: se envía igual, sin atribuir, y queda el aviso en el log.
 *
 * La consulta solo corre cuando el panel manda algo, y el envío manual son 352
 * de los 18.712 mensajes que salieron.
 */
async function usuarioQueEnvia(valor: unknown): Promise<string | null> {
  if (valor === undefined || valor === null || valor === "") return null;
  if (!esIdDeUsuario(valor)) {
    logger.warn(
      { sentByUserId: valor },
      "wa: sentByUserId con forma inválida; el mensaje sale sin atribuir",
    );
    return null;
  }
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, valor))
    .limit(1);
  if (!user) {
    logger.warn(
      { sentByUserId: valor },
      "wa: sentByUserId no corresponde a ningún usuario; el mensaje sale sin atribuir",
    );
    return null;
  }
  return user.id;
}

const sendSchema = z
  .object({
    to: z.string().min(5).optional(),
    // Legacy field from the web inbox — a Baileys JID or raw phone.
    jid: z.string().min(5).optional(),
    body: z.string().min(1).max(4096),
    // `unknown` y no `uuid()`: ver `usuarioQueEnvia`. Un valor mal formado no
    // puede convertir un envío en un 400.
    sentByUserId: z.unknown().optional(),
  })
  .refine((v) => v.to || v.jid, { message: "to (wa_id) is required" });

wa.post("/send", async (c) => {
  const parsed = sendSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const { to, jid, body } = parsed.data;
  const waId = normalizePhone(to ?? jid!.split("@")[0]);
  if (!waId) return c.json({ error: "invalid destination" }, 400);
  const { outboundId } = await enqueueOutbound({
    to: waId,
    body,
    source: "manual",
    dedupKey: `manual:${randomUUID()}`,
    sentByUserId: await usuarioQueEnvia(parsed.data.sentByUserId),
  });
  // Estado que se le muestra al asesor tras encolar; el envío en sí resuelve su
  // propia operación desde la conversación (ver `jobs/outbound.ts`).
  const conn = await getKapsoConnection(await panelOperation(c));
  return c.json({
    ok: true,
    outboundId,
    status: conn?.phoneNumberId ? "connected" : "disconnected",
  });
});

/** Tope del lado servidor; la UI ya corta a 2 minutos de grabación. */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const ALLOWED_AUDIO_MIME = [
  "audio/ogg",
  "audio/ogg; codecs=opus",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/amr",
];

/**
 * Nota de voz del asesor. Recibe el archivo (multipart), lo guarda para poder
 * reproducirlo en el hilo y lo encola en el outbox: así hereda reintentos,
 * dedup y chulos de entrega como cualquier otro envío.
 */
wa.post("/send-audio", async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  const to = form?.get("to");
  if (!(file instanceof File) || typeof to !== "string") {
    return c.json({ error: "file y to son obligatorios" }, 400);
  }
  const waId = normalizePhone(to);
  if (!waId) return c.json({ error: "invalid destination" }, 400);

  const mime = (file.type || "audio/ogg").toLowerCase();
  if (!ALLOWED_AUDIO_MIME.some((m) => mime.startsWith(m.split(";")[0]!))) {
    return c.json({ error: `formato de audio no soportado: ${mime}` }, 415);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength === 0) return c.json({ error: "audio vacío" }, 400);
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    return c.json({ error: "la nota de voz es demasiado larga" }, 413);
  }

  const durationRaw = form?.get("durationMs");
  const durationMs =
    typeof durationRaw === "string" && Number.isFinite(Number(durationRaw))
      ? Math.round(Number(durationRaw))
      : null;
  const conversationId = form?.get("conversationId");

  const [media] = await db
    .insert(messageMedia)
    .values({
      mime,
      bytes,
      byteSize: bytes.byteLength,
      durationMs,
      source: "outbound",
    })
    .returning({ id: messageMedia.id });
  if (!media) return c.json({ error: "no se pudo guardar el audio" }, 500);

  const { outboundId } = await enqueueOutbound({
    to: waId,
    body: "🎤 Nota de voz",
    source: "manual",
    dedupKey: `manual-audio:${randomUUID()}`,
    conversationId:
      typeof conversationId === "string" && conversationId ? conversationId : null,
    sentByUserId: await usuarioQueEnvia(form?.get("sentByUserId")),
    media: { id: media.id, kind: "audio" },
  });
  return c.json({ ok: true, outboundId, mediaId: media.id });
});

const sendTemplateSchema = z.object({
  to: z.string().min(5),
  templateName: z.string().min(1),
  params: z.array(z.string()).default([]),
  conversationId: z.string().uuid().optional(),
  // Ver `usuarioQueEnvia`: se comprueba en el borde, no en el esquema.
  sentByUserId: z.unknown().optional(),
});

/**
 * Operator-initiated template send — the "reopen conversation" path for
 * threads outside the Meta 24h window. Only catalog templates approved for
 * the current WABA are sendable.
 */
wa.post("/send-template", async (c) => {
  const parsed = sendTemplateSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const { to, templateName, params, conversationId } = parsed.data;

  const waId = normalizePhone(to);
  if (!waId) return c.json({ error: "invalid destination" }, 400);
  const def = templateByName(templateName);
  if (!def) return c.json({ error: "unknown template" }, 400);
  const expected = def.params.length;
  if (params.length !== expected) {
    return c.json(
      { error: `template expects ${expected} params, got ${params.length}` },
      400,
    );
  }
  // La plantilla se aprueba por WABA, y la WABA es la de la operación del
  // destinatario. Sin conversación todavía, el puente de la operación única.
  const op = await requireOperationOrSole(
    conversationId
      ? await getConversationOperationId(conversationId)
      : await getOperationIdByWaId(waId),
  );
  if (!(await isTemplateApproved(op, templateName))) {
    return c.json({ error: "template not approved for this WABA" }, 409);
  }

  const clean = params.map((p) => sanitizeParam(p));
  const { outboundId } = await enqueueOutbound({
    to: waId,
    body: renderTemplateBody(templateName, clean),
    source: "manual",
    dedupKey: `manual-template:${randomUUID()}`,
    conversationId: conversationId ?? null,
    sentByUserId: await usuarioQueEnvia(parsed.data.sentByUserId),
    template: { name: templateName, params: clean },
  });
  return c.json({ ok: true, outboundId });
});
