/**
 * Lo que el admin necesita saber del reporte a Meta y no puede resolver solo:
 * **si está funcionando**, y qué quedó sin resolver.
 *
 * **Vive en `capi/` y no en `routes/`** por el mismo motivo que
 * `shopify/closing-routes.ts`: ese directorio tiene otros dueños y dos ramas
 * escribiendo el mismo archivo chocan sin que ningún check local lo vea.
 *
 * ## Las tres preguntas que contesta, y por qué son tres
 *
 * 1. **¿Está funcionando?** El criterio del ticket es no tener que esperar un
 *    mes para descubrir que no se envió nada. El veredicto lo arma
 *    `capi/health.ts` y distingue *«no hubo nada que reportar»* de *«funciona»*,
 *    que se ven igual y no son lo mismo.
 * 2. **¿Qué quedó pidiendo turno y nunca se resolvió?** Es el precio conocido
 *    de escribir la fila del libro **antes** de llamar a Meta: un proceso que
 *    se muere en el medio deja un `pending` que el barrido nunca vuelve a
 *    mirar, porque salta todo pedido que ya tenga fila. Sin esta lista, «queda
 *    visible» sería una frase. **No se reintentan solas** — eso reabriría la
 *    puerta al duplicado que toda la arquitectura existe para cerrar.
 * 3. **¿Qué quedó en duda, y cómo se comprueba?** Un `unconfirmed` es una
 *    petición que salió y no tuvo respuesta. Nadie de este lado puede saber si
 *    llegó: **lo único que puede saberlo es el administrador de eventos de
 *    Meta**, y comprobarlo ahí es el ticket `ventas-capi/04`. Así que cada fila
 *    sale con lo que hace falta para buscarla allá —dataset, momento exacto y
 *    valor— y con la instrucción escrita al lado. Un estado que nadie sabe cómo
 *    verificar es un estado que nadie verifica.
 */

import { Hono } from "hono";
import { logger } from "../lib/logger";
import { panelOperation } from "../operations";
import { planOperationConversions } from "../jobs/capi-conversion";
import { reportingVerdict } from "./health";
import {
  STALE_PENDING_MS,
  listStalePending,
  listUnconfirmed,
  tallyConversions,
} from "./conversion-record";
import { capiDispatch, offReasonText } from "./send-mode";

export const capiReporting = new Hono();

/** Cuánto período mira el estado: los mismos siete días de la ventana de Meta. */
const WINDOW_MS = 7 * 24 * 60 * 60_000;

/** Techo de filas por lista. Es un tablero, no una exportación. */
const LIST_LIMIT = 50;

/**
 * Cómo se comprueba una conversión que quedó en duda. Va en la respuesta, al
 * lado de las filas, y no en un documento aparte: la instrucción sirve donde
 * está el problema.
 */
const COMO_VERIFICAR_EN_DUDA =
  "La petición salió y Meta no respondió, así que de este lado no se puede saber si la conversión quedó registrada — y no se reintenta, porque reintentar una que sí llegó contaría la venta dos veces y eso no se revierte. Para comprobarlo: entrar al administrador de eventos de Meta, abrir el dataset que dice cada fila, y buscar un evento `Purchase` con ese momento (`eventTime`) y ese valor. Si está, la conversión llegó y la fila se puede dar por buena; si no está, esa venta no quedó atribuida y se perdió la señal — no hay forma de reponerla sin arriesgar un duplicado. Es el ticket ventas-capi/04.";

/**
 * El estado del reporte de conversiones de una operación.
 *
 * Sale siempre con `200`, incluso apagado y sin credencial: **el reporte
 * apagado es el estado normal de hoy** y la pantalla tiene que poder
 * explicarlo, no mostrar un fallo.
 */
capiReporting.get("/estado", async (c) => {
  const op = await panelOperation(c);
  const setting = capiDispatch();
  const now = new Date();

  const tally = await tallyConversions({
    operationId: op.id,
    since: new Date(now.getTime() - WINDOW_MS),
  });

  const stalePending = await listStalePending({
    operationId: op.id,
    olderThan: new Date(now.getTime() - STALE_PENDING_MS),
    limit: LIST_LIMIT,
  });

  const enDuda = await listUnconfirmed({
    operationId: op.id,
    limit: LIST_LIMIT,
  });

  // El barrido se vuelve a calcular acá, con la misma función que usa el
  // worker. Que el tablero y el trabajo salgan de la misma decisión es lo que
  // impide que el tablero diga una cosa mientras el worker hace otra.
  let sweep = { report: 0, wait: {}, skip: {} };
  let sweepError: string | null = null;
  try {
    sweep = (await planOperationConversions({
      operationId: op.id,
      setting,
      now,
    })).counts;
  } catch (err) {
    // Una consulta que falla no es un dato que no existe: se dice que no se
    // pudo mirar, en vez de mostrar ceros que se leerían como «no hay nada».
    sweepError = err instanceof Error ? err.message : String(err);
    logger.error({ err, operacion: op.countryCode }, "capi: no se pudo mirar el barrido");
  }

  return c.json({
    modo: setting.mode,
    motivoApagado: setting.mode === "off" ? offReasonText(setting.reason) : null,
    // El destino es un **dataset** de la cuenta de WhatsApp, no el píxel.
    datasetId: op.capiDatasetId,
    veredicto: sweepError
      ? {
          state: "blocked" as const,
          headline: "No se pudo leer el estado del reporte",
          detail: `No se pudo mirar qué ventas faltan por reportar (${sweepError}). No quiere decir que no haya ninguna: quiere decir que no se pudo mirar.`,
        }
      : reportingVerdict({
          setting,
          tally,
          sweep,
          stalePending: stalePending.length,
        }),
    periodoDias: Math.round(WINDOW_MS / (24 * 60 * 60_000)),
    conteos: tally,
    barrido: sweepError ? null : sweep,
    pendientesSinResolver: {
      desdeHoras: Math.round(STALE_PENDING_MS / 3_600_000),
      nota: "Pidieron turno para reportarse y nunca se supo cómo terminaron — casi siempre, el worker se reinició en el medio. No se reintentan solas a propósito: no se sabe si la petición salió, y reintentar a ciegas contaría la venta dos veces.",
      filas: stalePending,
    },
    enDuda: {
      comoVerificar: COMO_VERIFICAR_EN_DUDA,
      filas: enDuda,
    },
  });
});
