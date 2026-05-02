import { logger } from "../lib/logger";
import {
  getDropiConnection,
  invalidateDropiConnectionCache,
  upsertDropiConnection,
} from "./config";
import { DROPI_DEFAULT_HEADERS } from "./headers";

const REFRESH_BUFFER_MS = 30 * 60 * 1000;

interface JwtClaims {
  exp?: number;
  sub?: number | string;
}

function decodeJwt(token: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = (parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

export interface DropiAuth {
  baseUrl: string;
  token: string;
  userId: number;
}

let cachedPublicIp: string | null = null;

async function resolvePublicIp(): Promise<string> {
  if (cachedPublicIp) return cachedPublicIp;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.ok) {
      const data = (await res.json()) as { ip?: string };
      if (data?.ip) {
        cachedPublicIp = data.ip;
        return data.ip;
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "dropi.resolvePublicIp failed");
  }
  return "";
}

function extractToken(res: unknown): string | null {
  if (!res || typeof res !== "object") return null;
  const r = res as Record<string, unknown>;
  if (typeof r.token === "string") return r.token;
  if (typeof r.access_token === "string") return r.access_token;
  if (r.data && typeof r.data === "object") {
    const d = r.data as Record<string, unknown>;
    if (typeof d.token === "string") return d.token;
    if (typeof d.access_token === "string") return d.access_token;
  }
  return null;
}

async function dropiLoginPost(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...DROPI_DEFAULT_HEADERS,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

/**
 * Login Dropi: replica el flujo del navegador de app.dropi.gt.
 * 1. POST /beforeLoginUnknownDevice (best-effort, registra dispositivo).
 * 2. POST /login → devuelve JWT.
 * 3. Decodifica JWT para extraer exp/sub y persiste en dropi_connection.
 *
 * TODO: cifrar password en reposo (hoy en plaintext en dropi_connection.password).
 */
async function loginAndPersist(): Promise<DropiAuth> {
  const conn = await getDropiConnection();
  if (!conn) {
    throw new Error("dropi_connection not configured");
  }
  if (!conn.email || !conn.password) {
    throw new Error(
      "Dropi auto-login requires email + password in dropi_connection",
    );
  }
  const baseUrl = conn.apiBaseUrl;
  const ipAddress = await resolvePublicIp();

  const basePayload = {
    email: conn.email,
    password: conn.password,
    white_brand_id: 1,
    brand: "",
    ipAddress,
  };

  // Paso 1 — best-effort. No fatal si falla.
  try {
    const before = await dropiLoginPost(
      `${baseUrl}/beforeLoginUnknownDevice`,
      basePayload,
    );
    if (!before.ok) {
      logger.warn(
        { status: before.status, body: before.text.slice(0, 200) },
        "dropi.beforeLoginUnknownDevice non-ok (continuing)",
      );
    }
  } catch (err) {
    logger.warn(
      { err: String(err) },
      "dropi.beforeLoginUnknownDevice threw (continuing)",
    );
  }

  // Paso 2 — login real
  const loginRes = await dropiLoginPost(`${baseUrl}/login`, {
    ...basePayload,
    otp: null,
    with_cdc: false,
  });
  if (!loginRes.ok) {
    const err = new Error(
      `dropi login failed: ${loginRes.status} ${loginRes.text.slice(0, 200)}`,
    );
    await persistAutoLoginError(err.message);
    throw err;
  }

  const token = extractToken(loginRes.json);
  if (!token) {
    const snippet = loginRes.text.slice(0, 300);
    const err = new Error(
      `dropi login response did not contain a JWT (body=${snippet})`,
    );
    await persistAutoLoginError(err.message);
    throw err;
  }

  const claims = decodeJwt(token);
  const expiresAt = claims?.exp ? new Date(claims.exp * 1000) : null;
  const userId =
    typeof claims?.sub === "number"
      ? claims.sub
      : claims?.sub
        ? Number(claims.sub)
        : null;
  if (!userId) {
    const err = new Error("dropi login JWT missing sub claim");
    await persistAutoLoginError(err.message);
    throw err;
  }

  await upsertDropiConnection({
    bearerToken: token,
    tokenExpiresAt: expiresAt,
    userId,
    lastAutoLoginAt: new Date(),
    lastAutoLoginError: null,
  });
  invalidateDropiConnectionCache();
  logger.info(
    { userId, expiresAt: expiresAt?.toISOString() },
    "dropi.auto-login ok",
  );
  return { baseUrl, token, userId };
}

async function persistAutoLoginError(message: string): Promise<void> {
  try {
    await upsertDropiConnection({
      lastAutoLoginAt: new Date(),
      lastAutoLoginError: message.slice(0, 1000),
    });
    invalidateDropiConnectionCache();
  } catch (err) {
    logger.error(
      { err: String(err) },
      "failed to persist dropi auto-login error",
    );
  }
}

export async function refreshDropiAuth(): Promise<DropiAuth> {
  invalidateDropiConnectionCache();
  return loginAndPersist();
}

export async function getValidDropiAuth(): Promise<DropiAuth> {
  const conn = await getDropiConnection();
  if (!conn) {
    throw new Error("dropi_connection not configured");
  }
  const baseUrl = conn.apiBaseUrl;

  const now = Date.now();
  const expiresAt = conn.tokenExpiresAt?.getTime() ?? 0;
  const stillValid =
    !!conn.bearerToken && expiresAt - now > REFRESH_BUFFER_MS;

  if (stillValid && conn.bearerToken && conn.userId) {
    return { baseUrl, token: conn.bearerToken, userId: conn.userId };
  }

  // Try to derive expiration/userId from a manually pasted bearer.
  if (conn.bearerToken) {
    const claims = decodeJwt(conn.bearerToken);
    const exp = claims?.exp ? claims.exp * 1000 : 0;
    const sub =
      typeof claims?.sub === "number"
        ? claims.sub
        : claims?.sub
          ? Number(claims.sub)
          : null;
    if (exp > now + REFRESH_BUFFER_MS && sub) {
      // Persist derived metadata so we don't decode every call.
      if (!conn.userId || !conn.tokenExpiresAt) {
        await upsertDropiConnection({
          userId: sub,
          tokenExpiresAt: new Date(exp),
        });
      }
      return { baseUrl, token: conn.bearerToken, userId: sub };
    }
  }

  logger.info("dropi token missing/expired — attempting login refresh");
  return loginAndPersist();
}
