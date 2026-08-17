import type { Operation } from "@wa/db";
import { logger } from "../lib/logger";
import {
  invalidateDropiConnectionCache,
  resolveDropiConnection,
  upsertDropiConnection,
} from "./config";
import { DROPI_DEFAULT_HEADERS } from "./headers";

/**
 * Buffer pequeño para evitar usar un token que vaya a expirar a mitad de
 * un request. NO refresca proactivamente — eso lo hace `dropi-auth-refresh`
 * cron con anticipación (~90 min antes) para tener margen de pedirte el
 * código por WhatsApp y que respondas.
 */
const REFRESH_BUFFER_MS = 60 * 1000;

interface JwtClaims {
  exp?: number;
  iat?: number;
  sub?: number | string;
  aud?: string;
  token_type?: string;
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
 * Indica que el login se quedó esperando un código 2FA. El cron / quien lo
 * disparó debe esperar a que el admin envíe el código por WhatsApp o lo pegue
 * en la UI. NO destruye el bearer actual: hasta que llegue el código, los
 * jobs siguen usando el token vigente.
 */
export class Dropi2FAPendingError extends Error {
  constructor(message = "Dropi 2FA pending — waiting for OTP from admin") {
    super(message);
    this.name = "Dropi2FAPendingError";
  }
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

/**
 * Busca recursivamente cualquier JWT con `aud=DROPI` en una respuesta
 * arbitraria. Necesario porque distintos endpoints (login / verify) pueden
 * devolver el JWT bajo claves distintas.
 */
function findDropiJwt(obj: unknown): string | null {
  if (typeof obj === "string") {
    const parts = obj.split(".");
    if (parts.length === 3 && obj.startsWith("eyJ")) {
      const claims = decodeJwt(obj);
      if (claims?.aud === "DROPI") return obj;
    }
    return null;
  }
  if (obj && typeof obj === "object") {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      const found = findDropiJwt(v);
      if (found) return found;
    }
  }
  return null;
}

function findAnyJwt(obj: unknown): string | null {
  if (typeof obj === "string") {
    const parts = obj.split(".");
    if (parts.length === 3 && obj.startsWith("eyJ")) return obj;
    return null;
  }
  if (obj && typeof obj === "object") {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      const found = findAnyJwt(v);
      if (found) return found;
    }
  }
  return null;
}

interface DropiResponse {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
  setCookies: string[];
}

async function dropiPost(
  url: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<DropiResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...DROPI_DEFAULT_HEADERS,
      "content-type": "application/json",
      ...extraHeaders,
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
  // Capture Set-Cookie (Node fetch exposes via res.headers.getSetCookie()
  // when available; otherwise fall back to manually scanning).
  let setCookies: string[] = [];
  try {
    const h = res.headers as unknown as { getSetCookie?: () => string[] };
    if (typeof h.getSetCookie === "function") {
      setCookies = h.getSetCookie();
    } else {
      const raw = res.headers.get("set-cookie");
      if (raw) setCookies = [raw];
    }
  } catch {
    setCookies = [];
  }
  return { ok: res.ok, status: res.status, json, text, setCookies };
}


async function persistAutoLoginError(
  op: Operation,
  message: string,
): Promise<void> {
  try {
    await upsertDropiConnection(op, {
      lastAutoLoginAt: new Date(),
      lastAutoLoginError: message.slice(0, 1000),
    });
    invalidateDropiConnectionCache(op);
  } catch (err) {
    logger.error(
      { err: String(err), operation: op.countryCode },
      "failed to persist dropi auto-login error",
    );
  }
}

interface LoginAttemptResult {
  kind: "ok" | "2fa";
  /** present when kind === "ok" */
  auth?: DropiAuth;
  /** present when kind === "2fa" */
  challengeToken?: string;
  challengeExpiresAt?: Date | null;
}

async function attemptLogin(
  baseUrl: string,
  email: string,
  password: string,
  ipAddress: string,
  otp: string | null = null,
  extraHeaders: Record<string, string> = {},
): Promise<LoginAttemptResult> {
  const basePayload = {
    email,
    password,
    white_brand_id: 1,
    brand: "",
    ipAddress,
  };

  // Paso 1 — best-effort. No fatal si falla.
  try {
    const before = await dropiPost(
      `${baseUrl}/beforeLoginUnknownDevice`,
      basePayload,
      extraHeaders,
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

  // Paso 2 — login real. Si llamamos con `otp` no-null, es el segundo
  // login post-verify y Dropi nos devuelve el JWT DROPI directamente.
  const loginPayload = {
    ...basePayload,
    otp,
    with_cdc: false,
  };
  const loginRes = await dropiPost(
    `${baseUrl}/login`,
    loginPayload,
    extraHeaders,
  );
  if (otp) {
    logger.info(
      {
        status: loginRes.status,
        bodyPreview: loginRes.text.slice(0, 400),
      },
      "dropi.login (with otp) response",
    );
  }
  if (!loginRes.ok) {
    throw new Error(
      `dropi login failed: ${loginRes.status} ${loginRes.text.slice(0, 200)}`,
    );
  }

  // ¿Vino el JWT DROPI directamente?
  const dropiJwt = findDropiJwt(loginRes.json);
  if (dropiJwt) {
    return { kind: "ok", auth: jwtToAuth(baseUrl, dropiJwt) };
  }

  // ¿Es un challenge 2FA?
  const body = (loginRes.json ?? {}) as { message?: string; token?: string };
  if (body.message === "2fa" && typeof body.token === "string") {
    const claims = decodeJwt(body.token);
    const expiresAt = claims?.exp ? new Date(claims.exp * 1000) : null;
    return {
      kind: "2fa",
      challengeToken: body.token,
      challengeExpiresAt: expiresAt,
    };
  }

  throw new Error(
    `dropi login response did not contain a DROPI JWT nor a 2FA challenge (body=${loginRes.text.slice(0, 300)})`,
  );
}

function jwtToAuth(baseUrl: string, token: string): DropiAuth {
  const claims = decodeJwt(token);
  const userId =
    typeof claims?.sub === "number"
      ? claims.sub
      : claims?.sub
        ? Number(claims.sub)
        : null;
  if (!userId) {
    throw new Error("dropi JWT missing sub claim");
  }
  return { baseUrl, token, userId };
}

async function persistDropiToken(
  op: Operation,
  baseUrl: string,
  token: string,
): Promise<DropiAuth> {
  const claims = decodeJwt(token);
  const expiresAt = claims?.exp ? new Date(claims.exp * 1000) : null;
  const userId =
    typeof claims?.sub === "number"
      ? claims.sub
      : claims?.sub
        ? Number(claims.sub)
        : null;
  if (!userId) {
    throw new Error("dropi JWT missing sub claim");
  }
  await upsertDropiConnection(op, {
    bearerToken: token,
    tokenExpiresAt: expiresAt,
    userId,
    lastAutoLoginAt: new Date(),
    lastAutoLoginError: null,
    pending2faToken: null,
    pending2faExpiresAt: null,
    pending2faRequestedAt: null,
  });
  // El `baseUrl` viene de la conexión de esta operación, no de una constante:
  // el valor por defecto del esquema es guatemalteco.
  invalidateDropiConnectionCache(op);
  return { baseUrl, token, userId };
}

/**
 * Login Dropi: replica el flujo del navegador de app.dropi.gt.
 * Soporta 2FA con código de Google Authenticator: si la cuenta tiene 2FA
 * activado, persiste el challenge token y dispara un ping por WhatsApp al
 * admin_phone configurado. El token vigente (si lo hay) NO se borra: el
 * sync sigue funcionando hasta que llegue el código y se canjee.
 */
async function loginAndPersist(op: Operation): Promise<DropiAuth> {
  const conn = await resolveDropiConnection(op);
  if (!conn) {
    throw new Error(
      `dropi_connection not configured for operation ${op.countryCode}`,
    );
  }
  if (!conn.email || !conn.password) {
    throw new Error(
      "Dropi auto-login requires email + password in dropi_connection",
    );
  }
  const baseUrl = conn.apiBaseUrl;
  const ipAddress = await resolvePublicIp();

  let result: LoginAttemptResult;
  try {
    result = await attemptLogin(baseUrl, conn.email, conn.password, ipAddress);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await persistAutoLoginError(op, msg);
    throw err;
  }

  if (result.kind === "ok" && result.auth) {
    await persistDropiToken(op, baseUrl, result.auth.token);
    logger.info(
      { userId: result.auth.userId, operation: op.countryCode },
      "dropi.auto-login ok (no 2FA)",
    );
    return result.auth;
  }

  // 2FA pendiente — persiste challenge + dispara ping a admin
  if (result.kind === "2fa" && result.challengeToken) {
    await upsertDropiConnection(op, {
      pending2faToken: result.challengeToken,
      pending2faExpiresAt: result.challengeExpiresAt ?? null,
      pending2faRequestedAt: new Date(),
      lastAutoLoginAt: new Date(),
      lastAutoLoginError: "2FA pending — waiting for OTP from admin",
    });
    invalidateDropiConnectionCache(op);

    if (conn.adminPhone) {
      // Import dinámico para evitar ciclo (outbound importa pg-boss).
      const { enqueueOutbound } = await import("../jobs/outbound");
      const { ADMIN_AVISO_TEMPLATE, sanitizeParam } = await import(
        "../kapso/templates"
      );
      const expiresLabel = result.challengeExpiresAt
        ? result.challengeExpiresAt.toLocaleTimeString("es-CO", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "10 min";
      const body =
        `🔐 *Dropi pide código 2FA*\n\n` +
        `Abre Google Authenticator y respóndeme con el código de 6 dígitos.\n\n` +
        `_Válido hasta ~${expiresLabel}._`;
      // Bucket horario: los crons de Dropi reintentan el login constantemente
      // mientras hay 2FA pendiente — sin esto se generaban cientos de pings.
      // La operación entra en la clave: dos logísticas pidiendo código en la
      // misma hora no pueden taparse una a la otra.
      const hourBucket = Math.floor(Date.now() / 3_600_000);
      await enqueueOutbound({
        to: conn.adminPhone.replace(/\D/g, ""),
        body,
        source: "dropi_2fa",
        dedupKey: `dropi-2fa-${op.countryCode}-${hourBucket}`,
        // Si el admin no ha chateado con el bot en 24h, cae a plantilla.
        // El texto del código va en el parámetro (Meta solo revisa el
        // texto estático de la plantilla, no los params de envío).
        fallbackTemplate: {
          name: ADMIN_AVISO_TEMPLATE,
          params: [
            sanitizeParam(
              "Dropi pide tu código 2FA — respóndeme por aquí con los 6 dígitos de Google Authenticator",
            ),
          ],
        },
      }).catch((err) => {
        logger.error({ err: String(err) }, "dropi.2fa ping enqueue failed");
      });
      logger.info(
        { adminPhone: conn.adminPhone, operation: op.countryCode },
        "dropi.2fa ping sent",
      );
    } else {
      logger.warn(
        { operation: op.countryCode },
        "dropi.2fa challenge received but no admin_phone configured",
      );
    }
    throw new Dropi2FAPendingError();
  }

  throw new Error("dropi login: unexpected attempt result");
}

/**
 * Canjea el código OTP por el JWT real de Dropi.
 * Llamado desde el interceptor de inbound de WhatsApp y desde el endpoint
 * de UI como fallback manual.
 */
export async function submitDropi2FACode(
  op: Operation,
  code: string,
): Promise<{ ok: true; auth: DropiAuth } | { ok: false; error: string }> {
  const conn = await resolveDropiConnection(op);
  if (!conn) return { ok: false, error: "dropi_connection not configured" };
  if (!conn.pending2faToken) {
    return { ok: false, error: "no hay challenge 2FA pendiente" };
  }
  if (
    conn.pending2faExpiresAt &&
    conn.pending2faExpiresAt.getTime() < Date.now()
  ) {
    return {
      ok: false,
      error: "el challenge 2FA expiró — espera el siguiente intento",
    };
  }
  const baseUrl = conn.apiBaseUrl;

  // Paso 1 — verify
  const verifyRes = await dropiPost(`${baseUrl}/auth/2fa/verify`, {
    token: conn.pending2faToken,
    code,
  });
  logger.info(
    {
      status: verifyRes.status,
      bodyKeys:
        verifyRes.json && typeof verifyRes.json === "object"
          ? Object.keys(verifyRes.json as object)
          : null,
      bodyPreview: verifyRes.text.slice(0, 800),
    },
    "dropi.2fa.verify response",
  );
  if (!verifyRes.ok) {
    const msg = `verify falló: ${verifyRes.status} ${verifyRes.text.slice(0, 200)}`;
    await persistAutoLoginError(op, msg);
    return { ok: false, error: msg };
  }

  // Dropi devuelve HTTP 200 incluso cuando el código es inválido.
  // Hay que mirar isSuccess / message en el body.
  const verifyBody = (verifyRes.json ?? {}) as {
    isSuccess?: boolean;
    message?: string;
    status?: number;
  };
  if (verifyBody.isSuccess === false) {
    const msg = `código 2FA inválido: ${verifyBody.message ?? "sin detalle"}`;
    await persistAutoLoginError(op, msg);
    return { ok: false, error: msg };
  }

  // ¿La respuesta de verify trae el JWT DROPI directamente?
  let dropiJwt = findDropiJwt(verifyRes.json);

  // Si no encontró DROPI pero sí cualquier otro JWT, lógalo para depurar.
  if (!dropiJwt) {
    const anyJwt = findAnyJwt(verifyRes.json);
    if (anyJwt) {
      const claims = decodeJwt(anyJwt);
      logger.warn(
        { aud: claims?.aud, type: claims?.token_type },
        "dropi.2fa.verify returned a JWT but not aud=DROPI",
      );
    } else {
      logger.warn("dropi.2fa.verify returned no JWT in body");
    }
  }

  // Si no vino el JWT en el verify, hacer el segundo /login pasando
  // el código OTP en el campo `otp`. Esa es la secuencia exacta del
  // browser y es lo que dispara la emisión del JWT DROPI.
  if (!dropiJwt) {
    if (!conn.email || !conn.password) {
      return {
        ok: false,
        error: "verify ok pero falta email/password para re-login",
      };
    }
    const ipAddress = await resolvePublicIp();
    let second: LoginAttemptResult;
    try {
      second = await attemptLogin(
        baseUrl,
        conn.email,
        conn.password,
        ipAddress,
        code,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await persistAutoLoginError(op, msg);
      return { ok: false, error: msg };
    }
    if (second.kind !== "ok" || !second.auth) {
      const msg =
        "verify ok pero el segundo /login (con otp) no devolvió un JWT DROPI";
      await persistAutoLoginError(op, msg);
      return { ok: false, error: msg };
    }
    dropiJwt = second.auth.token;
  }

  // Si por alguna razón el JWT que recibimos no es DROPI, fallar duro.
  const claims = decodeJwt(dropiJwt);
  if (claims?.aud !== "DROPI") {
    const msg = `el JWT recibido tiene aud=${claims?.aud}, esperado DROPI`;
    await persistAutoLoginError(op, msg);
    return { ok: false, error: msg };
  }

  const auth = await persistDropiToken(op, baseUrl, dropiJwt);
  logger.info(
    { userId: auth.userId, operation: op.countryCode },
    "dropi.2fa verify ok",
  );
  return { ok: true, auth };
}

export async function refreshDropiAuth(op: Operation): Promise<DropiAuth> {
  invalidateDropiConnectionCache(op);
  return loginAndPersist(op);
}

export async function getValidDropiAuth(op: Operation): Promise<DropiAuth> {
  const conn = await resolveDropiConnection(op);
  if (!conn) {
    throw new Error(
      `dropi_connection not configured for operation ${op.countryCode}`,
    );
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
        await upsertDropiConnection(op, {
          userId: sub,
          tokenExpiresAt: new Date(exp),
        });
      }
      return { baseUrl, token: conn.bearerToken, userId: sub };
    }
  }

  logger.info(
    { operation: op.countryCode },
    "dropi token missing/expired — attempting login refresh",
  );
  return loginAndPersist(op);
}

