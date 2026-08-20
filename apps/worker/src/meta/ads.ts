/**
 * La lista de anuncios de la cuenta publicitaria de una operación.
 *
 * Existe para una sola cosa: que registrar un anuncio en el catálogo sea
 * **elegirlo por su nombre** en vez de pegar `120249621052150761` a mano. Es la
 * forma que cerró `ventas-pulido-ui/03` («variante F») y el último criterio
 * abierto de `ventas-panel/03`.
 *
 * ## Lo que este módulo NO hace, y no es un olvido
 *
 * **No escribe nada sobre la pauta.** El token que usa tiene `ads_read` y solo
 * eso — se pidió así a propósito: `ads_management` dispara la revisión más dura
 * de Meta y acá no hace falta para nada. Si algún día este archivo necesitara un
 * `POST`, la respuesta correcta es que no lo necesita.
 *
 * ## El nombre del anuncio no alcanza, y por eso se lee la campaña
 *
 * Medido contra la cuenta real el 18-ago-2026: **200 anuncios, 122 nombres
 * distintos, y 92 comparten nombre** — «VIDEO 1» aparece 23 veces. Una lista
 * que solo mostrara el nombre del anuncio sería una lista con veintitrés
 * opciones idénticas, o sea peor que pegar el id. Lo que identifica es el
 * **nombre de la campaña** (`DHT WHATSAPP SEBAS CBO GTM 12 08 2026`), y por eso
 * viaja en el mismo pedido y no en una segunda vuelta.
 *
 * ## La cuenta no entra entera, y por eso se lee en dos pasadas
 *
 * Medido el 19-ago-2026: la cuenta tiene **905 anuncios y 24 activos**. Leerlos
 * todos en cada apertura de ficha es absurdo, así que hay un tope — y el tope
 * introduce el fallo que este módulo tiene que evitar: **recortar antes de
 * ordenar**. Meta no promete devolver primero los activos, así que un anuncio
 * recién lanzado puede caer en la posición 700 y quedar fuera de la ventana. La
 * pantalla diría «ningún anuncio coincide» sobre el anuncio que la persona
 * acaba de crear, que es exactamente el caso para el que existe la lista.
 *
 * Por eso la lectura son **dos pasadas**: primero los activos filtrados por
 * Meta —completos, porque son pocos— y después el resto hasta agotar el
 * presupuesto. Así el recorte solo puede caerse anuncios pausados de meses
 * anteriores, que es lo que nadie está buscando.
 *
 * ## Por qué el estado se devuelve como valor y no como excepción
 *
 * Igual que la tienda: «la cuenta publicitaria no está conectada» es un estado
 * esperado y va a volver a pasar solo el día que revoquen el token. La pantalla
 * tiene que poder explicarlo y ofrecer el campo a mano, que es el respaldo
 * permanente — «F no reemplaza a las otras, las envuelve». Un `500` en la
 * pantalla de catálogo escondería el camino que sí funciona.
 */

import type { Operation } from "@wa/db";
import { logger } from "../lib/logger";

/**
 * El token de **usuario de sistema** con `ads_read`.
 *
 * Va en el entorno y no en la base, por la misma razón que el de CAPI: es una
 * credencial del portafolio de negocio que contiene las dos cuentas, no de una
 * operación. Lo que sí es por operación es **a qué cuenta** se le pregunta, y
 * eso vive en `operations.meta_ad_account_id`.
 *
 * Es una variable distinta de la de CAPI aunque hoy el token sea el mismo, y a
 * propósito: leer anuncios es inofensivo y reportar conversiones no lo es.
 * Separadas, revocar el permiso de escritura no apaga la pantalla de catálogo,
 * y encender el reporte a Meta no puede pasar por descuido al cargar la lectura.
 */
export const ADS_TOKEN_ENV = "META_ADS_SYSTEM_USER_TOKEN";

/** La versión de la Graph API para leer anuncios. Ver `capi/send-mode.ts`. */
export const ADS_GRAPH_VERSION_ENV = "META_GRAPH_API_VERSION";
export const DEFAULT_ADS_GRAPH_VERSION = "v26.0";

/**
 * Cuántos anuncios se traen como mucho por pasada. Los activos entran completos
 * en la primera; el tope solo recorta la cola de pausados.
 */
const MAX_ADS = 500;
/** Cuántos por página: el máximo cómodo de la Graph API sin que empiece a cortar. */
const PAGE_SIZE = 100;
const TIMEOUT_MS = 15_000;
/** La lista cambia cuando el cliente lanza pauta, no entre dos clics. */
const TTL_MS = 5 * 60 * 1000;

/** Un anuncio, como lo necesita quien elige. */
export interface MetaAd {
  id: string;
  name: string;
  /** `ACTIVE`, `PAUSED`, … tal como lo dice Meta. */
  status: string;
  /** El nombre de la campaña: lo único que distingue 23 «VIDEO 1». */
  campaignName: string | null;
  campaignId: string | null;
}

/**
 * En qué estado está la cuenta publicitaria cuando el panel le pregunta.
 *
 * Los tres se arreglan distinto y por eso son tres: sin cuenta configurada
 * alguien tiene que pegar el `act_...`; sin token alguien tiene que cargarlo en
 * el entorno y desplegar; e `unreachable` es un problema del momento.
 */
export type AdsRead =
  | { account: "not_configured" }
  | { account: "no_token" }
  | { account: "unreachable"; adAccountId: string; error: string }
  | { account: "connected"; adAccountId: string; ads: MetaAd[]; truncated: boolean };

interface AdNode {
  id?: unknown;
  name?: unknown;
  effective_status?: unknown;
  campaign?: { id?: unknown; name?: unknown } | null;
}

/**
 * De lo que contesta Meta a lo que la pantalla necesita. **Pura.**
 *
 * Un anuncio sin id se descarta: es lo único sin lo cual la fila no sirve para
 * nada —no se puede registrar— y dejarlo pasar pondría en la lista una opción
 * que al elegirla no hace nada.
 */
export function toMetaAds(data: unknown): MetaAd[] {
  const nodes = Array.isArray((data as { data?: unknown } | null)?.data)
    ? ((data as { data: AdNode[] }).data)
    : [];
  const ads: MetaAd[] = [];
  for (const n of nodes) {
    const id = typeof n?.id === "string" ? n.id : null;
    if (!id) continue;
    ads.push({
      id,
      name: typeof n.name === "string" && n.name.trim() ? n.name : `(sin nombre) ${id}`,
      status:
        typeof n.effective_status === "string" ? n.effective_status : "UNKNOWN",
      campaignName:
        typeof n.campaign?.name === "string" ? n.campaign.name : null,
      campaignId: typeof n.campaign?.id === "string" ? n.campaign.id : null,
    });
  }
  return ads;
}

/** La página siguiente, si Meta dijo que hay. **Pura.** */
export function nextPageUrl(data: unknown): string | null {
  const next = (data as { paging?: { next?: unknown } } | null)?.paging?.next;
  return typeof next === "string" && next ? next : null;
}

/**
 * El orden en que se muestran: primero los activos, después por campaña y
 * nombre. **Pura.**
 *
 * No es cosmético. El anuncio que alguien va a registrar es, casi siempre, el
 * que acaba de lanzar — y la cuenta arrastra cientos de pausados de meses
 * anteriores. Sin este orden, la lista se abre en «FRANK 3 NUEVO 25 07», que
 * está pausado desde julio.
 */
export function sortAds(ads: readonly MetaAd[]): MetaAd[] {
  const rank = (a: MetaAd) => (a.status === "ACTIVE" ? 0 : 1);
  return [...ads].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.campaignName ?? "").localeCompare(b.campaignName ?? "", "es") ||
      a.name.localeCompare(b.name, "es"),
  );
}

const cache = new Map<string, { expires: number; read: AdsRead }>();

/** Borra la lista cacheada. Sin argumento, la de todas las cuentas. */
export function invalidateAdsCache(adAccountId?: string): void {
  if (adAccountId) cache.delete(adAccountId);
  else cache.clear();
}

/**
 * Los anuncios de la cuenta publicitaria de una operación.
 *
 * La operación va primero, como en todos los accesores desde la migración
 * multi-operación: sin cuenta propia no se lee nada, nunca la de al lado.
 * Registrar un anuncio colombiano eligiéndolo de la lista de Guatemala es
 * exactamente el error que esa migración salió a borrar.
 */
export async function listOperationAds(op: Operation): Promise<AdsRead> {
  const adAccountId = op.metaAdAccountId?.trim();
  if (!adAccountId) return { account: "not_configured" };

  const token = process.env[ADS_TOKEN_ENV]?.trim();
  if (!token) return { account: "no_token" };

  const hit = cache.get(adAccountId);
  if (hit && hit.expires > Date.now()) return hit.read;

  const version =
    process.env[ADS_GRAPH_VERSION_ENV]?.trim() || DEFAULT_ADS_GRAPH_VERSION;

  // Pasada 1: los activos, **completos**. Es el conjunto chico y el único que
  // no puede faltar.
  const activos = await fetchAds(adAccountId, version, token, ACTIVE_ONLY, MAX_ADS);
  if (!activos.ok) {
    return { account: "unreachable", adAccountId, error: activos.error };
  }

  // Pasada 2: el resto, hasta agotar el presupuesto. Vuelve a traer los activos
  // y por eso se deduplica por id.
  const resto = await fetchAds(adAccountId, version, token, null, MAX_ADS);
  if (!resto.ok) {
    return { account: "unreachable", adAccountId, error: resto.error };
  }

  const vistos = new Set(activos.ads.map((a) => a.id));
  const ads = [...activos.ads];
  for (const a of resto.ads) {
    if (vistos.has(a.id)) continue;
    vistos.add(a.id);
    ads.push(a);
  }

  if (resto.truncated) {
    // El corte se dice, no se esconde: una lista recortada en silencio se ve
    // igual que una lista completa, y el anuncio que falta parece no existir.
    logger.info(
      { adAccountId, max: MAX_ADS, activos: activos.ads.length },
      "lista de anuncios recortada · los activos entraron todos",
    );
  }

  const read: AdsRead = {
    account: "connected",
    adAccountId,
    ads: sortAds(ads),
    truncated: resto.truncated,
  };
  cache.set(adAccountId, { expires: Date.now() + TTL_MS, read });
  return read;
}

/** El filtro de Meta que devuelve solo los anuncios que están corriendo. */
const ACTIVE_ONLY = JSON.stringify([
  { field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] },
]);

/**
 * Una pasada paginada sobre `/{cuenta}/ads`.
 *
 * `filtering` en `null` trae todo. El bucle corta por presupuesto o porque Meta
 * dejó de ofrecer página siguiente, y `truncated` distingue las dos: solo la
 * primera significa que falta algo.
 */
async function fetchAds(
  adAccountId: string,
  version: string,
  token: string,
  filtering: string | null,
  budget: number,
): Promise<
  { ok: true; ads: MetaAd[]; truncated: boolean } | { ok: false; error: string }
> {
  const base = () => {
    const p = new URLSearchParams({
      fields: "id,name,effective_status,campaign{id,name}",
      limit: String(PAGE_SIZE),
    });
    if (filtering) p.set("filtering", filtering);
    return p;
  };

  let url: string | null =
    `https://graph.facebook.com/${version}/${encodeURIComponent(adAccountId)}/ads?${base()}`;
  const ads: MetaAd[] = [];
  let truncated = false;

  try {
    while (url) {
      const res: Response = await fetch(url, {
        // En la cabecera y no en la URL: un `access_token=` en la ruta termina
        // escrito en cualquier log de red. Mismo criterio que `capi/send.ts`.
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          (body as { error?: { message?: string } } | null)?.error?.message ??
          `HTTP ${res.status}`;
        return { ok: false, error: message };
      }
      ads.push(...toMetaAds(body));

      const next = nextPageUrl(body);
      if (!next) break;
      if (ads.length >= budget) {
        truncated = true;
        break;
      }
      // Se rearma la URL en vez de seguir la de `paging.next`, que trae el
      // token adentro: seguirla lo mandaría por la URL en cada página.
      const after = new URL(next).searchParams.get("after");
      if (!after) break;
      const p = base();
      p.set("after", after);
      url = `https://graph.facebook.com/${version}/${encodeURIComponent(adAccountId)}/ads?${p}`;
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true, ads, truncated };
}
