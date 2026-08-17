import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "./lib/logger";

process.on("unhandledRejection", (reason, promise) => {
  console.error("[UNHANDLED-REJECTION]", reason);
  logger.error({ reason: String(reason), promise: String(promise) }, "unhandled rejection");
});
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT-EXCEPTION]", err);
  logger.error({ err }, "uncaught exception");
});
import { auth } from "./middleware/auth";
import { health } from "./routes/health";
import { wa } from "./routes/wa";
import { events } from "./routes/events";
import { agent } from "./routes/agent";
import { shopify } from "./routes/shopify";
import { shopifyConn } from "./routes/shopify-connection";
import { dropi } from "./routes/dropi";
import { kapsoAdmin, kapsoWebhook } from "./routes/kapso";
import {
  scheduleKapsoTemplatePoll,
  startKapsoTemplateWorker,
} from "./jobs/kapso-templates";
import { startFollowupWorker } from "./jobs/followup";
import { startOutboundWorker } from "./jobs/outbound";
import { startRemarketingWorker } from "./jobs/remarketing";
import {
  scheduleDropiSync,
  startDropiSyncWorker,
} from "./jobs/dropi-sync";
import { startDropiConfirmWorker } from "./jobs/dropi-confirm";
import { GLOBAL_AGENT_SETTINGS } from "@wa/db";
import { ensureDropiTemplates } from "./dropi/seed-templates";
import {
  scheduleDropiPoll,
  startDropiPollWorker,
} from "./jobs/dropi-poll";
import {
  scheduleDropiAuthRefresh,
  startDropiAuthRefreshWorker,
} from "./jobs/dropi-auth-refresh";
import { startDropiNovedadNotifyWorker } from "./jobs/dropi-novedad-notify";
import {
  scheduleDropiNovedadReminder,
  startDropiNovedadReminderWorker,
} from "./jobs/dropi-novedad-reminder";
import { startDropiNovedadHandoffWorker } from "./jobs/dropi-novedad-handoff";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: process.env.WEB_ORIGIN?.split(",") ?? "*",
    credentials: true,
  }),
);

app.route("/health", health);

// Shopify + Kapso webhooks are HMAC-authenticated, NOT Bearer
app.route("/shopify", shopify);
app.route("/kapso", kapsoWebhook);

app.use("/api/*", auth());
app.route("/api/wa", wa);
app.route("/api/events", events);
app.route("/api/agent", agent);
app.route("/api/shopify", shopifyConn);
app.route("/api/dropi", dropi);
app.route("/api/kapso", kapsoAdmin);

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "worker listening");
  startKapsoTemplateWorker().catch((err) =>
    logger.error({ err }, "kapso template worker failed to start"),
  );
  scheduleKapsoTemplatePoll().catch((err) =>
    logger.error({ err }, "kapso template poll scheduling failed"),
  );
  startFollowupWorker().catch((err) =>
    logger.error({ err }, "followup worker failed to start"),
  );
  startRemarketingWorker().catch((err) =>
    logger.error({ err }, "remarketing worker failed to start"),
  );
  startOutboundWorker().catch((err) =>
    logger.error({ err }, "outbound worker failed to start"),
  );
  startDropiSyncWorker().catch((err) =>
    logger.error({ err }, "dropi sync worker failed to start"),
  );
  scheduleDropiSync().catch((err) =>
    logger.error({ err }, "dropi sync scheduling failed"),
  );
  startDropiConfirmWorker().catch((err) =>
    logger.error({ err }, "dropi confirm worker failed to start"),
  );
  startDropiPollWorker().catch((err) =>
    logger.error({ err }, "dropi poll worker failed to start"),
  );
  scheduleDropiPoll().catch((err) =>
    logger.error({ err }, "dropi poll scheduling failed"),
  );
  startDropiAuthRefreshWorker().catch((err) =>
    logger.error({ err }, "dropi auth refresh worker failed to start"),
  );
  scheduleDropiAuthRefresh().catch((err) =>
    logger.error({ err }, "dropi auth refresh scheduling failed"),
  );
  // El arranque siembra las plantillas de la configuración global; cada
  // operación nueva las siembra con su propio ámbito.
  ensureDropiTemplates(GLOBAL_AGENT_SETTINGS).catch((err) =>
    logger.error({ err }, "ensureDropiTemplates failed"),
  );
  startDropiNovedadNotifyWorker().catch((err) =>
    logger.error({ err }, "dropi novedad-notify worker failed to start"),
  );
  startDropiNovedadReminderWorker().catch((err) =>
    logger.error({ err }, "dropi novedad-reminder worker failed to start"),
  );
  scheduleDropiNovedadReminder().catch((err) =>
    logger.error({ err }, "dropi novedad-reminder scheduling failed"),
  );
  startDropiNovedadHandoffWorker().catch((err) =>
    logger.error({ err }, "dropi novedad-handoff worker failed to start"),
  );
});
