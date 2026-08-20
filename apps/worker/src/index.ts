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
import { metaAds } from "./meta/ads-routes";
import { catalogStore } from "./shopify/catalog-routes";
import { storeClosings } from "./shopify/closing-routes";
import { capiReporting } from "./capi/reporting-routes";
import { dropi } from "./routes/dropi";
import { kapsoAdmin, kapsoWebhook } from "./routes/kapso";
import {
  scheduleKapsoTemplatePoll,
  startKapsoTemplateWorker,
} from "./jobs/kapso-templates";
import { startFollowupWorker } from "./jobs/followup";
import { startSalesOrderWorker } from "./jobs/sales-order";
import {
  scheduleCapiSweep,
  startCapiConversionWorker,
} from "./jobs/capi-conversion";
import { startOutboundWorker } from "./jobs/outbound";
import { startRemarketingWorker } from "./jobs/remarketing";
import {
  scheduleDropiSync,
  startDropiSyncWorker,
} from "./jobs/dropi-sync";
import { startDropiConfirmWorker } from "./jobs/dropi-confirm";
import { listActiveOperations } from "@wa/db";
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
import {
  scheduleLiberarAsignaciones,
  startLiberarAsignacionesWorker,
} from "./jobs/liberar-asignaciones";

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
// El catálogo del panel: lo único que necesita del worker es la tienda.
app.route("/api/catalog", catalogStore);
// El estado de la tienda y los cierres que no llegaron a ella.
app.route("/api/tienda", storeClosings);
// Si el reporte de conversiones a Meta está funcionando, y qué quedó sin
// resolver. Sin esta pantalla, que no se envíe nada se descubre en un mes.
app.route("/api/capi", capiReporting);
app.route("/api/meta", metaAds);
app.route("/api/dropi", dropi);
app.route("/api/kapso", kapsoAdmin);

const port = Number(process.env.PORT ?? 3001);

/**
 * Siembra las plantillas de logística de cada operación activa, sobre su propia
 * configuración. Un fallo en una no puede impedir la siembra de las demás.
 */
async function seedDropiTemplatesForActiveOperations(): Promise<void> {
  for (const op of await listActiveOperations()) {
    try {
      await ensureDropiTemplates(op);
    } catch (err) {
      logger.error(
        { err, operation: op.countryCode },
        "ensureDropiTemplates failed",
      );
    }
  }
}

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
  // La cola de cierres que no llegaron a la tienda: reintenta y avisa. Sin
  // ella, una venta cerrada que la tienda rechaza se pierde en silencio.
  startSalesOrderWorker().catch((err) =>
    logger.error({ err }, "sales order worker failed to start"),
  );
  // El reporte de conversiones a Meta: barrido cada cinco minutos y cola de
  // envío con reintentos. Arranca apagado — sin `META_CAPI_MODE` y sin token no
  // sale ni una llamada, y el barrido solo mira.
  startCapiConversionWorker().catch((err) =>
    logger.error({ err }, "capi conversion worker failed to start"),
  );
  scheduleCapiSweep().catch((err) =>
    logger.error({ err }, "capi conversion sweep scheduling failed"),
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
  // El arranque siembra las plantillas de logística de cada operación activa,
  // sobre su propia configuración. Antes sembraba la fila global `id = 1`, que
  // es Guatemala: la segunda operación se habría quedado sin plantillas o, peor,
  // habría heredado las FK guatemaltecas.
  seedDropiTemplatesForActiveOperations().catch((err) =>
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
  // La red que suelta las asignaciones que cambiaron de bandeja. El caso normal
  // —la venta que cierra— lo suelta el webhook del pedido al instante; esto
  // cubre lo que no pasa por ahí. Con el vendedor apagado no consulta nada.
  startLiberarAsignacionesWorker().catch((err) =>
    logger.error({ err }, "liberar-asignaciones worker failed to start"),
  );
  scheduleLiberarAsignaciones().catch((err) =>
    logger.error({ err }, "liberar-asignaciones scheduling failed"),
  );
});
