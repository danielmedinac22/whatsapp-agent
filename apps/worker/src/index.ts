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
import { autoStart } from "./baileys/session";
import { startFollowupWorker } from "./jobs/followup";
import { startRemarketingWorker } from "./jobs/remarketing";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: process.env.WEB_ORIGIN?.split(",") ?? "*",
    credentials: true,
  }),
);

app.route("/health", health);

// Shopify webhook is HMAC-authenticated, NOT Bearer
app.route("/shopify", shopify);

app.use("/api/*", auth());
app.route("/api/wa", wa);
app.route("/api/events", events);
app.route("/api/agent", agent);

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "worker listening");
  autoStart().catch((err) =>
    logger.error({ err }, "auto-start failed"),
  );
  startFollowupWorker().catch((err) =>
    logger.error({ err }, "followup worker failed to start"),
  );
  startRemarketingWorker().catch((err) =>
    logger.error({ err }, "remarketing worker failed to start"),
  );
});
