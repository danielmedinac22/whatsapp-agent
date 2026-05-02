import { logger } from "../lib/logger";
import { getDropiConnection } from "../dropi/config";
import { refreshDropiAuth } from "../dropi/auth";
import { DROPI_AUTH_REFRESH_QUEUE, getBoss } from "./queue";

export async function runDropiAuthRefresh(): Promise<{
  skipped: boolean;
  reason?: string;
  userId?: number;
  expiresAt?: string | null;
}> {
  const conn = await getDropiConnection();
  if (!conn?.email || !conn?.password) {
    return {
      skipped: true,
      reason: "no email/password configured (manual bearer mode)",
    };
  }
  const auth = await refreshDropiAuth();
  return {
    skipped: false,
    userId: auth.userId,
    expiresAt: null,
  };
}

export async function startDropiAuthRefreshWorker(): Promise<void> {
  const boss = await getBoss();
  await boss.work(DROPI_AUTH_REFRESH_QUEUE, async (raw) => {
    const list = (Array.isArray(raw) ? raw : [raw]) as Array<{ id?: string }>;
    for (const job of list) {
      try {
        const result = await runDropiAuthRefresh();
        if (result.skipped) {
          logger.info(
            { reason: result.reason, jobId: job?.id },
            "dropi.auth.refresh skipped",
          );
        } else {
          logger.info(
            { userId: result.userId, jobId: job?.id },
            "dropi.auth.refresh ok",
          );
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
  // Cada 6 horas, en el minuto 0 (00:00, 06:00, 12:00, 18:00).
  await boss.schedule(DROPI_AUTH_REFRESH_QUEUE, "0 */6 * * *", {});
  logger.info({ cron: "0 */6 * * *" }, "dropi auth refresh scheduled");
}

export async function enqueueDropiAuthRefreshNow(): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(DROPI_AUTH_REFRESH_QUEUE, {});
}
