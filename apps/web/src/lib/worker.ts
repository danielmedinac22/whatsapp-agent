import { panelOperationIdCookie } from "./operation";

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:3001";
const TOKEN = process.env.WORKER_API_TOKEN ?? "";

/**
 * El header por el que la elección de operación del panel llega al worker.
 *
 * Es la otra mitad del mecanismo del ticket 07: la cookie es del navegador y
 * muere en `apps/web`, así que la elección se reenvía como header y las seis
 * rutas del worker que antes llamaban `panelOperation()` la toman de ahí, con
 * el mismo fallback a la operación única.
 *
 * **Se reenvía el id crudo, sin traducirlo a fila de este lado.** El worker lo
 * valida con la misma regla (`requirePanelOperation`), así que resolverlo aquí
 * sería una consulta por llamada para tirar el resultado. Y ausente significa
 * lo mismo en los dos lados: nadie eligió, va la única activa.
 */
export const OPERATION_HEADER = "x-operation-id";

/** El header, o nada si el admin nunca eligió. Nunca inventa un valor. */
async function operationHeader(): Promise<Record<string, string>> {
  const id = await panelOperationIdCookie();
  return id ? { [OPERATION_HEADER]: id } : {};
}

export async function workerFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${WORKER_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      ...(await operationHeader()),
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
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(await operationHeader()),
    },
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
