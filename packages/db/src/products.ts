import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "./client";
import type { Operation } from "./schema";
import {
  conversations,
  productAds,
  products,
  type Product,
} from "./schema";

/**
 * Accesor único del catálogo de ventas y del mapeo anuncio→productos.
 *
 * La migración `0022` dejó `products` y `product_ads` aplicadas en producción y
 * vacías; lo que faltaba era esto. Vive en `@wa/db` y no en el panel por la
 * misma razón que sus dos hermanos (`agent-settings.ts`,
 * `sales-agent-settings.ts`): **el panel escribe el catálogo y el worker lo
 * lee**, y un accesor por aplicación es la forma de que las dos mitades del
 * mismo módulo se desincronicen.
 *
 * La regla de aislamiento es la de siempre y por el mismo motivo: pedir el
 * catálogo de una operación que no tiene productos devuelve **la lista vacía,
 * nunca la de otra**. Acá el daño de preferir «algún catálogo» a «ninguno» es
 * concreto: el reconocimiento resolvería un lead guatemalteco contra un
 * producto colombiano, y lo que el cliente recibe es información —precio,
 * moneda, disponibilidad— del SKU equivocado. Sin catálogo el reconocimiento
 * cae al nivel siguiente y pregunta, que se nota; con el catálogo de la vecina
 * responde mal, que no se nota.
 *
 * **Registrar no es reconocer.** Este archivo llena el mapa; el reconocimiento
 * hace lo contrario —toma el `ad_id` del mensaje entrante y lo busca acá—. Si
 * la referencia del anuncio no llega, el mapa queda perfecto y nunca se
 * consulta. Por eso {@link getAdReferralSignal} está en este mismo archivo y no
 * en la pantalla: es la única forma de que el módulo no pueda estar muerto y
 * verse sano.
 */

// ────────────────────────────────────────────────────────────────────────────
// Las reglas, puras y sin base de datos
// ────────────────────────────────────────────────────────────────────────────

/** Lo mínimo que la resolución necesita de un producto para decidir. */
export interface ScopedProductRow {
  id: string;
  operationId: string;
}

/** Lo mínimo que la resolución necesita de un mapeo anuncio→producto. */
export interface ScopedProductAdRow {
  operationId: string;
  productId: string;
  adId: string;
}

/**
 * El catálogo de una operación, puro: las filas que le corresponden.
 *
 * Devolver la lista vacía para una operación sin productos es la mitad
 * importante. La otra es que **ninguna fila de otra operación puede colarse**:
 * de acá salen los candidatos que el reconocimiento compara y los productos que
 * el panel deja asociar a un anuncio.
 */
export function resolveCatalog<T extends ScopedProductRow>(
  rows: readonly T[],
  op: Operation,
): T[] {
  return rows.filter((r) => r.operationId === op.id);
}

/**
 * Un producto por su id, **dentro de la operación**, o `null`.
 *
 * `null` y no la fila cuando el id existe pero es de otra operación: un id de
 * producto es un `string` y puede llegar de la URL de la pantalla o del cuerpo
 * de una petición, o sea de afuera. Que un id ajeno resuelva a `null` es lo que
 * hace que abrir —o peor, editar— el producto de la operación vecina sea
 * imposible aunque alguien escriba el uuid a mano.
 */
export function resolveProduct<T extends ScopedProductRow>(
  rows: readonly T[],
  op: Operation,
  productId: string,
): T | null {
  return (
    rows.find((r) => r.id === productId && r.operationId === op.id) ?? null
  );
}

/**
 * El **conjunto** de productos a los que apunta un anuncio, dentro de la
 * operación. Es la consulta del nivel 1 de la cascada de reconocimiento
 * (`where operation_id = ? and ad_id = ?`), escrita como regla.
 *
 * Conjunto y no producto: un anuncio de familia o de combo apunta a varios a
 * propósito, y ahí la cascada tiene que quedar **ambigua**, no elegir. Devolver
 * uno solo —el primero, el más vendido— sería elegir en el borde lo que la
 * cascada existe para no elegir.
 *
 * El `trim` es del lado del que busca porque el `ad_id` que llega en el
 * `referral` y el que el admin pegó a mano tienen que encontrarse: el pegado
 * arrastra espacios y saltos de línea.
 */
export function resolveProductIdsForAd<T extends ScopedProductAdRow>(
  rows: readonly T[],
  op: Operation,
  adId: string,
): string[] {
  const wanted = adId.trim();
  if (!wanted) return [];
  return rows
    .filter((r) => r.operationId === op.id && r.adId === wanted)
    .map((r) => r.productId);
}

/**
 * De los ids que alguien pide asociar, los que de verdad son de esta operación.
 *
 * La clave foránea compuesta de `product_ads` ya lo impide en la base, así que
 * esto no es la barrera: es lo que convierte un error de la pantalla en
 * «asocié dos de los tres» en vez de en una transacción que revienta entera.
 * Conserva el orden pedido y no duplica.
 */
export function productIdsWithinCatalog<T extends ScopedProductRow>(
  rows: readonly T[],
  op: Operation,
  requested: readonly string[],
): string[] {
  const catalog = new Set(resolveCatalog(rows, op).map((r) => r.id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of requested) {
    if (!catalog.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Si un identificador tiene forma de uuid.
 *
 * No valida que exista: eso lo hace el catálogo. Sirve para que un id
 * inventado por el navegador se responda como «ese producto no es de esta
 * operación» y no como un error de sintaxis de Postgres.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** Un anuncio registrado sobre un producto, y a qué **otros** apunta. */
export interface CatalogAd {
  adId: string;
  /**
   * Los otros productos de la misma operación a los que apunta este anuncio.
   * Vacío cuando es exclusivo.
   *
   * Existe porque desde la ficha de un producto **un anuncio compartido parece
   * exclusivo**, y no lo es: el ticket pide que el N:M «se vea claramente» en
   * los dos sentidos, y sin esto el N:M existe en la base y no en la pantalla.
   */
  alsoPointsTo: string[];
}

/** Un producto del catálogo con los anuncios que lo alimentan. */
export interface CatalogEntry<P extends ScopedProductRow = Product> {
  product: P;
  ads: CatalogAd[];
}

/**
 * El catálogo de una operación con su mapeo resuelto: cada producto con sus
 * anuncios, y cada anuncio compartido diciendo a qué otros productos apunta.
 *
 * Es la forma que la pantalla dibuja y la que hace verificable la regla de
 * aislamiento **en los dos sentidos**: ni un producto ajeno entra al catálogo,
 * ni el nombre de un producto ajeno aparece como «también apunta a».
 *
 * Los anuncios de cada producto salen ordenados como llegaron y el catálogo
 * conserva el orden de las filas: quien ordena la tabla es la pantalla, que es
 * la que sabe por qué columna.
 */
export function buildCatalog<
  P extends ScopedProductRow,
  A extends ScopedProductAdRow,
>(productRows: readonly P[], adRows: readonly A[], op: Operation): CatalogEntry<P>[] {
  const catalog = resolveCatalog(productRows, op);
  const known = new Set(catalog.map((p) => p.id));

  // Solo los mapeos de esta operación, y solo los que apuntan a un producto
  // que el catálogo tiene. La FK compuesta ya garantiza lo segundo en la base;
  // acá se sostiene igual porque esta función también corre sobre fixtures.
  const mine = adRows.filter(
    (r) => r.operationId === op.id && known.has(r.productId),
  );

  const productsByAd = new Map<string, string[]>();
  for (const row of mine) {
    const list = productsByAd.get(row.adId);
    if (list) list.push(row.productId);
    else productsByAd.set(row.adId, [row.productId]);
  }

  return catalog.map((product) => ({
    product,
    ads: mine
      .filter((r) => r.productId === product.id)
      .map((r) => ({
        adId: r.adId,
        alsoPointsTo: (productsByAd.get(r.adId) ?? []).filter(
          (id) => id !== product.id,
        ),
      })),
  }));
}

/**
 * Los anuncios de una operación vistos **desde el anuncio**: cada id con todos
 * sus productos.
 *
 * Es el mismo mapeo que {@link buildCatalog} mirado del otro lado, y existe
 * porque el ticket pide el N:M «en ambos sentidos». Ordenado por cantidad de
 * productos y después por id, para que los compartidos —los que hay que mirar—
 * queden arriba.
 */
export function buildAdIndex<A extends ScopedProductAdRow>(
  adRows: readonly A[],
  op: Operation,
): Array<{ adId: string; productIds: string[] }> {
  const byAd = new Map<string, string[]>();
  for (const row of adRows) {
    if (row.operationId !== op.id) continue;
    const list = byAd.get(row.adId);
    if (list) list.push(row.productId);
    else byAd.set(row.adId, [row.productId]);
  }
  return [...byAd.entries()]
    .map(([adId, productIds]) => ({ adId, productIds }))
    .sort(
      (a, b) =>
        b.productIds.length - a.productIds.length || a.adId.localeCompare(b.adId),
    );
}

/**
 * Qué se puede escribir sobre un producto según su origen.
 *
 * Un producto conectado **no copia** su información: nombre y descripción se
 * leen de la tienda en tiempo de uso, y por eso `products.name` es nullable en
 * vez de `NOT NULL`. Escribirlos acá sería exactamente la desincronización
 * silenciosa que esa decisión evita — el panel mostrando un nombre que la
 * tienda ya cambió, sin que nada avise.
 *
 * El `CHECK` de la base (`products_source_check`) lo impide igual; esto existe
 * para que la pantalla pueda decir *por qué* antes de intentarlo, en vez de
 * traducir un error de Postgres.
 */
export function isEditableInPanel(source: Product["source"]): boolean {
  return source === "native";
}

// ────────────────────────────────────────────────────────────────────────────
// Lecturas
// ────────────────────────────────────────────────────────────────────────────

/**
 * El catálogo de una operación con su mapeo de anuncios.
 *
 * Dos consultas y la resolución en memoria con {@link buildCatalog}, igual que
 * los accesores hermanos: la regla de aislamiento vive en un solo lugar —el que
 * los tests ejercen— y no partida entre un `where` de SQL y un `filter` de
 * TypeScript, que es como se desincronizan. Las dos consultas ya filtran por
 * operación, así que el `filter` no es lo único que protege: es lo que se puede
 * probar.
 *
 * El catálogo real de Vorare son 17 productos y el de mañana, decenas: traerlo
 * entero es lo correcto y lo seguirá siendo. Si algún día no lo fuera, lo que
 * cambia es esto, no la regla.
 */
export async function listCatalog(op: Operation): Promise<CatalogEntry[]> {
  const db = getDb();
  const [productRows, adRows] = await Promise.all([
    db
      .select()
      .from(products)
      .where(eq(products.operationId, op.id))
      .orderBy(asc(products.createdAt)),
    db
      .select()
      .from(productAds)
      .where(eq(productAds.operationId, op.id))
      .orderBy(asc(productAds.createdAt)),
  ]);
  return buildCatalog(productRows, adRows, op);
}

/** Todos los mapeos de una operación, vistos desde el anuncio. */
export async function listAdIndex(
  op: Operation,
): Promise<Array<{ adId: string; productIds: string[] }>> {
  const rows = await getDb()
    .select()
    .from(productAds)
    .where(eq(productAds.operationId, op.id));
  return buildAdIndex(rows, op);
}

/**
 * Un producto de la operación, o `null` si no existe **o es de otra**.
 *
 * Filtra por las dos columnas en SQL y vuelve a resolverlo con la función pura:
 * el id llega de afuera —de la URL de la ficha o del cuerpo de una petición— y
 * esta es la puerta por la que entraría el producto de la operación vecina.
 */
export async function getProduct(
  op: Operation,
  productId: string,
): Promise<Product | null> {
  if (!isUuid(productId)) return null;
  const rows = await getDb()
    .select()
    .from(products)
    .where(and(eq(products.operationId, op.id), eq(products.id, productId)))
    .limit(1);
  return resolveProduct(rows, op, productId);
}

/**
 * El conjunto de productos al que apunta un anuncio en esta operación.
 *
 * Es la consulta del nivel 1 de la cascada, y la que verifica que asociar un
 * mismo anuncio a varios productos «queda consultable como conjunto».
 */
export async function listProductIdsForAd(
  op: Operation,
  adId: string,
): Promise<string[]> {
  const wanted = adId.trim();
  if (!wanted) return [];
  const rows = await getDb()
    .select()
    .from(productAds)
    .where(
      and(eq(productAds.operationId, op.id), eq(productAds.adId, wanted)),
    );
  return resolveProductIdsForAd(rows, op, wanted);
}

// ────────────────────────────────────────────────────────────────────────────
// Escrituras
// ────────────────────────────────────────────────────────────────────────────

/** Lo que el admin escribe al crear un producto nativo. */
export interface NativeProductInput {
  name: string;
  description?: string | null;
}

/**
 * Un producto que todavía no existe en la tienda. Nombre y descripción viven
 * acá porque no hay de dónde leerlos.
 */
export async function createNativeProduct(
  op: Operation,
  input: NativeProductInput,
): Promise<Product> {
  const name = input.name.trim();
  if (!name) throw new Error("un producto nativo necesita nombre");
  const [row] = await getDb()
    .insert(products)
    .values({
      operationId: op.id,
      source: "native",
      name,
      description: input.description?.trim() || null,
    })
    .returning();
  if (!row) throw new Error("no se pudo crear el producto");
  return row;
}

/**
 * Conecta un producto que ya existe en la tienda de esta operación.
 *
 * **No se copia ni el nombre ni la descripción**: se guarda el identificador y
 * nada más. El único parcial `(operation_id, shopify_product_id)` mantiene el
 * uno a uno con la tienda, así que conectar dos veces el mismo producto no crea
 * el segundo: devuelve el que ya estaba.
 */
export async function connectShopifyProduct(
  op: Operation,
  shopifyProductId: string,
): Promise<Product> {
  const gid = shopifyProductId.trim();
  if (!gid) throw new Error("falta el identificador del producto de la tienda");

  const existing = await getDb()
    .select()
    .from(products)
    .where(
      and(
        eq(products.operationId, op.id),
        eq(products.shopifyProductId, gid),
      ),
    )
    .limit(1);
  const already = existing[0];
  if (already) return already;

  const [row] = await getDb()
    .insert(products)
    .values({ operationId: op.id, source: "shopify", shopifyProductId: gid })
    .returning();
  if (!row) throw new Error("no se pudo conectar el producto");
  return row;
}

/**
 * Edita un producto **nativo**. Sobre uno conectado lanza: el panel no escribe
 * sobre la tienda, y eso tiene que fallar acá y no producir una copia local que
 * después se desincroniza.
 */
export async function updateNativeProduct(
  op: Operation,
  productId: string,
  input: Partial<NativeProductInput>,
): Promise<Product> {
  const current = await getProduct(op, productId);
  if (!current) throw new Error("el producto no existe en esta operación");
  if (!isEditableInPanel(current.source)) {
    throw new Error(
      "este producto vive en la tienda: su información se lee de ahí, el panel no la escribe",
    );
  }

  const name = input.name?.trim();
  if (input.name !== undefined && !name) {
    throw new Error("un producto nativo necesita nombre");
  }

  const [row] = await getDb()
    .update(products)
    .set({
      ...(name ? { name } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(products.operationId, op.id), eq(products.id, productId)))
    .returning();
  if (!row) throw new Error("el producto no existe en esta operación");
  return row;
}

/** Saca un producto del catálogo. Sus mapeos se van con él (`cascade`). */
export async function deleteProduct(
  op: Operation,
  productId: string,
): Promise<boolean> {
  if (!isUuid(productId)) return false;
  const rows = await getDb()
    .delete(products)
    .where(and(eq(products.operationId, op.id), eq(products.id, productId)))
    .returning({ id: products.id });
  return rows.length > 0;
}

/**
 * Asocia un anuncio a uno o varios productos de la operación.
 *
 * **Varios de una vez es el camino corto del N:M**, no una comodidad: es lo que
 * la selección múltiple de la tabla dispara, y es la forma en que un anuncio de
 * familia o de combo queda registrado sin inventar un producto falso.
 *
 * Los ids que no son de esta operación se descartan antes de escribir
 * ({@link productIdsWithinCatalog}) y se informan en la respuesta: la clave
 * foránea compuesta los rechazaría igual, pero reventando la transacción
 * entera. Repetir una asociación que ya existe no es error —el admin acaba de
 * pegar el mismo id— y no toca la fila que ya estaba.
 */
export async function linkAdToProducts(
  op: Operation,
  adId: string,
  productIds: readonly string[],
): Promise<{ linked: string[]; rejected: string[] }> {
  const wanted = adId.trim();
  if (!wanted) throw new Error("falta el identificador del anuncio");
  if (productIds.length === 0) return { linked: [], rejected: [] };

  // Los ids llegan del navegador, así que pueden no ser uuid. Se filtran antes
  // de consultar y no después: un id mal formado dentro de un `in (...)` hace
  // que Postgres rechace la consulta entera con su propio mensaje, y el admin
  // ve «invalid input syntax for type uuid» en vez de «ese producto no es de
  // esta operación». Los que no pasan caen solos en `rejected`.
  const candidates = [...new Set(productIds)].filter(isUuid);
  const catalog = candidates.length
    ? await getDb()
        .select({ id: products.id, operationId: products.operationId })
        .from(products)
        .where(
          and(
            eq(products.operationId, op.id),
            inArray(products.id, candidates),
          ),
        )
    : [];

  const linked = productIdsWithinCatalog(catalog, op, productIds);
  const rejected = [...new Set(productIds)].filter((id) => !linked.includes(id));
  if (linked.length === 0) return { linked: [], rejected };

  await getDb()
    .insert(productAds)
    .values(
      linked.map((productId) => ({
        operationId: op.id,
        productId,
        adId: wanted,
      })),
    )
    .onConflictDoNothing();

  return { linked, rejected };
}

/** Quita la asociación de un anuncio con un producto. */
export async function unlinkAd(
  op: Operation,
  adId: string,
  productId: string,
): Promise<boolean> {
  if (!isUuid(productId)) return false;
  const rows = await getDb()
    .delete(productAds)
    .where(
      and(
        eq(productAds.operationId, op.id),
        eq(productAds.productId, productId),
        eq(productAds.adId, adId.trim()),
      ),
    )
    .returning({ adId: productAds.adId });
  return rows.length > 0;
}

// ────────────────────────────────────────────────────────────────────────────
// La señal que impide que el módulo esté muerto y se vea sano
// ────────────────────────────────────────────────────────────────────────────

/** Lo que se sabe de los clics de anuncio que llegaron a esta operación. */
export interface AdReferralSignal {
  /** Días que mira la ventana. */
  windowDays: number;
  /** Conversaciones de la operación cuya referencia de anuncio llegó en la ventana. */
  clicksInWindow: number;
  /** De esas, las que traían un anuncio **registrado** en el catálogo. */
  registeredClicksInWindow: number;
  /** Conversaciones con referencia de anuncio desde siempre. */
  clicksAllTime: number;
  /** Cuándo llegó la última referencia, o `null` si nunca llegó ninguna. */
  lastClickAt: Date | null;
  /** Conversaciones de la operación, para poner el cero en contexto. */
  conversations: number;
  /** Anuncios distintos registrados hoy en el catálogo. */
  registeredAds: number;
}

/**
 * Cuántos clics de anuncio llegaron, y cuántos de anuncios registrados.
 *
 * **Es la contra-medida de la trampa del módulo.** Registrar llena el mapa;
 * reconocer lo consulta. Si la referencia del anuncio no llega —hoy no llega
 * nunca: 1.722 conversaciones, cero con `ad_id`— el mapa queda perfecto, la
 * pantalla se ve completa y correcta, y no pasa nada. Sin este número no hay
 * forma de notarlo desde el panel: cargar más ids se ve igual de bien.
 *
 * `registeredClicksInWindow` es el que de verdad importa: clics que llegaron
 * **y** encontraron su anuncio en el mapa. Un número alto de clics con cero
 * registrados dice lo contrario que cero clics — ahí el mapa está incompleto,
 * no muerto.
 *
 * Cuenta por `ad_referral_at`, que es cuándo llegó el clic, y no por
 * `created_at` de la conversación: la conversación es una por contacto para
 * siempre, y un recomprador que hace clic hoy tiene la conversación de hace
 * meses.
 */
export async function getAdReferralSignal(
  op: Operation,
  windowDays = 7,
): Promise<AdReferralSignal> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  // Dentro de un `sql` crudo el parámetro va sin tipo y el driver no sabe
  // serializar un `Date`; el `::timestamptz` se lo dice. Donde la comparación
  // pasa por una columna tipada (`gte`, abajo) no hace falta.
  const sinceParam = sql`${since.toISOString()}::timestamptz`;
  const db = getDb();

  const [totals] = await db
    .select({
      clicksInWindow: sql<number>`count(*) filter (where ${conversations.adId} is not null and ${conversations.adReferralAt} >= ${sinceParam})::int`,
      clicksAllTime: sql<number>`count(*) filter (where ${conversations.adId} is not null)::int`,
      lastClickAt: sql<Date | null>`max(${conversations.adReferralAt})`,
      conversations: sql<number>`count(*)::int`,
    })
    .from(conversations)
    .where(eq(conversations.operationId, op.id));

  // Los clics que **encontraron** su anuncio en el mapa, con `join` y no con un
  // `exists` correlacionado: dentro de la lista de `select`, drizzle escribe las
  // columnas sin calificar la tabla, así que un `pa.ad_id = ad_id` dentro de la
  // subconsulta se resuelve contra la propia `product_ads` —o sea, `pa.ad_id =
  // pa.ad_id`— y **cuenta todos los clics como reconocidos**. Es el error que
  // esta señal existe para no cometer: se ve sana estando rota. Lo destapó el
  // ensayo contra una base cargada, no el typecheck.
  //
  // `count(distinct)` porque un anuncio de familia tiene varias filas en el
  // mapeo y sin eso la misma conversación contaría una vez por producto.
  const [matched] = await db
    .select({
      n: sql<number>`count(distinct ${conversations.id})::int`,
    })
    .from(conversations)
    .innerJoin(
      productAds,
      and(
        eq(productAds.operationId, conversations.operationId),
        eq(productAds.adId, conversations.adId),
      ),
    )
    .where(
      and(
        eq(conversations.operationId, op.id),
        gte(conversations.adReferralAt, since),
      ),
    );

  const [ads] = await db
    .select({
      registeredAds: sql<number>`count(distinct ${productAds.adId})::int`,
    })
    .from(productAds)
    .where(eq(productAds.operationId, op.id));

  return {
    windowDays,
    clicksInWindow: totals?.clicksInWindow ?? 0,
    registeredClicksInWindow: matched?.n ?? 0,
    clicksAllTime: totals?.clicksAllTime ?? 0,
    lastClickAt: totals?.lastClickAt ? new Date(totals.lastClickAt) : null,
    conversations: totals?.conversations ?? 0,
    registeredAds: ads?.registeredAds ?? 0,
  };
}

/**
 * Cómo se lee la señal. Puro y aparte de la consulta para que los tres estados
 * —nunca llegó nada, llegan pero no están registrados, funciona— se puedan
 * probar sin base.
 *
 * `nunca_llego_una_referencia` es el estado de producción hoy, y **no es un
 * bug**: la pauta apunta a otra WABA y los dos números se unifican después. Que
 * la pantalla lo diga es lo que impide que se lea como «todavía no vendimos»
 * cuando en realidad significa «este módulo no se ha ejercido nunca».
 */
export type AdReferralHealth =
  /** Nunca llegó ni una referencia de anuncio. El mapa no se ha consultado jamás. */
  | "nunca_llego_una_referencia"
  /** Llegaron clics en la ventana, pero ninguno de un anuncio registrado. */
  | "llegan_clics_sin_registrar"
  /** Llegan clics y encuentran su anuncio. El módulo está vivo. */
  | "el_mapa_se_esta_consultando"
  /** Hubo clics alguna vez, pero no en la ventana. */
  | "sin_clics_en_la_ventana";

export function readAdReferralSignal(
  signal: Pick<
    AdReferralSignal,
    "clicksInWindow" | "registeredClicksInWindow" | "clicksAllTime"
  >,
): AdReferralHealth {
  if (signal.clicksAllTime === 0) return "nunca_llego_una_referencia";
  if (signal.clicksInWindow === 0) return "sin_clics_en_la_ventana";
  return signal.registeredClicksInWindow > 0
    ? "el_mapa_se_esta_consultando"
    : "llegan_clics_sin_registrar";
}
