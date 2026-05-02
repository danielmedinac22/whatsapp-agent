import { logger } from "../lib/logger";
import { invalidateDropiConnectionCache } from "./config";
import { getValidDropiAuth, type DropiAuth } from "./auth";

const DEFAULT_HEADERS: Record<string, string> = {
  accept: "application/json, text/plain, */*",
  "accept-language": "es-419,es;q=0.9",
  origin: "https://app.dropi.gt",
  referer: "https://app.dropi.gt/",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
};

export class DropiHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`dropi http ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

export interface DropiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
}

function buildQuery(
  query: DropiFetchOptions["query"],
): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    params.set(k, v === null ? "null" : String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

async function doFetch<T>(
  auth: DropiAuth,
  path: string,
  opts: DropiFetchOptions,
): Promise<T> {
  const url = `${auth.baseUrl}${path}${buildQuery(opts.query)}`;
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    "x-authorization": `Bearer ${auth.token}`,
  };
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new DropiHttpError(res.status, text);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`dropi: invalid JSON response from ${path}`);
  }
}

export async function dropiFetch<T = unknown>(
  path: string,
  opts: DropiFetchOptions = {},
): Promise<T> {
  let auth = await getValidDropiAuth();
  try {
    return await doFetch<T>(auth, path, opts);
  } catch (err) {
    if (err instanceof DropiHttpError && err.status === 401) {
      logger.warn("dropi 401 — invalidating token cache and retrying once");
      invalidateDropiConnectionCache();
      auth = await getValidDropiAuth();
      return doFetch<T>(auth, path, opts);
    }
    throw err;
  }
}
