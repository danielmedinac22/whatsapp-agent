/**
 * El libro de las conversiones reportadas a Meta: **lo único que impide que un
 * reintento cuente dos ventas**.
 *
 * ## La regla que gobierna este archivo
 *
 * Meta **no deduplica** este flujo. Está escrito en su documentación de
 * *Conversions API for Business Messaging* con todas las letras, y el ticket 02
 * lo dejó anotado: si mandamos el mismo pedido dos veces, cuentan dos ventas. Y
 * el riesgo R7 dice qué pasa entonces — el algoritmo de la pauta que Vorare
 * paga aprende un ticket promedio y una tasa de conversión falsos, y **eso no
 * se revierte borrando datos**.
 *
 * Así que la deduplicación es nuestra, y vive acá: una fila por conversión, con
 * un único sobre la llave. El patrón es el de `outbound_messages.dedup_key`,
 * que este repo ya tiene probado sobre el camino que factura: `insert ... on
 * conflict do nothing`, y **quien no logró insertar es quien no manda**.
 *
 * ## Se pide el turno ANTES de mandar
 *
 * {@link claimConversion} inserta la fila en `pending` y recién entonces el
 * despachador postea. Al revés —mandar y después anotar— hay una ventana entre
 * las dos cosas en la que el proceso puede morirse, y esa ventana se paga con
 * un evento duplicado. Al derecho, la ventana se paga con un evento que no se
 * manda: una conversión menos, **visible en esta misma tabla como `pending`
 * vieja**. De los dos errores posibles, este proyecto elige el que se puede
 * arreglar.
 *
 * ## Reclamar el turno propio no es reclamarlo dos veces
 *
 * Un reintento de la cola vuelve a pasar por acá y se encuentra su propia fila
 * en `pending`. Eso **no** lo detiene: es el mismo intento continuando. Lo que
 * lo detiene es encontrarla en cualquier estado final —`sent`, `failed` o
 * `unconfirmed`—, porque los tres significan que ya se decidió qué pasó con
 * esta conversión y volver a mandarla sería inventar una segunda.
 *
 * ## Los dos modos no comparten llave
 *
 * El ensayo con el código de prueba de Meta —`ventas-capi/04`— usa la misma
 * llave con el prefijo `test:`. Si compartieran llave, las primeras ventas
 * reales, que son justo las que alguien está mirando durante el ensayo,
 * quedarían marcadas como reportadas y **nunca llegarían al dataset de verdad**
 * al encender el modo real. Un ensayo no puede consumir el turno del envío.
 */

import {
  and,
  capiConversions,
  desc,
  eq,
  gte,
  lt,
  sql,
  type OperationId,
} from "@wa/db";
import { db } from "../db";
import type { CapiSendMode } from "./send-mode";

/** Los cuatro estados de una conversión en el libro. */
export type ConversionStatus = "pending" | "sent" | "failed" | "unconfirmed";

/**
 * Los tres estados finales. Encontrar la fila en cualquiera de ellos significa
 * «ya se decidió»: no se manda otra vez, pase lo que pase.
 */
const FINAL_STATUSES: readonly ConversionStatus[] = [
  "sent",
  "failed",
  "unconfirmed",
];

/**
 * La llave con la que el libro reconoce una conversión.
 *
 * La parte estable la deriva `buildPurchaseEvent` del pedido y su operación
 * —nunca del momento—, y acá se le antepone el modo. Ver el encabezado: los dos
 * modos no comparten turno.
 */
export function ledgerKey(mode: CapiSendMode, deduplicationKey: string): string {
  return mode === "test" ? `test:${deduplicationKey}` : deduplicationKey;
}

export interface ConversionClaim {
  operationId: OperationId;
  /** La llave ya prefijada por {@link ledgerKey}. */
  ledgerKey: string;
  orderId: string;
  conversationId: string | null;
  /** El dataset de la cuenta de WhatsApp. **No es el píxel.** */
  datasetId: string;
  mode: CapiSendMode;
  /** El valor tal como va a viajar. */
  value: number;
  currency: string;
  /**
   * El `event_time` del evento, en segundos desde epoch — tal cual viaja. Se
   * guarda porque es lo que hace verificable un `unconfirmed`: en el
   * administrador de eventos de Meta los eventos se buscan por momento y valor.
   */
  eventTimeUnix: number;
}

/** Qué pasó al pedir el turno. */
export type ClaimResult =
  /** El turno es nuestro: hay que mandar. Trae el id de la fila. */
  | { kind: "ours"; id: string; attempts: number }
  /** Ya se decidió qué pasó con esta conversión. **No se manda.** */
  | { kind: "already"; id: string; status: ConversionStatus };

/**
 * Pide el turno para reportar una conversión.
 *
 * Devuelve `ours` en dos casos que son el mismo: la fila no existía, o existía
 * en `pending` y es este intento continuando. Devuelve `already` cuando la
 * conversión ya tiene un desenlace.
 */
export async function claimConversion(
  claim: ConversionClaim,
): Promise<ClaimResult> {
  const inserted = await db
    .insert(capiConversions)
    .values({
      operationId: claim.operationId,
      dedupKey: claim.ledgerKey,
      orderId: claim.orderId,
      conversationId: claim.conversationId,
      datasetId: claim.datasetId,
      mode: claim.mode,
      status: "pending",
      // Texto, como `shopify_orders.total_price`: lo que se guarda es lo que
      // viajó, no un número que después se reformatea distinto al mostrarlo.
      value: claim.value.toFixed(2),
      currency: claim.currency,
      eventTime: new Date(claim.eventTimeUnix * 1000),
      attempts: 1,
    })
    .onConflictDoNothing({ target: capiConversions.dedupKey })
    .returning({ id: capiConversions.id });

  const fila = inserted[0];
  if (fila) return { kind: "ours", id: fila.id, attempts: 1 };

  const [existing] = await db
    .select({
      id: capiConversions.id,
      status: capiConversions.status,
      attempts: capiConversions.attempts,
    })
    .from(capiConversions)
    .where(eq(capiConversions.dedupKey, claim.ledgerKey))
    .limit(1);

  if (!existing) {
    // El único chocó y la fila no está: alguien la borró entre las dos
    // consultas. No se manda a ciegas — que el turno no se pueda determinar no
    // es lo mismo que que esté libre, y esa distinción es la regla de lectura
    // del proyecto aplicada donde cuesta una conversión duplicada.
    throw new Error(
      `capi: la llave ${claim.ledgerKey} chocó y la fila no aparece`,
    );
  }

  const status = existing.status as ConversionStatus;
  if (FINAL_STATUSES.includes(status)) {
    return { kind: "already", id: existing.id, status };
  }

  // `pending`: es este mismo intento volviendo. Se cuenta el intento y sigue.
  const attempts = existing.attempts + 1;
  await db
    .update(capiConversions)
    .set({ attempts, updatedAt: new Date() })
    .where(eq(capiConversions.id, existing.id));
  return { kind: "ours", id: existing.id, attempts };
}

/** Meta la recibió. */
export async function markSent(id: string): Promise<void> {
  await db
    .update(capiConversions)
    .set({ status: "sent", sentAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(capiConversions.id, id));
}

/**
 * Meta la rechazó de forma permanente, o se agotaron los reintentos.
 *
 * **No escala a una persona por WhatsApp**, a diferencia de un cierre que no
 * llegó a la tienda: esto es telemetría, no una venta. Queda registrado y
 * visible en el estado del reporte, que es donde alguien lo va a mirar cuando
 * pregunte si la atribución está funcionando.
 */
export async function markFailed(id: string, reason: string): Promise<void> {
  await db
    .update(capiConversions)
    .set({ status: "failed", lastError: reason, updatedAt: new Date() })
    .where(eq(capiConversions.id, id));
}

/**
 * La petición salió y nunca llegó respuesta: no se sabe si Meta la tomó.
 *
 * Es un estado final aunque no sea un desenlace: **no se reintenta nunca**.
 * Ver `capi/failure.ts`.
 */
export async function markUnconfirmed(id: string, reason: string): Promise<void> {
  await db
    .update(capiConversions)
    .set({ status: "unconfirmed", lastError: reason, updatedAt: new Date() })
    .where(eq(capiConversions.id, id));
}

/**
 * Cuánto tiene que pasar para que un `pending` deje de ser «en curso» y pase a
 * ser «se quedó ahí»: **una hora**.
 *
 * Los reintentos de la cola arrancan al minuto y con espera creciente; una hora
 * es varias veces el último intento. Lo que siga en `pending` después de eso no
 * está intentándose: es la huella de un proceso que se murió entre pedir el
 * turno y saber qué pasó.
 */
export const STALE_PENDING_MS = 60 * 60_000;

/**
 * Una conversión que quedó sin resolver, con lo que hace falta para decidir qué
 * hacer con ella.
 */
export interface StuckConversion {
  orderId: string;
  status: ConversionStatus;
  mode: string;
  datasetId: string;
  value: string;
  currency: string;
  /** El `event_time` que viajó. Es por donde se la busca en Meta. */
  eventTime: Date;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
}

/**
 * Las conversiones que quedaron pidiendo turno y nunca se resolvieron.
 *
 * Es la huella del proceso que se murió entre reclamar y mandar, y es el precio
 * conocido de escribir la fila antes de llamar. **No se resucitan en
 * automático**, ni acá ni en ningún lado: una `pending` vieja significa «no
 * sabemos si salió» exactamente igual que una `unconfirmed`, y reintentarla
 * sola es volver a abrir la puerta al duplicado que toda esta arquitectura
 * existe para cerrar.
 *
 * Lo que sí hace falta es que **se vea**, porque el barrido salta todo pedido
 * que ya tenga fila y nunca la va a volver a mirar. Devolverlas enteras —y no
 * un conteo— es lo que convierte «queda visible» en algo que una persona puede
 * mirar y decidir.
 */
export async function listStalePending(input: {
  operationId: OperationId;
  olderThan: Date;
  limit: number;
}): Promise<StuckConversion[]> {
  return listStuck({
    operationId: input.operationId,
    limit: input.limit,
    status: "pending",
    olderThan: input.olderThan,
  });
}

/**
 * Las conversiones en duda: la petición salió y Meta nunca respondió.
 *
 * **Este proceso no puede resolverlas y no lo va a intentar.** Lo único que
 * puede decir si esa conversión llegó es el administrador de eventos de Meta, y
 * comprobarlo ahí es el ticket `ventas-capi/04`. Por eso cada fila viaja con lo
 * que hace falta para buscarla allá: el dataset, el momento exacto que viajó
 * como `event_time`, y el valor con su moneda.
 */
export async function listUnconfirmed(input: {
  operationId: OperationId;
  limit: number;
}): Promise<StuckConversion[]> {
  return listStuck({
    operationId: input.operationId,
    limit: input.limit,
    status: "unconfirmed",
  });
}

async function listStuck(input: {
  operationId: OperationId;
  limit: number;
  status: ConversionStatus;
  olderThan?: Date;
}): Promise<StuckConversion[]> {
  const rows = await db
    .select({
      orderId: capiConversions.orderId,
      status: capiConversions.status,
      mode: capiConversions.mode,
      datasetId: capiConversions.datasetId,
      value: capiConversions.value,
      currency: capiConversions.currency,
      eventTime: capiConversions.eventTime,
      attempts: capiConversions.attempts,
      lastError: capiConversions.lastError,
      createdAt: capiConversions.createdAt,
    })
    .from(capiConversions)
    .where(
      and(
        eq(capiConversions.operationId, input.operationId),
        eq(capiConversions.status, input.status),
        ...(input.olderThan
          ? [lt(capiConversions.createdAt, input.olderThan)]
          : []),
      ),
    )
    .orderBy(desc(capiConversions.createdAt))
    .limit(input.limit);
  return rows.map((r) => ({ ...r, status: r.status as ConversionStatus }));
}

/** Cuántas conversiones hay en cada estado, para una operación y un período. */
export interface ConversionTally {
  sent: number;
  failed: number;
  unconfirmed: number;
  pending: number;
}

export async function tallyConversions(input: {
  operationId: OperationId;
  since: Date;
}): Promise<ConversionTally> {
  const rows = await db
    .select({
      status: capiConversions.status,
      n: sql<number>`count(*)::int`,
    })
    .from(capiConversions)
    .where(
      and(
        eq(capiConversions.operationId, input.operationId),
        gte(capiConversions.createdAt, input.since),
      ),
    )
    .groupBy(capiConversions.status);

  const tally: ConversionTally = {
    sent: 0,
    failed: 0,
    unconfirmed: 0,
    pending: 0,
  };
  for (const row of rows) {
    if (row.status in tally) {
      tally[row.status as keyof ConversionTally] = row.n;
    }
  }
  return tally;
}
