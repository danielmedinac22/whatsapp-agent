/**
 * La herramienta con la que Sebastián entrega los datos del cliente.
 *
 * **Es el eslabón que faltaba, y es una llamada, no un módulo.** Todo el camino
 * del cierre —validación, clamp del descuento, idempotencia, modo seco, cola de
 * reintentos y alerta— estaba construido y probado desde la ola 3; lo único que
 * no existía era la forma de dispararlo desde una conversación. Este archivo es
 * esa forma, y por eso es tan delgado: resuelve la línea contra la tienda,
 * traduce lo capturado y llama a `closeSale()`. Nada de lo que decide vive acá.
 *
 * ## Tool calling, y por qué no un bloque de texto parseado
 *
 * Es la decisión de diseño del encargo y **se midió antes de construir**, porque
 * el proyecto tiene el antecedente de `reasoning_effort`: un campo que se
 * guarda, se lee, se pasa y no llega al proveedor, porque el SDK de OpenRouter
 * descarta `providerOptions`. El mapa además decía que el agente corre hoy «sin
 * tool calls», así que este es el primer camino que las usa.
 *
 * La medición fue una llamada real contra el proveedor, con el modelo de
 * producción (`openai/gpt-5.4-mini`) y la misma construcción del cliente que usa
 * el runner: la herramienta llegó, el modelo la llamó con los campos completos,
 * `execute` corrió y el modelo tomó un turno más con el resultado. Cero
 * advertencias del SDK. Y se verificó en su `doGenerate` que `tools` y
 * `toolChoice` **sí** viajan en el cuerpo de la petición —están en la misma
 * lista fija de campos que descarta `providerOptions`—, así que no es una
 * casualidad de una corrida.
 *
 * El plan B —pedirle un bloque estructurado en el texto y parsearlo— habría
 * necesitado además un mecanismo para que ese bloque no se le escapara al
 * cliente dentro del mensaje. No hizo falta.
 *
 * ## Lo que la herramienta no deja hacer
 *
 * El modelo no escribe el precio ni el id de la variante: los resuelve
 * {@link resolveClosingLine} contra la tienda, en tiempo de uso, igual que la
 * ficha del producto. Un precio que el modelo pueda escribir es un precio que el
 * modelo puede equivocar, y en contraentrega eso se descubre con el repartidor
 * en la puerta.
 */

import { tool } from "ai";
import { eq, products, type Contact, type Conversation, type Operation } from "@wa/db";
import { db } from "../db";
import { logger } from "../lib/logger";
import { getProductsByIds, type ShopifyVariant } from "../shopify/admin";
import { closeSale } from "../sales/closing";
import type { ClosingLine } from "../sales/order";
import {
  capturedToClosing,
  CLOSING_TOOL_NAME,
  closingCaptureSchema,
  closingToolReport,
  closingTurnVoice,
  MAX_QUANTITY,
  pickVariant,
  quantityOutOfRange,
  type ClosingCapture,
  type ClosingTurnOutcome,
} from "../sales/closing-capture";
import { escalateToHuman } from "./escalation";

/** Lo que la línea del pedido necesita, o por qué no se pudo armar. */
type LineResolution =
  | { kind: "ok"; line: ClosingLine }
  /** La conversación no tiene producto, o el producto no es de esta operación. */
  | { kind: "no_product" }
  /** El producto existe pero la tienda no ofrece nada vendible de él. */
  | { kind: "not_sellable"; detail: string }
  /** Varias presentaciones y el cliente no dijo cuál. Se le pregunta. */
  | { kind: "ambiguous_variant"; options: readonly string[] };

/**
 * La línea del pedido, resuelta contra la tienda de la operación.
 *
 * Lee el producto que el reconocimiento dejó en la conversación, comprueba que
 * sea de esta operación —la columna es suelta y no tiene clave foránea compuesta
 * que lo garantice— y saca de la tienda la variante, su id y su precio.
 *
 * **Un producto nativo no se puede vender hoy**, y hay que decirlo en vez de
 * fabricar un precio: `products` no tiene columna de precio (la `0022` le dio el
 * mínimo que el reconocimiento necesitaba) y sin precio no hay línea. Va a una
 * persona, que es lo que corresponde a un problema del sistema.
 */
async function resolveClosingLine(
  operation: Operation,
  productId: string | null,
  capture: ClosingCapture,
): Promise<LineResolution> {
  if (!productId) return { kind: "no_product" };

  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!row) return { kind: "no_product" };
  if (row.operationId !== operation.id) {
    logger.warn(
      { productId, operationId: operation.id, productOperationId: row.operationId },
      "cierre: el producto de la conversación es de otra operación",
    );
    return { kind: "no_product" };
  }

  if (row.source === "native" || !row.shopifyProductId) {
    return {
      kind: "not_sellable",
      detail:
        "el producto no está conectado a la tienda y no tiene precio con el que armar la línea",
    };
  }

  const [live] = await getProductsByIds(operation, [row.shopifyProductId]);
  if (!live) {
    return {
      kind: "not_sellable",
      detail: "la tienda no devolvió el producto al armar el pedido",
    };
  }

  // Solo las disponibles: cerrar sobre una presentación agotada es una venta que
  // se cae al día siguiente, y en contraentrega se cae después de despachar.
  const sellable = live.variants.filter(
    (v: ShopifyVariant) => v.available && v.price !== null,
  );
  const pick = pickVariant(sellable, capture.presentacion);
  if (pick.kind === "none") {
    return {
      kind: "not_sellable",
      detail: "la tienda no tiene ninguna presentación disponible con precio",
    };
  }
  if (pick.kind === "ambiguous") {
    return { kind: "ambiguous_variant", options: pick.options };
  }

  const unitPrice = Number(pick.variant.price);
  if (!Number.isFinite(unitPrice)) {
    return {
      kind: "not_sellable",
      detail: `la tienda devolvió un precio ilegible (${pick.variant.price})`,
    };
  }

  const variantTitle = pick.variant.title;
  return {
    kind: "ok",
    line: {
      productId: row.id,
      variantId: pick.variant.id,
      // El título que va al pedido lleva la presentación cuando la hay: es lo
      // que el cliente lee en el mensaje de confirmación y lo que el equipo ve
      // en la tienda, y «Colágeno» a secas no alcanza para despachar.
      title:
        variantTitle && variantTitle !== "Default Title"
          ? `${live.title} — ${variantTitle}`
          : live.title,
      quantity: capture.cantidad,
      unitPrice,
    },
  };
}

/**
 * La herramienta del turno de venta, atada a esta conversación.
 *
 * Se fabrica por turno y no es una constante porque necesita el contacto y la
 * conversación: el cierre es de **este** lead, y el `leadRef` del que sale la
 * llave de idempotencia es el id de su conversación. Una herramienta global
 * tendría que recibirlos del modelo, que es exactamente de dónde no pueden
 * salir.
 */
export function buildSalesClosingTool(ctx: {
  operation: Operation;
  contact: Contact;
  conversation: Conversation;
  /** Se rellena con cómo terminó el cierre; lo lee el runner al volver. */
  outcome: ClosingTurnOutcome;
}) {
  return {
    [CLOSING_TOOL_NAME]: tool({
      description:
        "Registra el pedido del cliente con los datos que te dio en la conversación. " +
        "Llámala solo cuando ya tengas nombre, apellido, teléfono, departamento, municipio " +
        "y dirección (o que reclama en oficina). El sistema valida los datos, crea el pedido " +
        "y le confirma al cliente por este mismo chat.",
      inputSchema: closingCaptureSchema,
      execute: async (capture: ClosingCapture) => {
        // Una cantidad fuera de rango no se recorta ni se rechaza: se pasa a una
        // persona. Recortarla despacharía algo distinto de lo que el cliente
        // pidió, y rechazarla perdería al mayorista de verdad.
        if (quantityOutOfRange(capture.cantidad)) {
          await escalar(ctx, {
            reason: "sales_out_of_rules",
            detail: `El vendedor intentó cerrar ${capture.cantidad} unidades (el máximo automático es ${MAX_QUANTITY}).`,
          });
          return {
            estado: "paso_a_un_asesor",
            detalle: `No se puede registrar esa cantidad desde el chat. Ya pasó a un asesor y ya se le avisó al cliente.`,
          };
        }

        const resolution = await resolveClosingLine(
          ctx.operation,
          ctx.conversation.productId,
          capture,
        );

        if (resolution.kind === "ambiguous_variant") {
          // El cierre no corrió y nadie le habló al cliente: contesta el modelo,
          // que es quien tiene la conversación para preguntar cuál quiere.
          return {
            estado: "falta_la_presentacion",
            detalle: `Antes de registrar, preguntale cuál de estas presentaciones quiere: ${resolution.options.join(", ")}.`,
          };
        }

        if (resolution.kind === "no_product") {
          await escalar(ctx, {
            reason: "sales_product_unidentified",
            detail: "Se intentó cerrar una venta sin producto identificado en la conversación.",
          });
          return {
            estado: "paso_a_un_asesor",
            detalle:
              "No hay producto identificado en esta conversación, así que no se puede armar el pedido. Ya pasó a un asesor.",
          };
        }

        if (resolution.kind === "not_sellable") {
          await escalar(ctx, {
            reason: "sales_out_of_rules",
            detail: `No se pudo armar la línea del pedido: ${resolution.detail}.`,
          });
          return {
            estado: "paso_a_un_asesor",
            detalle:
              "No se pudo armar el pedido por un problema del sistema. Ya pasó a un asesor y ya se le avisó.",
          };
        }

        const result = await closeSale({
          contact: ctx.contact,
          conversation: ctx.conversation,
          closing: capturedToClosing({
            leadRef: ctx.conversation.id,
            capture,
            line: resolution.line,
          }),
        });

        ctx.outcome.result = result;
        ctx.outcome.suppressModelText =
          closingTurnVoice(result).kind === "closing_spoke";

        logger.info(
          {
            conversationId: ctx.conversation.id,
            outcome: result.kind,
            suppressModelText: ctx.outcome.suppressModelText,
          },
          "cierre disparado desde la conversación",
        );
        return closingToolReport(result);
      },
    }),
  };
}

/**
 * Escalar desde la herramienta, cuando el cierre ni siquiera se pudo intentar.
 *
 * Marca el turno como «el cierre ya habló» porque `escalateToHuman` le manda al
 * cliente el aviso de cortesía y apaga el agente: dejar salir además el texto
 * del modelo sería seguir vendiéndole a alguien a quien acabamos de decirle que
 * lo pasamos con un asesor.
 */
async function escalar(
  ctx: { contact: Contact; outcome: ClosingTurnOutcome },
  input: { reason: "sales_out_of_rules" | "sales_product_unidentified"; detail: string },
): Promise<void> {
  await escalateToHuman({
    contact: ctx.contact,
    reason: input.reason,
    detail: input.detail,
  });
  ctx.outcome.suppressModelText = true;
}
