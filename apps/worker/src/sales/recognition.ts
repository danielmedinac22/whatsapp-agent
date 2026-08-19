/**
 * De qué producto le están escribiendo a Sebastián.
 *
 * Todo lo de este archivo es PURO: no toca la base, ni el reloj, ni ningún
 * modelo. La cascada recibe la referencia del anuncio ya parseada, el catálogo
 * de la operación, el mapeo anuncio→productos que cargó el admin y **el matcher
 * semántico como dependencia inyectada** — y devuelve una de tres formas:
 * resuelto a un producto, ambiguo con una lista de candidatos, o desconocido.
 *
 * La cascada es **fija**, de tres niveles, y no tiene perillas
 * (`.scratch/panel-de-ventas/issues/02-reconocimiento-de-producto.md`):
 *
 * 1. Por ID del anuncio, contra el mapeo. Un anuncio apunta a uno o varios
 *    productos (la relación es N:M). Uno → resuelto; varios → ambiguo **con la
 *    lista de ese anuncio**, no con el catálogo entero.
 * 2. Por match semántico del titular y cuerpo contra el catálogo, **solo si el
 *    anuncio no está registrado**. Sale resuelto únicamente cuando exactamente
 *    un producto supera el umbral de confianza. Lo implementa
 *    `sales/semantic-match.ts` —léxico, puro y sin red— y lo enchufa
 *    `sales/catalog.ts`.
 * 3. Preguntar. No vive aquí: este módulo devuelve «ambiguo, con esta lista» o
 *    «desconocido», y quien pregunta, cuántas veces y qué pasa después es el
 *    ticket 05 del mapa.
 *
 * **El error que este archivo vuelve imposible de escribir es _elegir_ cuando
 * debía decir _ambiguo_.** La familia REVITALHAIR son cuatro SKUs de nombre
 * casi idéntico —tres léxicamente, el cuarto solo por lo que vende—, el más
 * vendido de ellos es por sí solo el 77% del volumen de Vorare, y un match
 * semántico sobre el copy del anuncio no los distingue con confianza. Por eso:
 *
 * - El matcher **no devuelve un ganador**: devuelve candidatos con confianza.
 *   Su tipo no tiene forma de decir «este».
 * - La cascada **nunca compara candidatos entre sí**. No hay `max`, no hay
 *   «el mejor por un margen». Filtra por un único umbral y decide por
 *   cardinalidad: un producto → resuelto, varios → ambiguo, ninguno →
 *   desconocido. «Resuelto» solo puede nacer de un conjunto de tamaño uno.
 * - El resultado no tiene un caso «resuelto con confianza baja» (que es la
 *   forma de `dropi/match-shopify.ts`, donde elegir y marcar es lo correcto).
 *   Aquí un producto elegido a medias es información del SKU equivocado
 *   mandada a un cliente.
 *
 * Los tipos de entrada son **estructurales**, no los de `@wa/db`: las tablas
 * de catálogo y mapeo se están creando en la migración `0022` en otro
 * worktree, y esta función tiene que poder probarse sin base. Cuando el
 * esquema aterrice, se adapta en el borde (una fila del catálogo ya es un
 * `CatalogProduct`; el join anuncio↔producto se agrupa —o no: varias filas del
 * mismo anuncio se juntan aquí solas—).
 *
 * **Lo que todavía no cuelga de aquí:** persistir la atribución en el primer
 * contacto y que un mensaje posterior —una respuesta de botón, que no trae
 * referencia— siga teniendo su producto. Ambas cosas leen y escriben tablas de
 * la `0022`; el resultado de esta función es lo que se guarda.
 */

/**
 * Umbral de confianza del nivel semántico. **Constante del sistema**, no un
 * campo del panel: cada perilla es superficie de falla y soporte no cotizado.
 *
 * Un candidato cuenta como match si su confianza es ≥ este valor. La regla es
 * de cardinalidad, no de ranking: si **más de un** producto supera el umbral
 * para el mismo anuncio, es que el texto del anuncio no los distingue, y el
 * resultado es ambiguo con todos ellos — aunque uno tenga la confianza más
 * alta. Eso es lo que el spec llama «similitud alta entre sí» y por eso no
 * hace falta un segundo umbral de margen.
 *
 * El valor es alto a propósito. La dirección segura del error es preguntar
 * de más: un umbral bajo resolvería a un solo producto con confianza mediana,
 * que es exactamente lo que no se puede hacer sobre el 77% del volumen. Un
 * matcher que hable de «casi seguro» tiene que devolver 0,8 o más; «podría
 * ser» queda por debajo y cede al nivel 3.
 */
export const SEMANTIC_CONFIDENCE_THRESHOLD = 0.8;

/**
 * Lo mínimo que la cascada necesita de un producto del catálogo. Es una forma
 * estructural para que los tests escriban fixtures de dos campos y para no
 * importar tipos de `@wa/db` mientras el esquema está en construcción.
 */
export interface CatalogProduct {
  id: string;
  name: string;
}

/**
 * Lo que la cascada necesita de la referencia CTWA que el parser de entrantes
 * expondrá (ticket 02 del mapa). La cascada **recibe** la referencia ya
 * parseada; nunca mira el payload.
 *
 * `adId` es `referral.source_id`: el ID del anuncio en Meta, la clave del
 * nivel 1. `headline` y `body` son el copy del anuncio, la entrada del nivel 2.
 * Cualquiera puede venir vacío: se comprobó que el serializador del proveedor
 * recorta campos que Meta sí manda.
 */
export interface AdReferralRef {
  adId: string | null;
  headline: string | null;
  body: string | null;
}

/**
 * Un anuncio que el admin registró y los productos a los que apunta. La
 * relación es N:M: un anuncio de familia o de combo apunta a varios productos,
 * y un producto puede tener varios anuncios. **No hay concepto de familia**:
 * la agrupación la expresa este mapeo.
 *
 * Varias entradas con el mismo `adId` se juntan en una sola lista, así que
 * una fila por par (anuncio, producto) también sirve.
 */
export interface AdProductMapping {
  adId: string;
  productIds: readonly string[];
}

/** El texto del anuncio, que es todo lo que el nivel semántico puede mirar. */
export type AdCopy = Pick<AdReferralRef, "headline" | "body">;

/**
 * Un producto que el matcher considera posible para el anuncio, con qué tan
 * seguro está. `confidence` está en [0, 1] y se lee **por producto, no como
 * reparto**: «este anuncio es compatible con este producto», y no
 * «probabilidad de que sea este y no otro». Un matcher que use otra métrica
 * por dentro (coseno de embeddings, lo que sea) la traduce a este significado
 * antes de devolverla, porque el umbral se compara contra esto.
 *
 * **La distinción no es una sutileza y hay que leerla antes de cambiar un
 * matcher.** Bajo un reparto —que suma 1 entre todos— cuatro candidatos
 * indistinguibles valdrían 0,25 cada uno, ninguno pasaría el umbral, y el
 * resultado sería `unknown` **sin candidatos**: se perdería la lista corta con
 * la que se le pregunta al lead, justo en el caso que motivó toda la cascada.
 * Con la lectura por producto, los cuatro salen altos y el resultado es
 * `ambiguous` con los cuatro, que es lo que el ticket pide. La regla de la
 * cascada dice lo mismo desde el otro lado: *más de un producto sobre el
 * umbral significa que el texto no los distingue*.
 *
 * Los productos que el matcher no menciona cuentan como confianza 0.
 */
export interface SemanticCandidate {
  productId: string;
  confidence: number;
}

/**
 * El match semántico del copy contra el catálogo, **inyectado**. En producción
 * llamará a un modelo; en los tests es un stub. Devuelve candidatos con
 * confianza y **no puede devolver un ganador**: la decisión es de la cascada.
 *
 * Puede ser síncrono o asíncrono. Si lanza, la excepción sube tal cual: quien
 * orquesta decide si un matcher caído es «desconocido» o un reintento, y lo
 * loguea — la cascada no tiene logger.
 */
export type SemanticMatcher = (
  ad: AdCopy,
  catalog: readonly CatalogProduct[],
) => readonly SemanticCandidate[] | Promise<readonly SemanticCandidate[]>;

/** En qué nivel de la cascada se produjo el resultado. */
export type RecognitionLevel = "ad-id" | "semantic";

/**
 * Por qué no se reconoció nada. Es telemetría, no comportamiento: para el que
 * pregunta (ticket 05) todas valen lo mismo, pero en el log distinguen un
 * mensaje orgánico de un proveedor que recortó el copy del anuncio.
 */
export type UnknownReason =
  | "no-referral"
  | "empty-catalog"
  | "no-ad-copy"
  | "low-confidence";

/**
 * Las tres formas del resultado. No hay una cuarta «resuelto pero dudoso».
 *
 * `ambiguous.candidates` tiene **al menos dos** productos por tipo: un
 * candidato solo no es ambigüedad, es resolución, y la única puerta a
 * `resolved` es un conjunto de exactamente uno.
 */
export type ProductRecognition =
  | { kind: "resolved"; product: CatalogProduct; level: RecognitionLevel }
  | {
      kind: "ambiguous";
      /**
       * En el nivel 1, en el orden del catálogo. En el nivel 2, de mayor a
       * menor confianza — y como el matcher de producción devuelve **una sola
       * confianza para todos** sus candidatos, en la práctica también queda el
       * orden del catálogo. Es orden de **presentación** para la lista corta de
       * la pregunta — no es un ranking para elegir; si se pudiera elegir, la
       * cascada lo habría hecho, y ordenar por un margen que el matcher declara
       * ruido empujaría al lead hacia el primero de la lista.
       */
      candidates: readonly [CatalogProduct, CatalogProduct, ...CatalogProduct[]];
      level: RecognitionLevel;
    }
  | { kind: "unknown"; reason: UnknownReason };

/**
 * La cascada.
 *
 * - Sin referencia, o con catálogo vacío → desconocido, sin consultar nada.
 * - Nivel 1: los productos del mapeo del anuncio **que existen en este
 *   catálogo**. El catálogo es el de la operación, así que un anuncio mal
 *   etiquetado hacia productos de otro país no resuelve a ellos: los ids
 *   ajenos se descartan, y si no queda ninguno el anuncio cuenta como no
 *   registrado y cae al nivel 2.
 * - Nivel 2: solo si el nivel 1 no produjo nada. Se consulta al matcher con el
 *   copy y el catálogo; los candidatos que superan el umbral **y existen en el
 *   catálogo** (un modelo puede inventar ids) deciden por cardinalidad. Sin
 *   copy no hay nada que matchear: desconocido sin consultar.
 */
export async function recognizeProduct(input: {
  referral: AdReferralRef | null;
  catalog: readonly CatalogProduct[];
  adMappings: readonly AdProductMapping[];
  matchSemantically: SemanticMatcher;
}): Promise<ProductRecognition> {
  const { referral, catalog } = input;
  if (!referral) return { kind: "unknown", reason: "no-referral" };
  if (catalog.length === 0) return { kind: "unknown", reason: "empty-catalog" };

  // Nivel 1 · por ID del anuncio.
  const byAd = recognitionOf(
    productsMappedToAd(referral.adId, input.adMappings, catalog),
    "ad-id",
  );
  if (byAd) return byAd;

  // Nivel 2 · por texto del anuncio, solo porque el 1 no dijo nada.
  const copy: AdCopy = { headline: referral.headline, body: referral.body };
  if (!hasText(copy.headline) && !hasText(copy.body)) {
    return { kind: "unknown", reason: "no-ad-copy" };
  }
  const candidates = await input.matchSemantically(copy, catalog);
  return (
    recognitionOf(confidentProducts(candidates, catalog), "semantic") ?? {
      kind: "unknown",
      reason: "low-confidence",
    }
  );
}

/**
 * La única puerta a `resolved` y a `ambiguous`: decide por **cardinalidad** del
 * conjunto que recibe. Uno → resuelto; dos o más → ambiguo con todos; ninguno
 * → `null`, y el que llama decide qué significa vacío en su nivel (en el 1,
 * seguir al 2; en el 2, desconocido).
 *
 * No recibe confianzas ni orden de preferencia a propósito: aquí no se puede
 * escribir «gana el mejor» porque no hay con qué.
 */
function recognitionOf(
  products: readonly CatalogProduct[],
  level: RecognitionLevel,
): Extract<ProductRecognition, { kind: "resolved" | "ambiguous" }> | null {
  const [first, second, ...rest] = products;
  if (!first) return null;
  if (!second) return { kind: "resolved", product: first, level };
  return { kind: "ambiguous", candidates: [first, second, ...rest], level };
}

/**
 * Los productos del catálogo a los que apunta el anuncio, en el orden del
 * catálogo. Junta todas las entradas del mapeo con ese `adId` (así una fila por
 * par también sirve) y descarta ids que no estén en el catálogo: son de otra
 * operación o de un producto que ya no existe, y no se resuelve a ellos.
 */
function productsMappedToAd(
  adId: string | null,
  mappings: readonly AdProductMapping[],
  catalog: readonly CatalogProduct[],
): CatalogProduct[] {
  const wanted = adId?.trim();
  if (!wanted) return [];
  const mappedIds = new Set<string>();
  for (const m of mappings) {
    if (m.adId.trim() !== wanted) continue;
    for (const id of m.productIds) mappedIds.add(id);
  }
  if (mappedIds.size === 0) return [];
  return catalog.filter((p) => mappedIds.has(p.id));
}

/**
 * Los productos del catálogo que el matcher puso en o sobre el umbral, de mayor
 * a menor confianza (orden de presentación; el empate conserva el orden del
 * catálogo). Ids que no estén en el catálogo se ignoran; una confianza que no
 * sea un número finito cuenta como 0; si el matcher repite un id, vale la
 * mayor confianza que le dio.
 */
function confidentProducts(
  candidates: readonly SemanticCandidate[],
  catalog: readonly CatalogProduct[],
): CatalogProduct[] {
  const confidenceById = new Map<string, number>();
  for (const c of candidates) {
    const confidence = Number.isFinite(c.confidence) ? c.confidence : 0;
    const previous = confidenceById.get(c.productId) ?? 0;
    confidenceById.set(c.productId, Math.max(previous, confidence));
  }
  return catalog
    .map((product) => ({
      product,
      confidence: confidenceById.get(product.id) ?? 0,
    }))
    .filter((c) => c.confidence >= SEMANTIC_CONFIDENCE_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
    .map((c) => c.product);
}

function hasText(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}
