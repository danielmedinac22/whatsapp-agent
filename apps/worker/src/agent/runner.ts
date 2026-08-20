import { createHash } from "node:crypto";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import {
  agentRuns,
  asc,
  conversations,
  desc,
  eq,
  getAgentSettings,
  getSalesAgentSettings,
  messages,
  requireOperationOrSole,
  salesAgentIsConfigured,
  type Contact,
  type Conversation,
} from "@wa/db";
import { parseSalesDiscountBehavior } from "@wa/shared";
import { db } from "../db";
import { logger } from "../lib/logger";
import { contactWaId } from "../lib/phone";
import { enqueueOutbound } from "../jobs/outbound";
import { loadSalesEscalationFacts } from "../sales/escalation-facts";
import { evaluateSalesEscalation } from "../sales/escalation-triggers";
import { salesReasoningOptions } from "../sales/model";
import { enqueueApoyosVisuales } from "../sales/product-media-send";
import { openrouter } from "./openrouter";
import { escalateToHuman, SALES_ESCALATION_REASON } from "./escalation";
import { buildEffectiveSystemPrompt } from "./effective-prompt";
import { buildSalesClosingTool } from "./sales-closing-tool";
import { closingPendingMessage } from "../sales/closing-messages";
import {
  resolveSalesTurnText,
  type ClosingTurnOutcome,
} from "../sales/closing-capture";

function shortHash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 12);
}

/**
 * Quién es dueño de la conversación, en la forma mínima que este runner
 * necesita.
 *
 * **No se deriva aquí.** La derivación —bandeja de `inbox/resolve.ts` contra la
 * atribución de anuncio y los pedidos— es del worktree de ingesta, que la
 * resuelve en el camino del mensaje entrante y la pasa hacia acá; el tipo real
 * es su `OwnerAgent`. Esto es su forma mínima, para adaptarla en el borde sin
 * depender del archivo mientras aterriza, y por eso usa su vocabulario.
 *
 * **Ausente significa confirmación**, que es el comportamiento de hoy: mientras
 * nadie diga que una conversación es del vendedor, contesta Katherine. Un
 * default al revés habría convertido el aterrizaje de este lote en un cambio de
 * comportamiento para Guatemala.
 */
export type OwnerAgentRef = "confirmacion" | "ventas";

interface AgentInbound {
  contact: Contact;
  conversation: Conversation;
  body: string;
  /** Quién contesta. Lo decide la ingesta; ausente = el de confirmación. */
  owner?: OwnerAgentRef;
}

type Buffered = {
  contact: Contact;
  conversation: Conversation;
  bodies: string[];
  owner: OwnerAgentRef;
  timer: NodeJS.Timeout;
};

const buffers = new Map<string, Buffered>();

/**
 * El agente contesta con el prompt, el modelo y los tiempos de la operación
 * dueña de la conversación.
 */
async function loadSettings(conversation: Conversation) {
  return getAgentSettings(await requireOperationOrSole(conversation.operationId));
}

export async function loadHistory(
  conversationId: string,
  limit: number,
): Promise<ModelMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows
    .reverse()
    .filter((m) => m.body)
    .map<ModelMessage>((m) =>
      m.direction === "in"
        ? { role: "user", content: m.body }
        : { role: "assistant", content: m.body },
    );
  void asc; // referenced from index for future ordering
}

/**
 * Cuántos turnos de historia recibe Sebastián.
 *
 * **Constante, y no `agent_settings.memory_window`**: esa columna es de
 * Katherine. Leerla para el vendedor sería exactamente la contaminación que el
 * ticket prohíbe, solo que por la puerta de atrás —no en el prompt, en los
 * parámetros—, y dejaría el tamaño de la memoria de ventas colgando de una
 * perilla de postventa que alguien va a mover un día por otro motivo. La
 * configuración de ventas no tiene campo de ventana, así que hasta que lo tenga
 * es una constante del sistema, que es como se declaran las decisiones que
 * todavía no son de nadie.
 */
const SALES_MEMORY_WINDOW = 30;

/**
 * La conversación tal como está **ahora**, no como estaba cuando entró el
 * mensaje.
 *
 * Entre el entrante y este momento pasó el debounce —ocho segundos por
 * defecto—, y en esa ventana la ingesta pudo resolver el producto o registrar
 * la atribución del anuncio. Releerla es la diferencia entre que Sebastián
 * conteste con la ficha del producto o sin ella en el primer turno, que es
 * justo el turno que decide la venta.
 */
async function reloadConversation(conversation: Conversation): Promise<Conversation> {
  const [fresh] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversation.id))
    .limit(1);
  return fresh ?? conversation;
}

/**
 * El registro del turno del vendedor.
 *
 * Existe para que el turno de cierre y el turno normal escriban la misma fila
 * por el mismo camino: la respuesta que se guarda es la que se le mandó al
 * cliente, que en un cierre no es la que el modelo escribió.
 */
async function recordRun(
  conversationId: string,
  model: string,
  prompt: ModelMessage[],
  response: string,
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
): Promise<void> {
  await db.insert(agentRuns).values({
    conversationId,
    model,
    prompt: prompt as unknown as object,
    response,
    promptTokens: usage?.inputTokens ?? null,
    completionTokens: usage?.outputTokens ?? null,
  });
}

/**
 * El turno de Sebastián. Devuelve `false` cuando la operación no tiene vendedor
 * configurado — y entonces contesta el de confirmación, que es lo de hoy.
 *
 * Antes de contestar se pregunta si debería estar contestando: los disparadores
 * de escalamiento se evalúan **primero**, porque escalar y responder son
 * excluyentes. Un lead que pidió hablar con una persona y recibe otro mensaje
 * del vendedor es exactamente la insistencia que el spec quiere quitar.
 */
async function flushSalesTurn(entry: Buffered): Promise<boolean> {
  const operation = await requireOperationOrSole(entry.conversation.operationId);
  const settings = await getSalesAgentSettings(operation);
  if (!salesAgentIsConfigured(settings)) {
    logger.info(
      { operationId: operation.id },
      "sales: la operación no tiene vendedor configurado; contesta el agente de confirmación",
    );
    return false;
  }

  const conversation = await reloadConversation(entry.conversation);

  const trigger = evaluateSalesEscalation(
    await loadSalesEscalationFacts(conversation),
  );
  if (trigger) {
    logger.info(
      { conversationId: conversation.id, trigger },
      "sales: la conversación pasa a un asesor",
    );
    await escalateToHuman({
      contact: entry.contact,
      reason: SALES_ESCALATION_REASON[trigger],
    });
    return true;
  }

  const systemPrompt = await buildEffectiveSystemPrompt({
    agent: "sales",
    operation,
    // La fila trae `discount_limit_behavior` como `text` —la columna lo es, con
    // un `check` que la cierra a tres valores—; la persona lo quiere como
    // conjunto cerrado. La conversión pasa por el único lugar que la hace, que
    // además elige `consultar` ante lo desconocido: el borde seguro.
    persona: {
      ...settings,
      discountLimitBehavior: parseSalesDiscountBehavior(
        settings.discountLimitBehavior,
      ),
    },
    productId: conversation.productId,
    // Entre qué dudó la cascada, para que la pregunta al lead salga acotada a
    // esos candidatos y no al catálogo entero. Se relee con la conversación,
    // así que el clic que acaba de entrar ya está registrado.
    candidateIds: conversation.productCandidateIds,
  });
  const prompt = await loadHistory(conversation.id, SALES_MEMORY_WINDOW);

  // Cómo terminó el cierre, si es que se disparó. Se le pasa a la herramienta y
  // se lee al volver: es cómo un `execute` que corre dentro del SDK le cuenta al
  // turno lo que hizo, sin que el runner tenga que hurgar en los pasos.
  const closing: ClosingTurnOutcome = {
    suppressModelText: false,
    result: null,
  };

  try {
    const provider = openrouter();
    const result = await generateText({
      model: provider(settings.model),
      system: systemPrompt,
      messages: prompt,
      // La herramienta del cierre va **solo cuando hay producto identificado**,
      // la misma condición con la que su bloque entra al prompt. Sin producto no
      // hay línea que armar y lo que corresponde es preguntar cuál es.
      //
      // Katherine no recibe herramientas en ningún caso: su rama de
      // `flushBuffer` no cambió una línea, que es la no-regresión de los 1.678
      // pedidos que confirma hoy.
      ...(conversation.productId
        ? {
            tools: buildSalesClosingTool({
              operation,
              contact: entry.contact,
              conversation,
              outcome: closing,
            }),
            // Dos pasos: uno para llamar la herramienta y otro para que redacte
            // con el resultado en la mano. Sin esto el SDK corta después de la
            // llamada y el turno se quedaría sin texto en los casos en que el
            // texto es lo único que sale.
            stopWhen: stepCountIs(2),
          }
        : {}),
      ...salesReasoningOptions(settings),
    });

    const to = contactWaId(entry.contact);
    if (!to) {
      logger.warn(
        { contactId: entry.contact.id },
        "sales: contact has no wa_id, cannot send",
      );
      return true;
    }

    // Quién habla en este turno lo decide una función pura, para que la regla
    // —«si el cierre habló, el modelo no habla»— se pueda probar con fixtures y
    // no viva enredada entre efectos.
    const turn = resolveSalesTurnText({
      modelText: result.text,
      closing,
      pendingMessage: closingPendingMessage(),
    });
    const body = turn.body;

    if (!body) {
      logger.info(
        {
          conversationId: conversation.id,
          closing: closing.result?.kind ?? null,
          source: turn.source,
        },
        turn.source === "suppressed"
          ? "sales: el cierre ya le escribió al cliente; el texto del modelo no sale"
          : "sales: model returned empty text",
      );
      await recordRun(conversation.id, settings.model, prompt, "", result.usage);
      return true;
    }

    await enqueueOutbound({
      to,
      body,
      source: "agent",
      sourceRef: conversation.id,
      dedupKey: `agent:${conversation.id}:${shortHash(body)}`,
      conversationId: conversation.id,
    });

    // Los archivos del producto salen **detrás** de la respuesta y por la misma
    // cola. Va después de encolar el texto y no antes por lo que pasa si algo
    // falla: el lead se queda sin fotos, nunca sin respuesta. Por eso esta
    // función no lanza — lo resuelve adentro.
    await enqueueApoyosVisuales({ operation, conversation, to });

    // Lo que se registra es **lo que salió**, no lo que el modelo redactó: en un
    // turno de cierre pueden diferir, y el registro existe para poder reconstruir
    // qué leyó el cliente.
    await recordRun(conversation.id, settings.model, prompt, body, result.usage);
  } catch (err) {
    logger.error({ err }, "sales: generateText failed");
    await db.insert(agentRuns).values({
      conversationId: conversation.id,
      model: settings.model,
      prompt: [] as unknown as object,
      response: "",
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

async function flushBuffer(contactId: string) {
  const entry = buffers.get(contactId);
  if (!entry) return;
  buffers.delete(contactId);

  // El único punto donde el runner mira quién es el dueño. Si es el vendedor y
  // la operación lo tiene configurado, contesta él y aquí termina; si no, sigue
  // el camino de siempre, sin una línea de diferencia.
  if (entry.owner === "ventas") {
    const answered = await flushSalesTurn(entry).catch((err) => {
      logger.error({ err }, "sales turn failed");
      return true;
    });
    if (answered) return;
  }

  const settings = await loadSettings(entry.conversation);
  if (!settings) {
    logger.warn(
      { operationId: entry.conversation.operationId },
      "no agent_settings configured, skipping reply",
    );
    return;
  }

  const history = await loadHistory(
    entry.conversation.id,
    Math.max(5, settings.memoryWindow ?? 30),
  );

  const prompt: ModelMessage[] = history;

  const systemPrompt = await buildEffectiveSystemPrompt({
    agent: "confirmation",
    basePrompt: settings.systemPrompt,
    contactId: entry.contact.id,
  });

  try {
    const provider = openrouter();
    const result = await generateText({
      model: provider(settings.model),
      system: systemPrompt,
      messages: prompt,
    });

    const reply = result.text.trim();
    if (!reply) {
      logger.warn("model returned empty text");
      return;
    }

    const to = contactWaId(entry.contact);
    if (!to) {
      logger.warn(
        { contactId: entry.contact.id },
        "agent: contact has no wa_id, cannot send",
      );
      return;
    }
    await enqueueOutbound({
      to,
      body: reply,
      source: "agent",
      sourceRef: entry.conversation.id,
      dedupKey: `agent:${entry.conversation.id}:${shortHash(reply)}`,
      conversationId: entry.conversation.id,
    });

    await db.insert(agentRuns).values({
      conversationId: entry.conversation.id,
      model: settings.model,
      prompt: prompt as unknown as object,
      response: reply,
      promptTokens: result.usage?.inputTokens ?? null,
      completionTokens: result.usage?.outputTokens ?? null,
    });
  } catch (err) {
    logger.error({ err }, "agent generateText failed");
    await db.insert(agentRuns).values({
      conversationId: entry.conversation.id,
      model: settings.model,
      prompt: [] as unknown as object,
      response: "",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function onAgentInbound(input: AgentInbound) {
  const settings = await loadSettings(input.conversation);
  const debounceMs = Math.max(0, settings?.debounceMs ?? 8000);

  const existing = buffers.get(input.contact.id);
  if (existing) {
    clearTimeout(existing.timer);
    existing.bodies.push(input.body);
    // La propiedad se deriva en cada entrante, así que manda la del último: un
    // clic de anuncio en mitad de una ráfaga es intención de compra nueva.
    existing.owner = input.owner ?? existing.owner;
    existing.timer = setTimeout(
      () => flushBuffer(input.contact.id),
      debounceMs,
    );
    return;
  }

  const entry: Buffered = {
    contact: input.contact,
    conversation: input.conversation,
    bodies: [input.body],
    // La propiedad se decide en cada entrante y no se guarda en ninguna parte;
    // lo que el buffer conserva es la del mensaje que lo abrió, que es el turno
    // que se va a contestar.
    owner: input.owner ?? "confirmacion",
    timer: setTimeout(() => flushBuffer(input.contact.id), debounceMs),
  };
  buffers.set(input.contact.id, entry);
}
