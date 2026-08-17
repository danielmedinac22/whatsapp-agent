/**
 * El constructor de prompt efectivo: **el único lugar del sistema que sabe que
 * hay más de un agente.**
 *
 * Katherine y Sebastián salen de aquí. No hay un segundo runner, ni un segundo
 * camino de entrada, ni una bifurcación en el pipeline: la conversación tiene
 * un agente dueño en cada momento (`sales/owner.ts`), este archivo recibe cuál
 * es y **resuelve de dónde leer**. Es el seam más alto disponible, y el motivo
 * de que exista un solo punto es el que el spec enuncia al revés: cada lugar
 * que aprendiera que hay dos agentes sería un lugar donde uno puede recibir la
 * configuración del otro.
 *
 * De dónde lee cada uno, que es toda la diferencia:
 *
 * - **Confirmación (Katherine)** — su prompt es un campo de texto que el admin
 *   escribe entero (`agent_settings.system_prompt`), y sus bloques de contexto
 *   hablan del pedido que el cliente **ya hizo**: estado en la tienda, estado
 *   en logística, novedad activa. El llamador le pasa el prompt base porque el
 *   banco de pruebas del panel prueba borradores sin guardarlos.
 * - **Ventas (Sebastián)** — su prompt se **compone** de campos estructurados
 *   más el campo libre de tono (`sales/persona.ts`), y su bloque de contexto
 *   habla del producto que el cliente **todavía no compró**.
 *
 * **Ningún campo cruza.** El tipo de entrada es una unión discriminada: en la
 * rama de confirmación no hay dónde escribir una configuración de ventas, y en
 * la de ventas no hay dónde escribir un prompt de Katherine. La fuga que el
 * ticket prohíbe no es un caso que los tests vigilen — es un programa que no
 * compila. Los tests la vigilan igual, porque el que viene detrás puede
 * ensanchar el tipo sin darse cuenta de qué estaba sosteniendo.
 */

import type { Operation } from "@wa/db";
import { logger } from "../lib/logger";
import { buildSalesPersonaPrompt, type SalesPersona } from "../sales/persona";
import { buildProductContextBlock } from "../sales/product-context";
import { buildDropiContextBlock } from "./dropi-context";
import { buildShopifyContextBlock } from "./shopify-context";

/** Cuál de los dos agentes está armando el prompt. */
export type AgentIdentity = "confirmation" | "sales";

/**
 * Las piezas ya cargadas de un prompt efectivo, listas para componer. Es la
 * frontera entre lo que toca la base (abajo) y lo que se puede probar sin ella
 * ({@link composeEffectivePrompt}).
 */
export type EffectivePromptParts =
  | {
      agent: "confirmation";
      /** `agent_settings.system_prompt`, o el borrador del banco de pruebas. */
      basePrompt: string;
      /** Bloques de postventa, en orden de composición. `null` = no aplica. */
      blocks: readonly (string | null)[];
    }
  | {
      agent: "sales";
      persona: SalesPersona;
      /** El bloque del producto identificado, o `null` si no hay ninguno. */
      productBlock: string | null;
    };

/**
 * El prompt efectivo, dadas sus piezas. **Puro.**
 *
 * La composición es la de siempre —base, después cada bloque, separados por una
 * línea en blanco— y no cambió con la llegada del segundo agente: para Katherine
 * el resultado es carácter por carácter el de antes, que es lo que la
 * no-regresión pide.
 */
export function composeEffectivePrompt(parts: EffectivePromptParts): string {
  const [base, blocks] =
    parts.agent === "confirmation"
      ? [parts.basePrompt, parts.blocks]
      : [buildSalesPersonaPrompt(parts.persona), [parts.productBlock]];

  let prompt = base;
  for (const block of blocks) {
    if (block) prompt = `${prompt}\n\n${block}`;
  }
  return prompt;
}

/**
 * Lo que hay que decirle al constructor para que arme el prompt de un agente.
 *
 * La configuración de ventas la pasa el llamador y no se relee aquí porque de
 * la misma fila salen el modelo y el esfuerzo de razonamiento con los que el
 * runner va a llamar al proveedor: una sola lectura, un solo estado. Lo que
 * decide de dónde sale cada pieza es la identidad, no el llamador.
 */
export type EffectivePromptRequest =
  | {
      agent: "confirmation";
      basePrompt: string;
      /** Sin contacto no hay postventa que mirar (banco de pruebas sin conversación). */
      contactId: string | null;
    }
  | {
      agent: "sales";
      /** La operación dueña de la conversación: contra su tienda se lee el producto. */
      operation: Operation;
      persona: SalesPersona;
      /** `conversations.product_id`, lo que el reconocimiento haya resuelto. */
      productId: string | null;
    };

/**
 * Prompt que realmente recibe el modelo: el prompt del agente que corresponde
 * más los bloques de contexto que se inyectan solos.
 *
 * Lo usan el runner de producción y el banco de pruebas de `/agent`, para que
 * lo que se prueba sea idéntico a lo que se envía.
 *
 * Un bloque que falle no puede costar la respuesta: se loguea y el prompt sigue
 * sin él. Es el comportamiento que ya tenía Katherine —la tabla de tiendas está
 * vacía en producción y su bloque devuelve `null` en cada turno— y el que le
 * corresponde al de producto: sin ficha, Sebastián conversa sin inventarla.
 */
export async function buildEffectiveSystemPrompt(
  request: EffectivePromptRequest,
): Promise<string> {
  if (request.agent === "sales") {
    const productBlock = await buildProductContextBlock(
      request.operation,
      request.productId,
    ).catch((err) => {
      logger.warn({ err }, "product context build failed; continuing without it");
      return null;
    });
    return composeEffectivePrompt({
      agent: "sales",
      persona: request.persona,
      productBlock,
    });
  }

  const { basePrompt, contactId } = request;
  if (!contactId) {
    return composeEffectivePrompt({ agent: "confirmation", basePrompt, blocks: [] });
  }

  const shopify = await buildShopifyContextBlock(contactId).catch((err) => {
    logger.warn({ err }, "shopify context build failed; continuing without it");
    return null;
  });
  const dropi = await buildDropiContextBlock(contactId).catch((err) => {
    logger.warn({ err }, "dropi context build failed; continuing without it");
    return null;
  });

  return composeEffectivePrompt({
    agent: "confirmation",
    basePrompt,
    blocks: [shopify, dropi],
  });
}
