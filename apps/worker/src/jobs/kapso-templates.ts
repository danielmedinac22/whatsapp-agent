import { logger } from "../lib/logger";
import { isKapsoConfigured } from "../kapso/config";
import {
  ensureKapsoTemplates,
  refreshKapsoTemplateStatuses,
} from "../kapso/provisioning";
import { KAPSO_TEMPLATE_POLL_QUEUE, getBoss } from "./queue";

/**
 * Meta approves templates asynchronously and Kapso has no template-status
 * webhook, so a cron polls the WABA: submit anything missing, then refresh
 * pending statuses.
 */
export async function startKapsoTemplateWorker(): Promise<void> {
  const boss = await getBoss();
  const workerId = await boss.work(KAPSO_TEMPLATE_POLL_QUEUE, async () => {
    if (!isKapsoConfigured()) return;
    // `null` = la operación única. El cron no nace de una conversación, así que
    // no tiene de dónde sacar la operación; mientras haya una sola, poner la
    // única es exacto. Cuando exista la segunda hay que recorrerlas — es parte
    // del ticket de contract, no de la migración de la conexión.
    await ensureKapsoTemplates(null);
    await refreshKapsoTemplateStatuses(null);
  });
  logger.info({ workerId }, "kapso template poll worker started");
}

export async function scheduleKapsoTemplatePoll(): Promise<void> {
  const boss = await getBoss();
  await boss.schedule(KAPSO_TEMPLATE_POLL_QUEUE, "*/30 * * * *", {});
  logger.info("kapso template poll scheduled (*/30m)");
}
