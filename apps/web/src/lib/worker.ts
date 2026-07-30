const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:3001";
const TOKEN = process.env.WORKER_API_TOKEN ?? "";

export async function workerFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${WORKER_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

/**
 * Multipart hacia el worker (notas de voz). Va aparte de `workerFetch` porque
 * ahí el content-type está fijado a JSON, y en multipart el boundary lo tiene
 * que poner fetch.
 */
export async function workerFetchMultipart(
  path: string,
  body: FormData,
): Promise<Response> {
  return fetch(`${WORKER_URL}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body,
    cache: "no-store",
  });
}

export async function workerJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await workerFetch(path, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`worker ${path} ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}
