import { logger } from "../lib/logger";
import { getDropiConnection, upsertDropiConnection } from "./config";

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

/**
 * Login Dropi.
 *
 * NOTE: el endpoint y el shape exactos del login todavía no están
 * identificados. Esta función es un stub que sólo lanza si no hay un
 * bearer pegado a mano en `dropi_connection.bearer_token`. Cuando se
 * identifique el endpoint, implementar aquí el POST y persistir token.
 */
async function loginAndPersist(): Promise<DropiAuth> {
  throw new Error(
    "Dropi login endpoint not yet wired. Paste a manual bearer token into dropi_connection.bearer_token for now.",
  );
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
