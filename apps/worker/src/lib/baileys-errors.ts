export type ErrorKind = "transient" | "permanent";

const TRANSIENT_PATTERNS = [
  /no whatsapp socket/i,
  /not connected/i,
  /connection closed/i,
  /connection lost/i,
  /connection failure/i,
  /timed? ?out/i,
  /timeout/i,
  /econnreset/i,
  /enotfound/i,
  /econnrefused/i,
  /etimedout/i,
  /websocket/i,
  /restart required/i,
  /service unavailable/i,
];

const PERMANENT_PATTERNS = [
  /not.?on.?whatsapp/i,
  /invalid jid/i,
  /forbidden/i,
  /not authorized/i,
  /logged.?out/i,
  /banned/i,
  /body too long/i,
];

interface BoomLike {
  isBoom?: boolean;
  output?: { statusCode?: number };
  data?: { statusCode?: number };
}

function getStatusCode(err: unknown): number | undefined {
  const e = err as BoomLike | undefined;
  return e?.output?.statusCode ?? e?.data?.statusCode;
}

export function classifyBaileysError(err: unknown): ErrorKind {
  if (!err) return "transient";

  const code = getStatusCode(err);
  // 401/403 → auth/banned. 410 = device gone. 404 = jid not found.
  if (code === 401 || code === 403 || code === 410 || code === 404) {
    return "permanent";
  }
  if (code && code >= 500) return "transient";

  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : JSON.stringify(err);

  for (const re of PERMANENT_PATTERNS) if (re.test(msg)) return "permanent";
  for (const re of TRANSIENT_PATTERNS) if (re.test(msg)) return "transient";

  // Default: transient. Better to retry than silently drop.
  return "transient";
}
