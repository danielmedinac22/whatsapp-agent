/**
 * Cómo se consigue el token con el que se le habla a la tienda.
 *
 * Existe porque **la credencial de Shopify dejó de ser una cadena fija**. Hasta
 * la ola pasada, conectar una tienda era pegar un `shpat_` de app privada y
 * guardarlo; el modelo nuevo (Dev Dashboard) ya no emite ninguno: se piden
 * client id y secret, y con ellos se **acuña** un token que caduca a las 24
 * horas. Medido el 19-ago-2026 contra la tienda real de Guatemala:
 * `expires_in: 86399`.
 *
 * ## Por qué esto es un módulo y no dos líneas en `admin.ts`
 *
 * Porque el modo de fallar de guardar el token acuñado es el peor de este
 * proyecto: **el día uno todo funciona**. Se conecta la tienda, el informe de
 * permisos sale verde, se lee un producto, se cierra una venta de prueba. Y al
 * día siguiente el token vencido devuelve `401` en medio de un cierre, con el
 * cliente ya despedido creyendo que compró — que es exactamente el escenario
 * que `ventas-cierre-orden/01` salió a evitar cuando puso la verificación en
 * lectura. Un token que caduca no se guarda: se guarda **cómo pedirlo**.
 *
 * ## Las tres reglas
 *
 * 1. **La credencial fija sigue siendo válida y va primero.** Una tienda con un
 *    `shpat_` de app privada no tiene que migrar a nada. Si están las dos, gana
 *    la fija: es la que alguien pegó a mano y la que puede estar ahí para
 *    saltear un problema con la app.
 * 2. **El token acuñado vive en memoria del proceso, nunca en la base.** Si se
 *    guardara, dos procesos —worker y panel— podrían leer uno vencido escrito
 *    por el otro, y encima habría un secreto de vida corta durando para siempre
 *    en un `SELECT`.
 * 3. **Se renueva antes de vencer, no al fallar.** Reaccionar al `401` significa
 *    que el primer cierre después del vencimiento ya falló. El margen de
 *    {@link RENEWAL_MARGIN_MS} hace que el token se cambie mientras el viejo
 *    todavía sirve.
 *
 * ## Qué es puro acá y qué no
 *
 * {@link storeCredential} es pura y es donde vive la decisión: qué clase de
 * credencial tiene una conexión, o por qué no tiene ninguna. Lo impuro es
 * {@link mintAdminToken} —un `POST` y nada más— y la caché. Es el mismo reparto
 * que `capi/send.ts`: la decisión con fixtures, la red en el archivo más corto
 * posible.
 */

import type { ShopifyConnection } from "@wa/db";
import { logger } from "../lib/logger";

/**
 * Cuánto antes del vencimiento se pide uno nuevo: cinco minutos.
 *
 * No es un número mágico sino la respuesta a «¿cuánto puede durar lo que ya
 * empezó?». Un cierre entero —comprobar si el pedido existe, crearlo, leer la
 * respuesta— son segundos; cinco minutos cubren de sobra el peor caso con la
 * cola reintentando, y son irrelevantes frente a las 24 horas que dura.
 */
export const RENEWAL_MARGIN_MS = 5 * 60 * 1000;

/**
 * El tiempo que se le da al grant. Corto: si la acuñación se cuelga, el cierre
 * que la esperaba se cuelga con ella, y esto corre dentro de una cola que
 * reintenta.
 */
const MINT_TIMEOUT_MS = 10_000;

/** Los campos de los que sale la credencial. Un subconjunto, para poder probarlo. */
export type CredentialFields = Pick<
  ShopifyConnection,
  "shopDomain" | "adminAccessToken" | "clientId" | "clientSecret"
>;

/**
 * Con qué se le habla a la tienda.
 *
 * `none` lleva motivo porque los dos casos se arreglan distinto: una tienda a
 * medio configurar necesita que alguien complete el formulario, y una sin nada
 * necesita que alguien la conecte. Decir «no hay credencial» a secas manda a
 * las dos al mismo lugar equivocado.
 */
export type StoreCredential =
  /** Un `shpat_` fijo de app privada: se usa tal cual, no vence. */
  | { kind: "static"; shopDomain: string; token: string }
  /** Client id y secret del Dev Dashboard: hay que acuñar el token. */
  | {
      kind: "client_credentials";
      shopDomain: string;
      clientId: string;
      clientSecret: string;
    }
  | { kind: "none"; reason: "no_domain" | "no_credential" | "incomplete_client" };

function trimmed(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * Qué clase de credencial tiene una conexión. **Pura.**
 *
 * El orden —dominio, token fijo, par de cliente— es el orden en que las cosas
 * dejan de servir: sin dominio no hay a quién preguntarle, diga lo que diga el
 * resto.
 */
export function storeCredential(conn: CredentialFields): StoreCredential {
  // El dominio sale de acá con tipo `string` y no `string | null`, y eso no es
  // comodidad: las lecturas devuelven el dominio en su resultado, y sin el
  // estrechamiento cada llamador terminaba poniendo un cast — o sea, apagando
  // justo la comprobación que hace que una tienda a medio configurar no llegue
  // a la red.
  const shopDomain = trimmed(conn.shopDomain);
  if (!shopDomain) return { kind: "none", reason: "no_domain" };

  const staticToken = trimmed(conn.adminAccessToken);
  if (staticToken) return { kind: "static", shopDomain, token: staticToken };

  const clientId = trimmed(conn.clientId);
  const clientSecret = trimmed(conn.clientSecret);
  if (clientId && clientSecret) {
    return { kind: "client_credentials", shopDomain, clientId, clientSecret };
  }
  // Uno de los dos y no el otro: alguien guardó a medias. Es distinto de no
  // haber conectado nunca, y la pantalla lo dice distinto.
  if (clientId || clientSecret) {
    return { kind: "none", reason: "incomplete_client" };
  }
  return { kind: "none", reason: "no_credential" };
}

/** Por qué no se puede hablar con la tienda, en una línea para un operador. */
export function credentialGapText(
  reason: Extract<StoreCredential, { kind: "none" }>["reason"],
): string {
  switch (reason) {
    case "no_domain":
      return "la tienda no tiene dominio configurado";
    case "no_credential":
      return "la tienda no tiene credencial: falta el token de administración o el par client id + secret";
    case "incomplete_client":
      return "la credencial de la app quedó a medias: hacen falta client id **y** client secret";
  }
}

/** Lo que devuelve el grant, ya interpretado. */
export interface MintedToken {
  token: string;
  /** Momento absoluto en el que deja de servir, en milisegundos epoch. */
  expiresAt: number;
  /** Los permisos que el grant dice conceder, tal como los devolvió. */
  scope: string[];
}

/**
 * De la respuesta cruda del grant a un token con vencimiento. **Pura.**
 *
 * `expires_in` se trata como obligatorio a propósito: una respuesta sin él es
 * una respuesta que no entendemos, y suponerle una vida larga a un token que no
 * dijo cuánto dura es cómo se llega otra vez al `401` en medio de un cierre.
 */
export function readMintResponse(
  body: unknown,
  now: number,
): { ok: true; minted: MintedToken } | { ok: false; error: string } {
  const b = (body ?? {}) as {
    access_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  };
  const token = typeof b.access_token === "string" ? b.access_token.trim() : "";
  if (!token) return { ok: false, error: "la respuesta no trae access_token" };

  const seconds =
    typeof b.expires_in === "number"
      ? b.expires_in
      : typeof b.expires_in === "string"
        ? Number(b.expires_in)
        : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { ok: false, error: "la respuesta no dice cuánto dura el token" };
  }

  const scope =
    typeof b.scope === "string"
      ? b.scope
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  return { ok: true, minted: { token, expiresAt: now + seconds * 1000, scope } };
}

/** Si un token acuñado todavía sirve, con el margen de renovación. **Pura.** */
export function stillUsable(minted: MintedToken, now: number): boolean {
  return minted.expiresAt - RENEWAL_MARGIN_MS > now;
}

/**
 * Pide un token a la tienda. Lo único de este archivo que toca la red.
 *
 * El endpoint es el de OAuth y **no lleva versión de API**: es el mismo para
 * cualquier versión que tenga configurada la conexión.
 */
export async function mintAdminToken(
  shopDomain: string,
  clientId: string,
  clientSecret: string,
): Promise<{ ok: true; minted: MintedToken } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      error: `no se pudo pedir el token: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    // El cuerpo del error de Shopify dice si el secret está mal o si la app no
    // está instalada, y son cosas distintas. Se recorta porque termina en un log.
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      error: `la tienda rechazó las credenciales (${res.status}): ${text.slice(0, 200)}`,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "la tienda contestó algo que no es JSON" };
  }
  return readMintResponse(body, Date.now());
}

// ────────────────────────────────────────────────────────────────────────────
// La caché en memoria
// ────────────────────────────────────────────────────────────────────────────

/**
 * Un token acuñado por tienda, en memoria del proceso.
 *
 * La llave es el dominio y no la operación: el token pertenece a la tienda, y
 * dos operaciones que apuntaran al mismo dominio comparten legítimamente el
 * mismo. Al revés —cachear por operación— haría dos acuñaciones para lo mismo.
 *
 * El valor guarda la promesa y no el token para que **dos cierres simultáneos
 * no disparen dos grants**: el segundo espera el mismo `fetch` que el primero.
 */
const mintCache = new Map<
  string,
  { clientId: string; promise: Promise<{ ok: true; minted: MintedToken } | { ok: false; error: string }> }
>();
const mintedCache = new Map<string, MintedToken>();

/** Borra lo acuñado. Sin argumento, todo; con dominio, solo esa tienda. */
export function invalidateMintedTokens(shopDomain?: string): void {
  if (shopDomain) {
    mintCache.delete(shopDomain);
    mintedCache.delete(shopDomain);
    return;
  }
  mintCache.clear();
  mintedCache.clear();
}

export type ResolvedToken =
  | { ok: true; token: string }
  | { ok: false; error: string };

/**
 * El token con el que hablarle a esta tienda **ahora**.
 *
 * Es el único punto por el que todo el resto del sistema pide la credencial: la
 * lectura de productos, el informe de permisos y la creación del pedido. Que
 * sea uno solo es lo que hace que la renovación exista una vez y no tres veces
 * con una olvidada.
 */
export async function adminTokenFor(conn: CredentialFields): Promise<ResolvedToken> {
  const cred = storeCredential(conn);
  if (cred.kind === "none") {
    return { ok: false, error: credentialGapText(cred.reason) };
  }
  if (cred.kind === "static") return { ok: true, token: cred.token };

  const shopDomain = cred.shopDomain;
  const now = Date.now();

  const cached = mintedCache.get(shopDomain);
  if (cached && stillUsable(cached, now)) {
    return { ok: true, token: cached.token };
  }

  // Si el client id cambió, la acuñación en vuelo es de la credencial vieja.
  const inflight = mintCache.get(shopDomain);
  const pending =
    inflight && inflight.clientId === cred.clientId
      ? inflight.promise
      : (() => {
          const promise = mintAdminToken(
            shopDomain,
            cred.clientId,
            cred.clientSecret,
          );
          mintCache.set(shopDomain, { clientId: cred.clientId, promise });
          return promise;
        })();

  const result = await pending;
  mintCache.delete(shopDomain);

  if (!result.ok) {
    logger.warn({ shopDomain, error: result.error }, "shopify mint token failed");
    return { ok: false, error: result.error };
  }
  mintedCache.set(shopDomain, result.minted);
  logger.info(
    { shopDomain, expiresAt: new Date(result.minted.expiresAt).toISOString() },
    "shopify admin token renovado",
  );
  return { ok: true, token: result.minted.token };
}

/**
 * Los permisos que el grant declara, sin gastar una llamada extra.
 *
 * `access_scopes.json` sigue siendo la fuente para un token fijo, pero cuando
 * el token se acuña la respuesta del grant **ya trae el `scope`**. Devolverlo
 * de acá evita que el informe de permisos dependa de un segundo `GET` que puede
 * fallar por su cuenta.
 */
export function mintedScopesFor(shopDomain: string): string[] | null {
  const hit = mintedCache.get(shopDomain);
  return hit ? hit.scope : null;
}
