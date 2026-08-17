import type { Operation } from "@wa/db";
import { logger } from "../lib/logger";
import { listActiveOperations } from "@wa/db";
import { getDropiConnection } from "../dropi/config";
import { Dropi2FAPendingError, refreshDropiAuth } from "../dropi/auth";
import { DROPI_AUTH_REFRESH_QUEUE, getBoss } from "./queue";

/**
 * Si al token le quedan más de este tiempo, no refresca todavía. Da margen
 * para que el admin responda al ping de WhatsApp con el código 2FA antes
 * de que el token expire del todo.
 */
const REFRESH_THRESHOLD_MS = 90 * 60 * 1000; // 90 min

export interface DropiAuthRefreshResult {
  skipped: boolean;
  reason?: string;
  userId?: number;
  pending2fa?: boolean;
}

/** Renueva el token de la logística de UNA operación. */
export async function runDropiAuthRefreshForOperation(
  op: Operation,
): Promise<DropiAuthRefreshResult> {
  const conn = await getDropiConnection(op);
  if (!conn?.email || !conn?.password) {
    return {
      skipped: true,
      reason: "no email/password configured (manual bearer mode)",
    };
  }

  // Si ya hay un challenge 2FA pendiente y no expirado, esperar al admin.
  if (
    conn.pending2faToken &&
    conn.pending2faExpiresAt &&
    conn.pending2faExpiresAt.getTime() > Date.now()
  ) {
    return { skipped: true, reason: "2FA challenge still pending" };
  }

  // Si el token actual aún tiene > 90 min de vida, esperar.
  const exp = conn.tokenExpiresAt?.getTime() ?? 0;
  const remaining = exp - Date.now();
  if (conn.bearerToken && remaining > REFRESH_THRESHOLD_MS) {
    return {
      skipped: true,
      reason: `token still valid (${Math.round(remaining / 60000)} min remaining)`,
    };
  }

  try {
    const auth = await refreshDropiAuth(op);
    return { skipped: false, userId: auth.userId };
  } catch (err) {
    if (err instanceof Dropi2FAPendingError) {
      return { skipped: false, pending2fa: true };
    }
    throw err;
  }
}

/**
 * Renueva el token de cada operación activa. Cada una tiene su propia cuenta,
 * su propio vencimiento y su propio 2FA: se recorren de una en una y el fallo
 * de una no impide intentar la siguiente.
 */
export async function runDropiAuthRefresh(): Promise<
  Array<DropiAuthRefreshResult & { operation: string }>
> {
  const ops = await listActiveOperations();
  const results: Array<DropiAuthRefreshResult & { operation: string }> = [];
  for (const op of ops) {
    try {
      const r = await runDropiAuthRefreshForOperation(op);
      results.push({ ...r, operation: op.countryCode });
    } catch (err) {
      logger.error(
        { err: String(err), operation: op.countryCode },
        "dropi.auth.refresh failed",
      );
      results.push({
        skipped: true,
        reason: err instanceof Error ? err.message : String(err),
        operation: op.countryCode,
      });
    }
  }
  return results;
}

export async function startDropiAuthRefreshWorker(): Promise<void> {
  const boss = await getBoss();
  await boss.work(DROPI_AUTH_REFRESH_QUEUE, async (raw) => {
    const list = (Array.isArray(raw) ? raw : [raw]) as Array<{ id?: string }>;
    for (const job of list) {
      try {
        for (const result of await runDropiAuthRefresh()) {
          if (result.skipped) {
            logger.info(
              {
                reason: result.reason,
                operation: result.operation,
                jobId: job?.id,
              },
              "dropi.auth.refresh skipped",
            );
          } else if (result.pending2fa) {
            logger.info(
              { operation: result.operation, jobId: job?.id },
              "dropi.auth.refresh awaiting 2FA OTP from admin",
            );
          } else {
            logger.info(
              {
                userId: result.userId,
                operation: result.operation,
                jobId: job?.id,
              },
              "dropi.auth.refresh ok",
            );
          }
        }
      } catch (err) {
        // Do NOT rethrow: failing this job should not stop the cron series
        // and should not invalidate the existing (still possibly valid) token.
        logger.error(
          { err: String(err), jobId: job?.id },
          "dropi.auth.refresh failed",
        );
      }
    }
  });
  logger.info("dropi auth refresh worker started");
}

export async function scheduleDropiAuthRefresh(): Promise<void> {
  const boss = await getBoss();
  // Cada 30 min: el handler decide si refresca según vida del token (>90 min
  // de vida → skip). Más frecuente que el viejo cron de 6h pero igual de barato:
  // sin trabajo si el token está vivo.
  const cron = "*/30 * * * *";
  await boss.schedule(DROPI_AUTH_REFRESH_QUEUE, cron, {});
  logger.info({ cron }, "dropi auth refresh scheduled");
}

export async function enqueueDropiAuthRefreshNow(): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(DROPI_AUTH_REFRESH_QUEUE, {});
}
