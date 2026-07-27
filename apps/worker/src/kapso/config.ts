/**
 * Kapso env config. Lazy accessors so the worker can boot without Kapso
 * configured (e.g. local dev before `kapso setup`); callers that need Kapso
 * fail with a clear error at call time instead of at import time.
 */

export function kapsoApiBaseUrl(): string {
  return process.env.KAPSO_API_BASE_URL ?? "https://api.kapso.ai";
}

export function kapsoApiKey(): string {
  const key = process.env.KAPSO_API_KEY;
  if (!key) throw new Error("KAPSO_API_KEY is not set");
  return key;
}

export function kapsoWebhookSecret(): string {
  const secret = process.env.KAPSO_WEBHOOK_SECRET;
  if (!secret) throw new Error("KAPSO_WEBHOOK_SECRET is not set");
  return secret;
}

/** Public base URL of this worker (Railway), used to register the webhook. */
export function publicBaseUrl(): string {
  const url = process.env.PUBLIC_URL;
  if (!url) throw new Error("PUBLIC_URL is not set");
  return url.replace(/\/$/, "");
}

export function isKapsoConfigured(): boolean {
  return Boolean(process.env.KAPSO_API_KEY && process.env.KAPSO_WEBHOOK_SECRET);
}
