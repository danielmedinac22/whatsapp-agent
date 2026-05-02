import PgBoss from "pg-boss";
import { logger } from "../lib/logger";

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

export const FOLLOWUP_QUEUE = "shopify-followup";
export const REMARKETING_QUEUE = "shopify-remarketing";
export const OUTBOUND_QUEUE = "outbound-send";
export const DROPI_SYNC_QUEUE = "dropi-sync";
export const DROPI_CONFIRM_QUEUE = "dropi-confirm";
export const DROPI_POLL_QUEUE = "dropi-poll";
export const DROPI_AUTH_REFRESH_QUEUE = "dropi-auth-refresh";

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  if (starting) return starting;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for pg-boss");
  starting = (async () => {
    const b = new PgBoss({ connectionString: url, schema: "pgboss" });
    b.on("error", (err) => logger.error({ err }, "pg-boss error"));
    await b.start();
    // pg-boss v10 requires explicit queue creation before send/work.
    // createQueue is idempotent.
    await b.createQueue(FOLLOWUP_QUEUE);
    await b.createQueue(REMARKETING_QUEUE);
    await b.createQueue(OUTBOUND_QUEUE);
    await b.createQueue(DROPI_SYNC_QUEUE);
    await b.createQueue(DROPI_CONFIRM_QUEUE);
    await b.createQueue(DROPI_POLL_QUEUE);
    await b.createQueue(DROPI_AUTH_REFRESH_QUEUE);
    boss = b;
    starting = null;
    return b;
  })();
  return starting;
}
