/**
 * El **nivel 2 de la cascada**: de qué producto habla un anuncio que nadie
 * registró, comparando su titular y su cuerpo contra los nombres del catálogo.
 *
 * Todo lo de este archivo es **puro y sin red**: recibe el copy del anuncio y
 * el catálogo ya con nombres, y devuelve candidatos con confianza. No llama a
 * ningún modelo, no consulta la base y no puede tardar — lo que importa porque
 * corre en el camino de entrada de todo mensaje, que es el que factura.
 *
 * ## Por qué léxico y no un modelo
 *
 * Se consideró pedirle el match al modelo que ya está configurado
 * (`openai/gpt-5.4-mini` en producción) y se descartó, por este orden:
 *
 * 1. **No se puede verificar su calibración con datos.** Hoy en producción hay
 *    **0 productos, 0 anuncios registrados y 0 conversaciones con `ad_id`**: no
 *    existe un solo caso real contra el cual medir si el modelo acierta. Lo
 *    único medible hoy son los **nombres** del catálogo, y sobre ellos este
 *    matcher se prueba entero, offline, en cada corrida de la suite.
 * 2. **A un modelo se le pregunta «cuál» y contesta «cuál».** Sobre la familia
 *    REVITALHAIR —cuatro SKUs casi homónimos que concentran la mayoría del
 *    volumen— elegir uno es mandarle al cliente el SKU equivocado, y es
 *    exactamente el error que toda esta cascada existe para no cometer. Acá esa
 *    elección es **imposible de expresar** (ver «la regla que no se puede
 *    escribir», abajo), no algo que dependa de cómo salga redactado un prompt.
 * 3. **Latencia en el camino que factura.** El reconocimiento se espera antes
 *    de que el vendedor conteste; una llamada al proveedor le suma segundos al
 *    primer turno del lead. Este matcher tarda microsegundos.
 * 4. **Costo.** Es lo de menos —una llamada extra rondaría los USD 0,001 por
 *    lead con anuncio no registrado, contra los USD 0,017–0,023 por lead que ya
 *    cuesta la conversación (`panel-de-ventas/05-costos-variables`)— pero se
 *    midió antes de decidir, y no compra nada que 1–3 no descarten ya.
 *
 * Se descartó también **usar la descripción del producto** como evidencia: la
 * escribe el admin para el vendedor, su largo varía muchísimo de un producto a
 * otro, y una cobertura sobre texto largo castigaría justo a los productos
 * mejor documentados. El nombre es lo único que el anuncio y el catálogo tienen
 * en común por construcción.
 *
 * ## La regla que este archivo vuelve imposible de escribir
 *
 * `recognition.ts` no deja elegir un ganador **entre** candidatos. Este archivo
 * cierra la otra mitad: no deja **producir** un ganador donde el catálogo no lo
 * permite. Dos mecanismos:
 *
 * - **Todos los candidatos salen con la misma confianza.** No hay un número por
 *   candidato que alguien pueda ordenar y cortar: {@link SEMANTIC_MATCH_CONFIDENCE}
 *   es uno solo. Que un nombre cubra el anuncio un poco mejor que otro no lo
 *   vuelve el elegido, porque ese «un poco mejor» es ruido: el copy de un
 *   anuncio es prosa publicitaria y el nombre del catálogo es una cadena de
 *   SKU, y la diferencia entre 0,62 y 0,46 no significa nada.
 * - **La duda se contagia por el catálogo, no por el anuncio.** Si dos nombres
 *   son indistinguibles entre sí, ningún texto puede separarlos: cuando uno
 *   entra como candidato, entran todos los suyos. Ver {@link NAME_CONFUSION_SIMILARITY}.
 *
 * ## Qué significa acá la confianza
 *
 * `SemanticCandidate.confidence` se lee **por producto y no como reparto**: «el
 * anuncio es compatible con este producto», no «probabilidad de que sea este y
 * no otro». Es la única lectura con la que la cascada funciona, y está fijada
 * por su propia regla: *más de un producto sobre el umbral significa que el
 * texto no los distingue*. Bajo un reparto, cuatro candidatos indistinguibles
 * valdrían 0,25 cada uno, ninguno pasaría el umbral y el resultado sería
 * `unknown` **sin candidatos** — perdiendo justo la lista corta con la que se
 * le pregunta al lead. Ver la nota en `SemanticCandidate`.
 */

import { nameSimilarity, normalizeName } from "../lib/match";
import type { AdCopy, CatalogProduct, SemanticCandidate } from "./recognition";

/**
 * La confianza con la que sale **todo** candidato de este nivel. Un solo valor,
 * a propósito: es lo que hace imposible que alguien ordene los candidatos por
 * confianza y se quede con el primero.
 *
 * Tiene que estar por encima de `SEMANTIC_CONFIDENCE_THRESHOLD`, y hay un test
 * que lo fija. La consecuencia de que sea plano hay que decirla: **el umbral de
 * la cascada deja de ser el punto de ajuste de este nivel y pasa a serlo
 * {@link MIN_NAME_COVERAGE}**. Los dos son constantes del código —ninguno es un
 * campo del panel—, así que la regla del ticket se sigue cumpliendo; lo que
 * cambia es dónde se toca si algún día hay datos que digan que hay que tocarlo.
 *
 * No es arbitrario que sea plano: para que cuatro nombres casi idénticos salgan
 * los cuatro por encima del umbral, hay que levantarlos a todos; y una vez
 * levantados, levantarlos **desigual** sería reintroducir por la puerta de
 * atrás el margen que la cascada se niega a mirar.
 */
export const SEMANTIC_MATCH_CONFIDENCE = 0.9;

/**
 * Cuánto del nombre de un producto tiene que nombrar el anuncio para que ese
 * producto sea candidato. **Constante del sistema, no campo del panel**, igual
 * que el umbral de la cascada, los cinco de la lista corta y los dos intentos
 * del escalamiento: cada perilla es superficie de falla y soporte no cotizado.
 *
 * Es cobertura del **nombre**, no del anuncio: el anuncio trae decenas de
 * palabras de venta que ningún catálogo contiene, así que medir sobre él daría
 * siempre casi cero. La dirección segura del error es preguntar de más, y la de
 * este número es hacia abajo — un valor bajo mete candidatos de más, y
 * candidatos de más es *ambiguo*, que es una pregunta al lead; un valor alto
 * deja el producto afuera y es *desconocido*, que es la pregunta abierta. Las
 * dos preguntan; ninguna manda un SKU equivocado.
 *
 * 0,35 sale de **medir** contra los nombres reales de Guatemala, no de elegir
 * un número redondo. Con un anuncio capilar genérico la familia cubre 0,617 ·
 * 0,463 · 0,308 · 0,407, y un anuncio de otra categoría cubre 0. El caso que
 * marca el borde de abajo es un anuncio de «combo … total», que comparte dos
 * palabras sueltas con el nombre más largo y cubre **0,286** de él sin hablar
 * de ese producto. El corte vive en ese hueco —entre 0,286 y 0,407— y no hay
 * ningún dato medido en el medio.
 */
export const MIN_NAME_COVERAGE = 0.35;

/**
 * Cuántas palabras del nombre tiene que nombrar el anuncio, además de cubrir
 * {@link MIN_NAME_COVERAGE}. Una sola palabra compartida es coincidencia —«kit»,
 * «combo», «natural»—, y con un nombre de dos palabras alcanzaría para cubrir
 * la mitad. Un nombre de una sola palabra queda exento, o no podría ser
 * candidato nunca.
 */
const MIN_MATCHED_WORDS = 2;

/**
 * Cuándo dos nombres del catálogo son **indistinguibles entre sí**, y por lo
 * tanto ningún texto de anuncio puede separarlos.
 *
 * Medido sobre los nombres reales de Guatemala con `nameSimilarity`:
 *
 * | par | similitud |
 * | -- | -- |
 * | `DHT ANTICALVICIE` × `DHT BLOCKER ANTICALVICIE` | 0,778 |
 * | `DHT ANTICALVICIE` × `COMBO DHT + SERUM 360` | 0,636 |
 * | `DHT BLOCKER` × `COMBO DHT + SERUM 360` | 0,636 |
 * | `COMBO DHT + SERUM 360` × `Hair Recovery 3X` | 0,286 |
 * | cualquiera × `DEOS` o `RELOJ` | < 0,25 |
 *
 * El corte en 0,55 agrupa a los tres que **son** el mismo producto de nombre
 * distinto y deja fuera al resto por más del doble de margen. No es un número
 * elegido para que dé: es el hueco que hay en los datos.
 *
 * La segunda mitad de la regla no tiene umbral y es la más fuerte: **si todas
 * las palabras de un nombre están dentro de otro** —`REVITALHAIR DHT
 * ANTICALVICIE` está entero dentro de `REVITALHAIR DHT BLOCKER ANTICALVICIE`—,
 * toda evidencia que sostiene al segundo sostiene al primero. Eso no es una
 * heurística, es una demostración.
 */
export const NAME_CONFUSION_SIMILARITY = 0.55;

/**
 * Palabras que no identifican nada. Se sacan del anuncio y del nombre antes de
 * comparar: sin esto, un anuncio con «para tu cabello» le regalaría cobertura a
 * cualquier producto cuyo nombre lleve «para».
 */
const PALABRAS_VACIAS = new Set([
  "con", "sin", "por", "para", "del", "las", "los", "una", "uno", "unos",
  "unas", "que", "the", "and", "your", "you", "tus", "sus", "mas", "muy",
  "este", "esta", "estos", "estas", "ese", "esa", "eso", "aqui", "aca",
  "hoy", "ya", "todo", "toda", "todos", "todas", "solo", "solo", "pero",
  "como", "cuando", "donde", "porque", "desde", "hasta", "entre", "sobre",
  "ahora", "aun", "tan", "aqui", "aqui",
]);

/** Las palabras que sirven para identificar algo, ya normalizadas. */
function palabras(text: string | null | undefined): string[] {
  const clean = normalizeName(text);
  if (!clean) return [];
  return clean
    .split(" ")
    .filter((w) => !PALABRAS_VACIAS.has(w))
    // Menos de tres letras no identifica nada, salvo que traiga dígito: «3x»,
    // «360», «8225» son justamente lo que distingue un SKU de otro.
    .filter((w) => w.length >= 3 || /\d/.test(w));
}

/**
 * Qué tan presente está una palabra del nombre en el anuncio, en [0, 1].
 *
 * Exacta vale 1. Una contenida en la otra vale 0,85 —«anticalvicie» dentro de
 * un anuncio que dice «calvicie», «capilar» dentro de «capilares»— exigiendo
 * cuatro letras para que «dht» no se cuele dentro de cualquier cosa. Lo demás
 * se compara por distancia de edición y solo cuenta si queda muy cerca: cubre
 * el plural y el error de tecleo, no el parecido vago.
 */
function presencia(palabra: string, anuncio: readonly string[]): number {
  let best = 0;
  for (const a of anuncio) {
    if (a === palabra) return 1;
    const corta = a.length < palabra.length ? a : palabra;
    const larga = a.length < palabra.length ? palabra : a;
    if (corta.length >= 4 && larga.includes(corta)) {
      best = Math.max(best, 0.85);
      continue;
    }
    const sim = nameSimilarity(palabra, a);
    if (sim >= 0.8) best = Math.max(best, sim);
  }
  return best;
}

/** Lo que el anuncio dice de un producto: cuánto de su nombre nombra. */
interface Evidencia {
  /** Fracción del nombre que el anuncio cubre, en [0, 1]. */
  readonly cobertura: number;
  /** Cuántas palabras del nombre nombra el anuncio, aunque sea parcialmente. */
  readonly nombradas: number;
  /** Cuántas palabras identificables tiene el nombre. */
  readonly palabras: number;
}

function evidenciaDe(
  nombre: string,
  anuncio: readonly string[],
): Evidencia {
  const propias = palabras(nombre);
  if (propias.length === 0) {
    return { cobertura: 0, nombradas: 0, palabras: 0 };
  }
  let suma = 0;
  let nombradas = 0;
  for (const p of propias) {
    const valor = presencia(p, anuncio);
    suma += valor;
    if (valor > 0) nombradas += 1;
  }
  return {
    cobertura: suma / propias.length,
    nombradas,
    palabras: propias.length,
  };
}

/** Si el anuncio nombra al producto lo bastante como para proponerlo. */
function esSemilla(e: Evidencia): boolean {
  if (e.palabras === 0) return false;
  const minimo = Math.min(MIN_MATCHED_WORDS, e.palabras);
  return e.nombradas >= minimo && e.cobertura >= MIN_NAME_COVERAGE;
}

/**
 * Si dos nombres del catálogo son indistinguibles entre sí. Ver
 * {@link NAME_CONFUSION_SIMILARITY}.
 *
 * La contención pide **dos palabras o más** en el nombre contenido: un producto
 * llamado solo «Serum» está dentro de medio catálogo sin que eso lo vuelva el
 * mismo producto, y agruparlo con todos convertiría cualquier anuncio en
 * ambiguo. Con dos palabras la contención ya dice algo.
 */
function nombresConfundibles(a: string, b: string): boolean {
  const pa = palabras(a);
  const pb = palabras(b);
  if (pa.length === 0 || pb.length === 0) return false;
  const [corta, larga] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  if (corta.length >= 2) {
    const set = new Set(larga);
    if (corta.every((w) => set.has(w))) return true;
  }
  return nameSimilarity(a, b) >= NAME_CONFUSION_SIMILARITY;
}

/**
 * Los candidatos del nivel 2, todos con la misma confianza.
 *
 * Tres pasos y ninguno compara candidatos entre sí:
 *
 * 1. **Semillas** — los productos que el anuncio nombra de verdad
 *    ({@link esSemilla}).
 * 2. **Contagio** — todo producto indistinguible de una semilla entra también,
 *    y transitivamente: si el anuncio nombra al `DHT ANTICALVICIE`, entran sus
 *    tres hermanos, aunque el anuncio no diga «blocker» ni «serum». Es la
 *    regla del ticket dicha en código: *ante candidatos de nombre muy parecido
 *    entre sí, el resultado es ambiguo, nunca una elección*.
 * 3. **Salida** — todos con {@link SEMANTIC_MATCH_CONFIDENCE}, en el orden del
 *    catálogo. Devolverlos ordenados por cobertura sería ordenar la lista corta
 *    que ve el lead por un margen que acabamos de declarar ruido, y el primero
 *    de una lista es el que más se elige.
 *
 * Catálogo vacío, o sin un solo nombre legible —los conectados a la tienda
 * tienen `name` nulo si la tienda no respondió—, devuelve cero candidatos: la
 * cascada lo lee como desconocido y el vendedor pregunta abierto. Nunca lanza.
 */
export function matchAdCopyToCatalog(
  ad: AdCopy,
  catalog: readonly CatalogProduct[],
): SemanticCandidate[] {
  if (catalog.length === 0) return [];
  const anuncio = [...palabras(ad.headline), ...palabras(ad.body)];
  if (anuncio.length === 0) return [];

  const elegidos = new Set<string>();
  const frontera: CatalogProduct[] = [];
  for (const product of catalog) {
    if (!esSemilla(evidenciaDe(product.name, anuncio))) continue;
    elegidos.add(product.id);
    frontera.push(product);
  }
  if (elegidos.size === 0) return [];

  // Contagio, en anchura: un hermano recién entrado puede arrastrar a los
  // suyos. El catálogo de una operación son unas pocas decenas de filas, así
  // que el peor caso cuadrático no es un problema real.
  while (frontera.length > 0) {
    const actual = frontera.pop()!;
    for (const otro of catalog) {
      if (elegidos.has(otro.id)) continue;
      if (!nombresConfundibles(actual.name, otro.name)) continue;
      elegidos.add(otro.id);
      frontera.push(otro);
    }
  }

  return catalog
    .filter((p) => elegidos.has(p.id))
    .map((p) => ({ productId: p.id, confidence: SEMANTIC_MATCH_CONFIDENCE }));
}
