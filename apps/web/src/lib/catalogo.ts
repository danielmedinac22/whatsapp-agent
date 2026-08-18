import {
  listCatalog,
  getAdReferralSignal,
  readAdReferralSignal,
  type AdReferralHealth,
  type Operation,
} from "@wa/db";
import { workerJson } from "@/lib/worker";

/**
 * Lo que la pantalla de catálogo necesita saber, armado en el servidor.
 *
 * Vive aquí y no en `lib/queries.ts` porque no consulta tablas: **todo lo de la
 * base pasa por el accesor de `@wa/db`**, que es el mismo que usa el worker. Lo
 * único que agrega este archivo es lo que el panel sí sabe y el accesor no: los
 * nombres, que para un producto conectado se leen de la tienda en tiempo de uso
 * y **no se copian a la base**.
 */

/** En qué estado estaba la tienda cuando se armó la pantalla. */
export type StoreState =
  | { store: "not_connected" }
  | { store: "unreachable"; error: string }
  | { store: "connected"; shopDomain: string };

interface StoreProduct {
  id: string;
  title: string;
  description: string;
  priceRange: { min: string; max: string; currency: string } | null;
}

type StoreRead =
  | { store: "not_connected" }
  | { store: "unreachable"; error: string }
  | { store: "connected"; shopDomain: string; result: StoreProduct[] };

/**
 * De dónde salió el nombre que se está mostrando. La pantalla lo necesita para
 * no prometer que sabe algo que no sabe: un producto conectado cuya tienda no
 * responde tiene id y no tiene nombre, y eso hay que decirlo.
 */
export type NameSource = "panel" | "tienda" | "sin_leer";

/** Un anuncio del producto, con los otros a los que también apunta. */
export interface CatalogAdView {
  adId: string;
  alsoPointsTo: Array<{ id: string; name: string }>;
}

/** Una fila de la tabla de catálogo. */
export interface CatalogRow {
  id: string;
  source: "shopify" | "native";
  name: string;
  description: string;
  nameSource: NameSource;
  shopifyProductId: string | null;
  price: string | null;
  createdAt: string;
  ads: CatalogAdView[];
}

export interface CatalogView {
  rows: CatalogRow[];
  store: StoreState;
  signal: {
    health: AdReferralHealth;
    windowDays: number;
    clicksInWindow: number;
    registeredClicksInWindow: number;
    clicksAllTime: number;
    conversations: number;
    registeredAds: number;
    lastClickAt: string | null;
  };
  operation: { name: string; countryCode: string; currency: string };
}

/**
 * Pide a la tienda la información de los productos conectados.
 *
 * El worker es el que tiene las credenciales de administración, y no salen de
 * ahí. Si el worker no contesta —está caído, o el panel corre sin él— el
 * catálogo **igual se dibuja**: lo que se pierde son los nombres de los
 * conectados, no la pantalla. Un catálogo que no carga porque la tienda no
 * responde deja al admin sin poder ni siquiera registrar un anuncio.
 */
async function readStore(shopifyIds: string[]): Promise<StoreRead> {
  try {
    if (shopifyIds.length === 0) {
      // Sin productos conectados igual hay que saber si la tienda está: es la
      // diferencia entre ofrecer «conectar de la tienda» y explicar por qué no.
      return await workerJson<StoreRead>("/api/catalog/store/products?ids=");
    }
    return await workerJson<StoreRead>(
      `/api/catalog/store/products?ids=${encodeURIComponent(shopifyIds.join(","))}`,
    );
  } catch (err) {
    return {
      store: "unreachable",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function formatPrice(p: StoreProduct["priceRange"]): string | null {
  if (!p) return null;
  const min = Number(p.min);
  const max = Number(p.max);
  const one = (n: number) =>
    `${p.currency} ${n.toLocaleString("es", { maximumFractionDigits: 2 })}`;
  return min === max ? one(min) : `${one(min)} – ${one(max)}`;
}

/**
 * El catálogo de una operación tal como se dibuja.
 *
 * El orden por defecto es el de creación; ordenar es de la pantalla, que es la
 * que sabe por qué columna. Los nombres de los conectados se resuelven contra
 * la tienda **acá y en cada carga**, que es lo que hace verdadero el criterio
 * del ticket: editar el producto allá se refleja acá sin sincronizar nada.
 */
export async function loadCatalogView(op: Operation): Promise<CatalogView> {
  const [entries, signal] = await Promise.all([
    listCatalog(op),
    getAdReferralSignal(op),
  ]);

  const shopifyIds = entries
    .map((e) => e.product.shopifyProductId)
    .filter((id): id is string => Boolean(id));

  const store = await readStore(shopifyIds);
  const byGid = new Map<string, StoreProduct>();
  if (store.store === "connected") {
    for (const p of store.result) {
      byGid.set(p.id, p);
      // `getProductsByIds` acepta el numérico y devuelve el GID; el catálogo
      // puede tener guardado cualquiera de los dos.
      const numeric = p.id.split("/").pop();
      if (numeric) byGid.set(numeric, p);
    }
  }

  // Primero los nombres, después los cruces: «también apunta a» necesita el
  // nombre del otro producto, que puede venir de la tienda.
  const named = entries.map((entry) => {
    const { product } = entry;
    if (product.source === "native") {
      return {
        entry,
        name: product.name ?? "(sin nombre)",
        description: product.description ?? "",
        nameSource: "panel" as NameSource,
        price: null as string | null,
      };
    }
    const gid = product.shopifyProductId ?? "";
    const fromStore = byGid.get(gid);
    if (!fromStore) {
      return {
        entry,
        name: gid.split("/").pop() ?? gid,
        description: "",
        nameSource: "sin_leer" as NameSource,
        price: null as string | null,
      };
    }
    return {
      entry,
      name: fromStore.title,
      description: fromStore.description,
      nameSource: "tienda" as NameSource,
      price: formatPrice(fromStore.priceRange),
    };
  });

  const nameById = new Map(named.map((n) => [n.entry.product.id, n.name]));

  const rows: CatalogRow[] = named.map((n) => ({
    id: n.entry.product.id,
    source: n.entry.product.source,
    name: n.name,
    description: n.description,
    nameSource: n.nameSource,
    shopifyProductId: n.entry.product.shopifyProductId,
    price: n.price,
    createdAt: n.entry.product.createdAt.toISOString(),
    ads: n.entry.ads.map((ad) => ({
      adId: ad.adId,
      alsoPointsTo: ad.alsoPointsTo.map((id) => ({
        id,
        name: nameById.get(id) ?? id,
      })),
    })),
  }));

  return {
    rows,
    store:
      store.store === "connected"
        ? { store: "connected", shopDomain: store.shopDomain }
        : store,
    signal: {
      health: readAdReferralSignal(signal),
      windowDays: signal.windowDays,
      clicksInWindow: signal.clicksInWindow,
      registeredClicksInWindow: signal.registeredClicksInWindow,
      clicksAllTime: signal.clicksAllTime,
      conversations: signal.conversations,
      registeredAds: signal.registeredAds,
      lastClickAt: signal.lastClickAt ? signal.lastClickAt.toISOString() : null,
    },
    operation: {
      name: op.name,
      countryCode: op.countryCode,
      currency: op.currency,
    },
  };
}
