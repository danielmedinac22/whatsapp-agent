import { listActiveOperations } from "@wa/db";
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
    // El cron no nace de una conversación: recorre las operaciones activas y
    // somete el catálogo de cada una contra **su** WABA. Antes pedía la
    // operación única (`null`, la fila singleton), que el contract borró; el
    // lote de la conexión de WhatsApp lo dejó anotado como trabajo de aquí.
    // Un fallo en una operación no puede dejar sin plantillas a las demás.
    for (const op of await listActiveOperations()) {
      try {
        await ensureKapsoTemplates(op);
        await refreshKapsoTemplateStatuses(op);
      } catch (err) {
        logger.error(
          { err, operation: op.countryCode },
          "kapso templates: la operación falló",
        );
      }
    }
  });
  logger.info({ workerId }, "kapso template poll worker started");
}

export async function scheduleKapsoTemplatePoll(): Promise<void> {
  const boss = await getBoss();
  await boss.schedule(KAPSO_TEMPLATE_POLL_QUEUE, "*/30 * * * *", {});
  logger.info("kapso template poll scheduled (*/30m)");
}
