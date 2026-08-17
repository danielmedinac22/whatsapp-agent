import type { Operation } from "@wa/db";
import { nameSimilarity } from "../lib/match";

const NAME_SIM_THRESHOLD = 0.8;
/** Margen mínimo sobre el segundo candidato para llamar «alta» a la confianza. */
const DISTINCT_MARGIN = 0.15;

/** Lo único que se mira de la operación al cruzar es a quién pertenece. */
export type MatchOperation = Pick<Operation, "id" | "countryCode" | "currency">;

export interface ShopifyMatchCandidate {
  id: string;
  customerName: string | null;
  contactId: string | null;
  /** Moneda del pedido de tienda, tal como la mandó la tienda. */
  currency: string | null;
}

export interface ShopifyMatch {
  shopifyOrderRowId: string;
  contactId: string | null;
  confidence: "high" | "low";
}

export interface ShopifyMatchOutcome {
  match: ShopifyMatch | null;
  /** Candidatos descartados por no ser de esta operación. */
  rejected: number;
}

/**
 * ¿Este pedido de tienda es de esta operación?
 *
 * Hoy la única señal disponible es la moneda: `shopify_orders` no tiene
 * `operation_id` —el expand del ticket 01 solo llegó a las cuatro conexiones y
 * a `conversations`— y la moneda es el vocabulario que el ticket 01 dejó
 * compartido a propósito (`operations.currency` ISO-4217, igual que
 * `shopify_orders.currency`).
 *
 * Un pedido sin moneda **no se atribuye a ninguna operación**. Es la dirección
 * segura del error: un cruce que no ocurre deja el pedido de logística visible
 * como no cruzado en /pedidos, mientras que un cruce al país equivocado no lo
 * nota nadie hasta que sale el envío. En producción los 1.681 pedidos de tienda
 * traen moneda `GTQ`, ninguno vacío, así que hoy no descarta nada.
 */
export function belongsToOperation(
  candidate: { currency: string | null },
  op: MatchOperation,
): boolean {
  if (!candidate.currency) return false;
  return candidate.currency.trim().toUpperCase() === op.currency.toUpperCase();
}

/**
 * Elige con qué pedido de tienda se cruza un pedido de logística, entre los
 * candidatos que ya pasaron el filtro de teléfono y ventana de fechas.
 *
 * Recibe la operación como parámetro obligatorio: sin ella no hay forma de
 * llamar a esta función, y por eso no hay forma de escribir el cruce entre
 * países. La lógica de puntaje por nombre es la que ya existía en
 * `jobs/dropi-sync.ts`, movida aquí sin cambios para poder probarla en seco.
 */
export function pickShopifyMatch(input: {
  operation: MatchOperation;
  customerName: string | null;
  candidates: ShopifyMatchCandidate[];
}): ShopifyMatchOutcome {
  const mine = input.candidates.filter((c) =>
    belongsToOperation(c, input.operation),
  );
  const rejected = input.candidates.length - mine.length;

  if (mine.length === 0) return { match: null, rejected };

  const only = mine[0];
  if (mine.length === 1 && only) {
    const sim = nameSimilarity(input.customerName, only.customerName);
    return {
      match: {
        shopifyOrderRowId: only.id,
        contactId: only.contactId ?? null,
        confidence:
          sim >= NAME_SIM_THRESHOLD || !input.customerName ? "high" : "low",
      },
      rejected,
    };
  }

  // Varios candidatos: gana el nombre más parecido, y solo cuenta como alta
  // confianza si además le saca ventaja clara al segundo.
  const scored = mine
    .map((c) => ({ c, sim: nameSimilarity(input.customerName, c.customerName) }))
    .sort((a, b) => b.sim - a.sim);
  const best = scored[0];
  if (!best) return { match: null, rejected };
  const second = scored[1];
  const distinct = !second || best.sim - second.sim >= DISTINCT_MARGIN;
  return {
    match: {
      shopifyOrderRowId: best.c.id,
      contactId: best.c.contactId ?? null,
      confidence:
        best.sim >= NAME_SIM_THRESHOLD && distinct ? "high" : "low",
    },
    rejected,
  };
}
