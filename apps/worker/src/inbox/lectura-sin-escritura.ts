/**
 * **La red que atrapa una escritura colgada del camino de lectura del Inbox.**
 *
 * Cargar la bandeja escribía. `conversationIdsOfInbox` derivaba la bandeja de
 * cada conversación y, de paso, soltaba las asignaciones que habían dejado de
 * corresponder con un `UPDATE` sobre `conversations`. Era correcto y era
 * cómodo: los hechos que deciden si cambió de bandeja son los mismos que la
 * función acababa de cargar.
 *
 * Lo que lo volvía insostenible no era la escritura, era **quién la
 * disparaba**: el panel llama `router.refresh()` con cada evento SSE, o sea una
 * vez por mensaje de WhatsApp que entra, por cada pestaña abierta. Un `UPDATE`
 * sobre la tabla más caliente del sistema, disparado por el tráfico de esa
 * misma tabla. Medido: 200 conversaciones asignadas antes de que naciera su
 * pedido, y **un solo render escribió 199 filas**. Eso es lo que impide cachear
 * la pantalla, servirla desde una réplica, o razonar sobre ella como una
 * lectura.
 *
 * La liberación vive ahora en `apps/worker/src/inbox/asignacion.ts`. Esta red
 * es lo que impide que vuelva: no confía en que nadie se acuerde: **lee el
 * archivo**.
 *
 * **Por qué una red de texto y no un test de comportamiento.** Lo que hay que
 * garantizar es una ausencia —que no haya *ninguna* escritura en el camino—, y
 * una ausencia no se prueba ejecutando: un test que corriera la carga y contara
 * filas escritas solo cubriría el escenario que ese test arma, y la escritura
 * de antes solo aparecía cuando había una asignación vieja que soltar. La
 * ausencia se lee.
 *
 * **Todo lo de este archivo es PURO.** Recibe el código como texto y devuelve
 * hallazgos. Quien lee el archivo de verdad es su prueba, en una línea.
 * Comparte la partición en funciones con la otra red del panel
 * (`operations/consultas-del-panel.ts`) a propósito: dos parsers sobre el mismo
 * archivo es la forma de que uno empiece a leer otra cosa que el otro.
 *
 * **Lo que esta red NO es.** No sabe si una escritura está justificada. Sabe
 * que las funciones que corren al dibujar el Inbox no pueden tener ninguna, y
 * que el resto de `queries.ts` sí —`setAssignment`, `markRead`, `setAgentMode`
 * y `setConfirmationStatus` escriben porque alguien apretó un botón, que es
 * exactamente la diferencia—.
 */

import { funciones, sinComentarios } from "../operations/consultas-del-panel";

/** Una escritura encontrada dentro del camino de lectura. */
export interface EscrituraEnLaLectura {
  /** La función del panel donde vive. */
  funcion: string;
  /** El verbo con el que escribe. */
  verbo: "insert" | "update" | "delete";
  /** La tabla que ataca. */
  tabla: string;
}

/**
 * **Las funciones que corren al dibujar el Inbox**, y por lo tanto una vez por
 * mensaje de WhatsApp que entra.
 *
 * Son las que la pantalla y la barra lateral llaman, más las que ellas llaman.
 * La lista es a mano y tiene que serlo: no hay forma de deducir del texto qué
 * llama a qué sin un grafo de llamadas, y una lista corta que alguien mantiene
 * es más honesta que un grafo que se equivoca en silencio. La prueba que la
 * usa verifica además que **todos estos nombres existen en el archivo**, así
 * que una función renombrada no se cae de la red sin ponerla roja.
 */
export const CAMINO_DE_LECTURA: readonly string[] = [
  "listConversations",
  "idsDeLaBandejaDeVentas",
  "candidatasDeVentas",
  "candidatasDeVentasConModoAgente",
  "traerCandidatas",
  "traerCandidatasConModoAgente",
  "sinPedidosEnSQL",
  "porElClicDeAnuncio",
  "porElCorteDelVendedor",
  "loadOrderFactsByContact",
  "loadSalientesDelInbox",
  "loadSinResponderIds",
  "loadEscalationsByWaId",
  "countSalesInboxViews",
  "getAssetsBaseUrl",
  "listApprovedWaTemplates",
];

/** Dónde escribe una consulta: el verbo y la tabla que maneja. */
const ESCRITURA = /\.(insert|update|delete)\(\s*([A-Za-z0-9_$]+)/g;

/**
 * Las escrituras que hay dentro del camino de lectura del Inbox. **Vacío es lo
 * único que la prueba acepta.**
 */
export function escriturasEnLaLectura(
  source: string,
  camino: readonly string[] = CAMINO_DE_LECTURA,
): EscrituraEnLaLectura[] {
  const enElCamino = new Set(camino);
  const hallazgos: EscrituraEnLaLectura[] = [];
  for (const fn of funciones(sinComentarios(source))) {
    if (!enElCamino.has(fn.nombre)) continue;
    ESCRITURA.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ESCRITURA.exec(fn.texto))) {
      hallazgos.push({
        funcion: fn.nombre,
        verbo: m[1] as EscrituraEnLaLectura["verbo"],
        tabla: m[2]!,
      });
    }
  }
  return hallazgos;
}

/**
 * Los nombres del camino que **no** aparecen en el archivo.
 *
 * Es la mitad que impide que esta red se quede vigilando fantasmas: si alguien
 * renombra `idsDeLaBandejaDeVentas`, la red dejaría de mirarla y seguiría en
 * verde. Un vigilante que no encuentra a quien vigila tiene que decirlo.
 */
export function nombresQueYaNoExisten(
  source: string,
  camino: readonly string[] = CAMINO_DE_LECTURA,
): string[] {
  const presentes = new Set(
    funciones(sinComentarios(source)).map((f) => f.nombre),
  );
  return camino.filter((n) => !presentes.has(n));
}
