/**
 * El único punto del sistema que le habla a Meta para reportar una conversión.
 *
 * Es lo contrario de puro y por eso es lo más corto posible: todo lo que
 * **decide** vive alrededor y está probado con fixtures — el evento
 * (`purchase-event.ts`), el interruptor (`send-mode.ts`), la clasificación del
 * fallo (`failure.ts`) y a quién le toca (`plan.ts`). Acá solo quedan la URL, el
 * `POST` y la lectura de la respuesta.
 *
 * ## Las tres cosas que este archivo garantiza
 *
 * 1. **Con el interruptor apagado no sale ni una llamada.** La comprobación es
 *    la primera línea y devuelve un resultado con nombre —`off`, con su
 *    motivo—, no una excepción ni un `null` que alguien pueda ignorar.
 * 2. **El destino es el dataset de la cuenta de WhatsApp.** La URL la arma
 *    {@link datasetEventsUrl} y su parámetro se llama `datasetId`. No hay
 *    ninguna variable llamada `pixel` en este módulo y no puede haberla: es la
 *    trampa más cara del proyecto —el píxel es un destino real y equivocado, y
 *    equivocarse no da ni error ni alarma— y la única defensa que sobrevive
 *    seis meses es que el código diga el nombre correcto en todas partes.
 * 3. **El token viaja en la cabecera, nunca en la URL.** Meta acepta las dos
 *    formas y la de la URL termina escrita en cualquier log de red.
 *
 * ## El tiempo de espera es corto a propósito
 *
 * Quince segundos. Esto corre en una cola que reintenta, así que colgarse un
 * minuto no gana nada, y un `fetch` sin límite en un worker de larga vida es
 * cómo se acumulan sockets abiertos. Lo importante es que **agotar el tiempo no
 * es un fallo reintentable**: la petición ya salió y puede haber llegado. Eso
 * lo decide `failure.ts`.
 */

import { logger } from "../lib/logger";
import { capiRequestBody, type MetaBusinessMessagingPurchaseEvent } from "./purchase-event";
import {
  capiNetworkSignal,
  classifyCapiFailure,
  type CapiFailure,
  type MetaGraphError,
} from "./failure";
import {
  capiDispatch,
  type CapiDispatchSetting,
  type CapiOffReason,
  type CapiSendMode,
} from "./send-mode";

/** Quince segundos. Ver el encabezado. */
const TIMEOUT_MS = 15_000;

/**
 * A dónde se postea una conversión: `POST /v{VERSION}/{datasetId}/events`.
 *
 * Pura y exportada para poder probarla. El `datasetId` va codificado aunque los
 * identificadores de Meta sean numéricos: un valor mal cargado desde el panel
 * con una barra adentro cambiaría la ruta entera del `POST`, y un evento
 * mandado a otra ruta es el fallo silencioso que este módulo existe para
 * evitar.
 */
export function datasetEventsUrl(
  graphVersion: string,
  datasetId: string,
): string {
  return `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(datasetId)}/events`;
}

/** Cómo terminó el intento de reportar. */
export type CapiSendOutcome =
  /** Meta lo recibió. `eventsReceived` es lo que contestó, si lo dijo. */
  | { kind: "sent"; mode: CapiSendMode; eventsReceived: number | null }
  /** El interruptor está apagado. **No salió ninguna llamada.** */
  | { kind: "off"; reason: CapiOffReason }
  | { kind: "failed"; failure: CapiFailure };

export interface CapiSendInput {
  datasetId: string;
  event: MetaBusinessMessagingPurchaseEvent;
  /** Para el log: de qué pedido es esta conversión. */
  orderId: string;
}

/**
 * Reporta una conversión al dataset de la operación.
 *
 * El ajuste entra por parámetro con respaldo en el entorno para que el
 * llamador —que ya lo leyó para decidir si valía la pena buscar pedidos— no lo
 * lea dos veces y pueda encontrarse con dos valores distintos a mitad de un
 * barrido.
 */
export async function sendConversion(
  input: CapiSendInput,
  setting: CapiDispatchSetting = capiDispatch(),
): Promise<CapiSendOutcome> {
  if (setting.mode === "off") {
    return { kind: "off", reason: setting.reason };
  }

  const url = datasetEventsUrl(setting.graphVersion, input.datasetId);
  const body = capiRequestBody(
    [input.event],
    setting.mode === "test" ? setting.testEventCode : undefined,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // En la cabecera y no en la URL: un `access_token=` en la ruta termina
        // escrito en cualquier log de red o de proxy.
        Authorization: `Bearer ${setting.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const failure = classifyCapiFailure(capiNetworkSignal(err));
    logger.warn(
      { orderId: input.orderId, datasetId: input.datasetId, failure },
      "capi: el reporte de conversión no salió bien",
    );
    return { kind: "failed", failure };
  }

  const payload = await readJson(res);

  if (!res.ok) {
    const failure = classifyCapiFailure({
      kind: "http",
      status: res.status,
      error: metaError(payload),
    });
    logger.warn(
      { orderId: input.orderId, datasetId: input.datasetId, status: res.status, failure },
      "capi: Meta no aceptó la conversión",
    );
    return { kind: "failed", failure };
  }

  // Un `200` con un `error` adentro existe en la Graph API y es la trampa
  // clásica: leer solo el código HTTP daría el evento por reportado.
  const error = metaError(payload);
  if (error) {
    const failure = classifyCapiFailure({
      kind: "http",
      status: res.status,
      error,
    });
    return { kind: "failed", failure };
  }

  const eventsReceived = readEventsReceived(payload);
  if (eventsReceived === 0) {
    // Meta contestó bien y dijo que no recibió ninguno. No se reintenta a
    // ciegas: que conteste 200 significa que la petición se procesó.
    return {
      kind: "failed",
      failure: {
        disposition: "stop",
        reason: "Meta respondió 200 pero events_received = 0",
      },
    };
  }

  logger.info(
    {
      orderId: input.orderId,
      datasetId: input.datasetId,
      mode: setting.mode,
      eventsReceived,
    },
    "capi: conversión reportada al dataset",
  );
  return { kind: "sent", mode: setting.mode, eventsReceived };
}

/** El cuerpo de la respuesta, o `null` si no se pudo leer como JSON. */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function metaError(payload: unknown): MetaGraphError | null {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const e = error as Record<string, unknown>;
  return {
    code: typeof e.code === "number" ? e.code : null,
    error_subcode:
      typeof e.error_subcode === "number" ? e.error_subcode : null,
    message: typeof e.message === "string" ? e.message : null,
    type: typeof e.type === "string" ? e.type : null,
  };
}

/**
 * Cuántos eventos dice Meta haber recibido. `null` cuando no lo dice: la
 * respuesta documentada trae `events_received`, pero un `200` sin ese campo no
 * es motivo para dar la conversión por perdida y mandarla otra vez.
 */
function readEventsReceived(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const n = (payload as { events_received?: unknown }).events_received;
  return typeof n === "number" ? n : null;
}
