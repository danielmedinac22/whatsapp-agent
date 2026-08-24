import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  etiquetaDeTipo,
  excedeLimiteDeWhatsapp,
  parseProductPrice,
  productPriceRejectionText,
  productPriceToColumn,
  puedeEnviarse,
  rechazoDeSubida,
} from "@wa/shared";
import { getDb } from "./client";
import type { Operation } from "./schema";
import {
  conversations,
  productAds,
  productMedia,
  products,
  type Product,
  type ProductMedia,
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
 * Un producto conectado **no copia** su información: nombre, descripción y
 * **precio** se leen de la tienda en tiempo de uso, y por eso `products.name`
 * es nullable en vez de `NOT NULL` y `products.price` solo lo pueden tener los
 * nativos (`check` de la `0028`). Escribirlos acá sería exactamente la
 * desincronización silenciosa que esa decisión evita — el panel mostrando, y
 * cobrando, un precio que la tienda ya cambió, sin que nada avise.
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
  /**
   * El precio, tal como lo escribió el admin (`150.000`, `Q 400`, `399,90`) o
   * ya como número. **`null` es un valor legítimo y es el estado inicial**: un
   * producto sin precio se puede crear, describir y mandarle fotos al cliente;
   * lo único que no se puede es cerrarlo en una venta, y eso escala a un asesor
   * en vez de inventar un importe.
   */
  price?: string | number | null;
}

/**
 * El precio que va a la columna, o el error que le explica al admin por qué no.
 *
 * La regla la decide `@wa/shared` —el mismo módulo con el que el navegador
 * valida antes de guardar— y acá solo se traduce a lo que la base espera.
 * Devolver `null` para vacío es lo que permite **quitarle** el precio a un
 * producto: mandar la cadena vacía lo deja sin precio y vuelve a escalar, que
 * es una corrección legítima y no un error.
 */
function priceColumn(price: string | number | null | undefined): string | null {
  if (price === null || price === undefined) return null;
  if (typeof price === "string" && !price.trim()) return null;
  const parsed = parseProductPrice(price);
  if (!parsed.ok) throw new Error(productPriceRejectionText(parsed));
  return productPriceToColumn(parsed.value);
}

/**
 * Un producto que todavía no existe en la tienda. Nombre, descripción y precio
 * viven acá porque no hay de dónde leerlos.
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
      price: priceColumn(input.price),
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
      // `undefined` no toca el precio; la cadena vacía se lo quita. Son dos
      // cosas distintas y la pantalla usa las dos: guardar el nombre sin tocar
      // el precio, y borrar el precio de un producto que dejó de venderse.
      ...(input.price !== undefined ? { price: priceColumn(input.price) } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(products.operationId, op.id), eq(products.id, productId)))
    .returning();
  if (!row) throw new Error("el producto no existe en esta operación");
  return row;
}

/**
 * Escribe (o borra) la ficha de venta de un producto. **De cualquier fuente.**
 *
 * Es el único accesor que toca un producto conectado, y no contradice a
 * {@link updateNativeProduct}: lo que aquella protege es que el panel no
 * guarde **una copia** de lo que vive en la tienda, porque una copia se
 * desincroniza sin avisar. `sales_brief` no copia nada — en Shopify este campo
 * no existe. Es lo que el equipo quiere que el vendedor sepa, que es
 * precisamente lo que la landing no dice.
 *
 * La cadena vacía **borra** la ficha, igual que con el precio: quitarla es una
 * corrección legítima y devuelve el producto a leer la descripción de la
 * tienda, que es el estado de partida y no una avería.
 */
export async function setSalesBrief(
  op: Operation,
  productId: string,
  brief: string | null,
): Promise<Product> {
  const current = await getProduct(op, productId);
  if (!current) throw new Error("el producto no existe en esta operación");

  const [row] = await getDb()
    .update(products)
    .set({ salesBrief: brief?.trim() || null, updatedAt: new Date() })
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

// ────────────────────────────────────────────────────────────────────────────
// Los archivos enviables de un producto
// ────────────────────────────────────────────────────────────────────────────

/**
 * Viven en este archivo y no en uno propio porque son **el mismo accesor**: un
 * archivo no existe sin su producto, la regla de aislamiento es la misma y el
 * que la rompa la rompe para los dos. Partirlos habría dado dos lugares donde
 * escribir «filtrá por operación» y uno donde olvidarlo.
 *
 * **Los bytes no salen de acá sin que se los pidan.** Todo lo que lee para la
 * pantalla devuelve `ProductMediaMeta` —la fila sin la columna binaria—, porque
 * dibujar la lista de archivos de 17 productos no puede significar traerse los
 * archivos. Los bytes se leen de a uno y solo en el camino que los va a mandar.
 */

/** Lo mínimo que la resolución necesita de un archivo para decidir. */
export interface ScopedProductMediaRow {
  operationId: string;
  productId: string;
}

/** Una fila de `product_media` **sin los bytes**: lo que la pantalla necesita. */
export type ProductMediaMeta = Omit<ProductMedia, "bytes">;

/** Las columnas de la metadata, sin `bytes`. Una sola definición para las tres consultas. */
const MEDIA_META_COLUMNS = {
  id: productMedia.id,
  operationId: productMedia.operationId,
  productId: productMedia.productId,
  filename: productMedia.filename,
  mime: productMedia.mime,
  byteSize: productMedia.byteSize,
  sendable: productMedia.sendable,
  metaMediaId: productMedia.metaMediaId,
  createdAt: productMedia.createdAt,
  updatedAt: productMedia.updatedAt,
} as const;

/**
 * Los archivos de un producto **dentro de la operación**, puro.
 *
 * La clave foránea compuesta ya impide en la base que un archivo cuelgue de un
 * producto de otra operación. Esto no es la barrera: es la regla escrita donde
 * se puede probar con fixtures, y la que sostiene la misma garantía cuando las
 * filas no vienen de una consulta —que es como corren los tests.
 */
export function resolveProductMedia<T extends ScopedProductMediaRow>(
  rows: readonly T[],
  op: Operation,
  productId: string,
): T[] {
  return rows.filter(
    (r) => r.operationId === op.id && r.productId === productId,
  );
}

/**
 * De los archivos de un producto, **los que de verdad le pueden llegar al
 * cliente**.
 *
 * Es la función que hace verdadero el criterio del ticket 03: «los archivos no
 * marcados nunca se envían, aunque estén cargados». Filtra por las tres cosas
 * a la vez —operación, producto y {@link puedeEnviarse}— porque las tres tienen
 * la misma consecuencia si fallan: un archivo saliendo hacia un cliente al que
 * nadie decidió mandárselo.
 *
 * El tamaño se vuelve a mirar acá aunque el rechazo ya se haya hecho al subir.
 * No es desconfianza del panel: el límite es de WhatsApp y puede bajar, y
 * entonces filas guardadas como enviables dejan de serlo sin que nadie las
 * toque. Esta es la última pregunta antes de mandar.
 */
export function sendableProductMedia<
  T extends ScopedProductMediaRow & { mime: string; byteSize: number; sendable: boolean },
>(rows: readonly T[], op: Operation, productId: string): T[] {
  return resolveProductMedia(rows, op, productId).filter(puedeEnviarse);
}

/**
 * Los archivos de la operación agrupados por producto, para dibujar la tabla y
 * las fichas de una sola lectura.
 *
 * Solo entran los archivos de la operación **y de un producto que el catálogo
 * tiene**, igual que {@link buildCatalog} con los mapeos: un archivo huérfano
 * no puede aparecer colgado del producto equivocado.
 */
export function groupMediaByProduct<T extends ScopedProductMediaRow>(
  rows: readonly T[],
  op: Operation,
  productIds: readonly string[],
): Map<string, T[]> {
  const known = new Set(productIds);
  const out = new Map<string, T[]>();
  for (const id of productIds) out.set(id, []);
  for (const row of rows) {
    if (row.operationId !== op.id || !known.has(row.productId)) continue;
    out.get(row.productId)?.push(row);
  }
  return out;
}

/** La metadata de los archivos de un producto, en orden de subida. */
export async function listProductMedia(
  op: Operation,
  productId: string,
): Promise<ProductMediaMeta[]> {
  if (!isUuid(productId)) return [];
  const rows = await getDb()
    .select(MEDIA_META_COLUMNS)
    .from(productMedia)
    .where(
      and(
        eq(productMedia.operationId, op.id),
        eq(productMedia.productId, productId),
      ),
    )
    .orderBy(asc(productMedia.createdAt));
  return resolveProductMedia(rows, op, productId);
}

/** La metadata de **todos** los archivos de la operación, para la tabla del catálogo. */
export async function listCatalogMedia(
  op: Operation,
): Promise<ProductMediaMeta[]> {
  return getDb()
    .select(MEDIA_META_COLUMNS)
    .from(productMedia)
    .where(eq(productMedia.operationId, op.id))
    .orderBy(asc(productMedia.createdAt));
}

/**
 * Los archivos que el vendedor puede mandar por este producto.
 *
 * Es el camino de lectura del envío. **Sin caché, a propósito**: es lo que hace
 * verdadero el criterio «un archivo desmarcado deja de enviarse desde la
 * siguiente conversación, sin reinicio ni despliegue». Una caché acá
 * convertiría desmarcar un archivo en «desmarcado, pero sigue saliendo un
 * rato», que es la clase de demora que nadie asocia con lo que acaba de tocar.
 *
 * **Devuelve metadata, no bytes, y eso cambió con el ticket 03.** Nació
 * trayendo la columna binaria porque se pensó como «lo que el envío lee», pero
 * el envío no lee así: decide en el turno de la conversación —qué archivos
 * corresponden y cuáles ya salieron— y **manda uno por trabajo de la cola**,
 * que es donde se leen sus bytes ({@link getProductMediaForSend}). Traerlos
 * acá significaba cargar en memoria hasta cuatro videos de 16 MB en cada turno
 * de Sebastián para terminar usando uno. La regla del archivo —«los bytes no
 * salen de acá sin que se los pidan»— es la misma; lo que se corrigió es dónde
 * se piden.
 *
 * El `where` ya filtra por operación, producto y marca; el filtro en memoria
 * agrega el tamaño y es el que los tests ejercen.
 */
export async function listSendableProductMedia(
  op: Operation,
  productId: string,
): Promise<ProductMediaMeta[]> {
  if (!isUuid(productId)) return [];
  const rows = await getDb()
    .select(MEDIA_META_COLUMNS)
    .from(productMedia)
    .where(
      and(
        eq(productMedia.operationId, op.id),
        eq(productMedia.productId, productId),
        eq(productMedia.sendable, true),
      ),
    )
    .orderBy(asc(productMedia.createdAt));
  return sendableProductMedia(rows, op, productId);
}

/**
 * Un archivo con sus bytes, para el trabajo de la cola que lo va a mandar.
 *
 * **La operación es del llamador y no del id**, y ahí está el criterio: el que
 * pide el archivo es un trabajo de `outbound_messages`, cuya operación sale de
 * su conversación. Buscar por `id` a secas y confiar en que la fila traiga la
 * operación correcta es exactamente el error que la clave foránea compuesta
 * evita en la base; esto lo evita en el código, que es donde el id viaja
 * suelto. Un archivo de otra operación devuelve `null` — no «el archivo», sino
 * *nada*, que es lo único que un envío puede hacer con él.
 *
 * **No filtra por `sendable`.** Devolver `null` para un archivo desmarcado
 * diría lo mismo que para uno inexistente, y no es lo mismo: uno es un id que
 * no existe y el otro es un archivo que el admin apagó mientras estaba en la
 * cola. El que envía necesita distinguirlos para escribir en el hilo por qué no
 * salió, y la marca la vuelve a mirar con {@link puedeEnviarse}.
 */
export async function getProductMediaForSend(
  op: Operation,
  mediaId: string,
): Promise<ProductMedia | null> {
  if (!isUuid(mediaId)) return null;
  const [row] = await getDb()
    .select()
    .from(productMedia)
    .where(
      and(eq(productMedia.operationId, op.id), eq(productMedia.id, mediaId)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Guarda —o borra— el id que Meta le dio a este archivo.
 *
 * Subir una vez y reusar el id es lo que evita remandar los bytes en cada
 * conversación; **borrarlo es la otra mitad**, y por eso esta función acepta
 * `null`: el id caduca (Meta lo conserva ~30 días) y está atado al número que
 * lo subió, así que un envío que falla con un id guardado se cura tirándolo y
 * volviendo a subir. Sin el `null` la caché sería una trampa permanente para el
 * archivo que la tuvo.
 */
export async function setProductMediaMetaId(
  op: Operation,
  mediaId: string,
  metaMediaId: string | null,
): Promise<void> {
  if (!isUuid(mediaId)) return;
  await getDb()
    .update(productMedia)
    .set({ metaMediaId, updatedAt: new Date() })
    .where(
      and(eq(productMedia.operationId, op.id), eq(productMedia.id, mediaId)),
    );
}

/** Lo que el panel manda al subir un archivo. */
export interface ProductMediaInput {
  filename: string;
  mime: string;
  bytes: Buffer;
}

/**
 * Guarda un archivo de un producto de esta operación.
 *
 * **Rechaza por tamaño acá también**, aunque el navegador ya lo haya hecho: lo
 * que llega a una ruta llega de afuera, y el criterio del ticket —«se rechaza
 * al subir, no al enviar»— no puede depender de que el que sube sea la
 * pantalla. El motivo vuelve redactado, que es lo que el admin necesita leer.
 *
 * **Nace apagado.** El interruptor no se puede pasar en la subida: marcar un
 * archivo como enviable es un acto aparte y explícito, porque el error que
 * evita —mandarle al cliente la hoja de márgenes internos— no se deshace.
 */
export async function addProductMedia(
  op: Operation,
  productId: string,
  input: ProductMediaInput,
): Promise<ProductMediaMeta> {
  const product = await getProduct(op, productId);
  if (!product) throw new Error("el producto no existe en esta operación");

  const filename = input.filename.trim() || "archivo";
  const mime = input.mime.trim().toLowerCase() || "application/octet-stream";
  const rechazo = rechazoDeSubida({
    filename,
    mime,
    byteSize: input.bytes.byteLength,
  });
  if (rechazo) throw new Error(rechazo.texto);

  const [row] = await getDb()
    .insert(productMedia)
    .values({
      operationId: op.id,
      productId,
      filename,
      mime,
      bytes: input.bytes,
      byteSize: input.bytes.byteLength,
    })
    .returning(MEDIA_META_COLUMNS);
  if (!row) throw new Error("no se pudo guardar el archivo");
  return row;
}

/**
 * Marca o desmarca un archivo como enviable.
 *
 * Marcar uno que excede el límite de WhatsApp **falla y dice por qué**: la
 * pantalla ya deshabilita ese interruptor, y esto es lo que sostiene la regla
 * cuando la petición no viene de la pantalla. Desmarcar siempre se puede — el
 * camino de apagar algo no se bloquea nunca.
 *
 * Devuelve `null` si el archivo no es de esta operación, que es lo mismo que
 * decir que no existe: un id de archivo viaja en el cuerpo de una petición.
 */
export async function setProductMediaSendable(
  op: Operation,
  mediaId: string,
  sendable: boolean,
): Promise<ProductMediaMeta | null> {
  if (!isUuid(mediaId)) return null;
  const [current] = await getDb()
    .select(MEDIA_META_COLUMNS)
    .from(productMedia)
    .where(
      and(eq(productMedia.operationId, op.id), eq(productMedia.id, mediaId)),
    )
    .limit(1);
  if (!current) return null;

  if (sendable && excedeLimiteDeWhatsapp(current.mime, current.byteSize)) {
    throw new Error(
      `${current.filename} excede el límite de WhatsApp para ${etiquetaDeTipo(current.mime)}: no se puede marcar como enviable.`,
    );
  }

  const [row] = await getDb()
    .update(productMedia)
    .set({ sendable, updatedAt: new Date() })
    .where(
      and(eq(productMedia.operationId, op.id), eq(productMedia.id, mediaId)),
    )
    .returning(MEDIA_META_COLUMNS);
  return row ?? null;
}

/** Borra un archivo del producto. Los bytes se van con la fila. */
export async function deleteProductMedia(
  op: Operation,
  mediaId: string,
): Promise<boolean> {
  if (!isUuid(mediaId)) return false;
  const rows = await getDb()
    .delete(productMedia)
    .where(
      and(eq(productMedia.operationId, op.id), eq(productMedia.id, mediaId)),
    )
    .returning({ id: productMedia.id });
  return rows.length > 0;
}
