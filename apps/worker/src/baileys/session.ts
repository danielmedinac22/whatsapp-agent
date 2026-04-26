import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  type WASocket,
} from "baileys";
import { eq } from "@wa/db";
import { waSession } from "@wa/db";
import type { WaConnectionStatus } from "@wa/shared";
import { db } from "../db";
import { logger } from "../lib/logger";
import { events } from "../lib/events";
import { useDbAuthState, type DbAuthHandle } from "./auth-state";
import { onMessages } from "./message-handler";

let sock: WASocket | null = null;
let authHandle: DbAuthHandle | null = null;
let currentQr: string | null = null;
let status: WaConnectionStatus = "disconnected";
let starting = false;

export function getStatus(): { status: WaConnectionStatus; qr: string | null } {
  return { status, qr: currentQr };
}

export function getSocket(): WASocket | null {
  return sock;
}

async function setStatus(next: WaConnectionStatus, phone?: string | null) {
  status = next;
  await db
    .insert(waSession)
    .values({
      id: 1,
      status: next,
      phone: phone ?? undefined,
      qr: next === "qr" ? currentQr : null,
      updatedAt: new Date(),
      lastConnectedAt: next === "connected" ? new Date() : undefined,
    })
    .onConflictDoUpdate({
      target: waSession.id,
      set: {
        status: next,
        phone: phone ?? undefined,
        qr: next === "qr" ? currentQr : null,
        updatedAt: new Date(),
        ...(next === "connected" ? { lastConnectedAt: new Date() } : {}),
      },
    });
  events.emitEvent({ type: "status", status: next, phone: phone ?? undefined });
}

export async function startSession(opts?: { reset?: boolean }) {
  if (starting) {
    logger.info("session start already in progress");
    return;
  }
  starting = true;

  try {
    if (opts?.reset && authHandle) {
      await authHandle.clear();
      authHandle = null;
    }
    if (sock) {
      try {
        sock.end(undefined);
      } catch {
        /* ignore */
      }
      sock = null;
    }

    if (!authHandle) authHandle = await useDbAuthState();

    const { version, isLatest } = await fetchLatestBaileysVersion().catch(
      (err) => {
        logger.warn({ err }, "could not fetch Baileys version, using default");
        return { version: undefined, isLatest: false };
      },
    );
    logger.info({ version, isLatest }, "starting baileys socket");

    sock = makeWASocket({
      auth: authHandle.state,
      printQRInTerminal: false,
      browser: Browsers.appropriate("Chrome"),
      version,
      logger: logger.child({ module: "baileys" }, { level: "warn" }) as never,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    sock.ev.on("creds.update", () => {
      authHandle?.saveCreds().catch((err) =>
        logger.error({ err }, "failed to save creds"),
      );
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQr = qr;
        await setStatus("qr");
        events.emitEvent({ type: "qr", qr });
        logger.info("QR code emitted");
      }

      if (connection === "connecting") {
        await setStatus("connecting");
      }

      if (connection === "open") {
        currentQr = null;
        const phone = sock?.user?.id?.split(":")[0]?.split("@")[0] ?? null;
        await setStatus("connected", phone);
        logger.info({ phone }, "whatsapp connected");
      }

      if (connection === "close") {
        const err = lastDisconnect?.error as
          | { output?: { statusCode?: number } }
          | undefined;
        const code = err?.output?.statusCode ?? DisconnectReason.connectionClosed;
        const loggedOut = code === DisconnectReason.loggedOut;
        logger.warn({ code, loggedOut }, "whatsapp disconnected");

        if (loggedOut) {
          await authHandle?.clear();
          authHandle = null;
          currentQr = null;
          await setStatus("disconnected");
        } else {
          await setStatus("disconnected");
          starting = false;
          setTimeout(() => {
            startSession().catch((err) =>
              logger.error({ err }, "reconnect failed"),
            );
          }, 2000);
          return;
        }
      }
    });

    sock.ev.on("messages.upsert", async (m) => {
      try {
        await onMessages(sock!, m);
      } catch (err) {
        logger.error({ err }, "messages.upsert handler failed");
      }
    });
  } finally {
    starting = false;
  }
}

export async function stopSession() {
  if (sock) {
    try {
      sock.end(undefined);
    } catch {
      /* ignore */
    }
    sock = null;
  }
  await setStatus("disconnected");
}

export async function logoutSession() {
  if (sock) {
    try {
      await sock.logout();
    } catch (err) {
      logger.warn({ err }, "logout failed");
    }
    sock = null;
  }
  if (authHandle) {
    await authHandle.clear();
    authHandle = null;
  }
  currentQr = null;
  await setStatus("disconnected");
}

export async function autoStart() {
  const [row] = await db
    .select()
    .from(waSession)
    .where(eq(waSession.id, 1))
    .limit(1);
  if (row?.authState) {
    logger.info("auth state found, auto-starting session");
    await startSession();
  } else {
    logger.info("no auth state, waiting for /wa/start");
  }
}
