/**
 * La red que atrapa una consulta del panel que no acota por operación.
 *
 * **Por qué hace falta una red aparte.** El contract (ticket 06) cerró la fuga
 * por accesores: volvió obligatorio el parámetro de operación en
 * `getKapsoConnection()` y compañía, y el tipado estricto encontró los call
 * sites. Su punto ciego es estructural y no un descuido: una consulta que lee
 * filas directo con Drizzle **no pasa por ningún accesor**, así que nunca hubo
 * un parámetro que volver obligatorio y el compilador no tiene nada que
 * señalar. `listConversations` no pregunta por «la conexión»: hace
 * `select().from(conversations)` y ordena por actividad.
 *
 * Esa clase de fuga solo se puede ver mirando el código, así que esto lo mira.
 *
 * **La unidad de análisis es la consulta, no la función.** La primera versión de
 * esta red miraba función por función y tenía un falso negativo que se descubrió
 * probándola: `listConversations` hace **cuatro** consultas, así que le bastaba
 * acotar una para pasar — se le podía quitar el filtro a la lista del Inbox
 * entera y la red no decía nada. Ahora cada sentencia que arranca en
 * `.from(tabla)`, `.update(tabla)`, `.insert(tabla)` o `.delete(tabla)` tiene
 * que acotar por su cuenta.
 *
 * **Todo lo de este archivo es PURO.** Recibe el código como texto y devuelve
 * hallazgos; no abre archivos ni toca la base. Quien lee los archivos de verdad
 * es su prueba, en una línea por archivo.
 *
 * **Por qué vive en el worker si vigila la web.** Los tests del proyecto corren
 * solo aquí (`pnpm --filter @wa/worker test`). Una prueba en `apps/web` no la
 * correría nadie, y una red que no corre es peor que ninguna: promete una
 * garantía que nadie verifica.
 *
 * **Lo que esta red NO es.** No entiende TypeScript ni SQL: no sabe si el
 * `where` que encontró filtra bien. Atrapa la consulta que **no acota en
 * absoluto**, que es la fuga que de verdad pasó. Contra un `where` mal escrito
 * la única defensa es leerlo.
 */

import * as schema from "@wa/db/schema";

/** Una consulta que lee o escribe filas con dueño sin acotarlas. */
export interface ConsultaSinAlcance {
  /** La función de nivel superior donde vive. */
  funcion: string;
  /** La tabla que la consulta ataca. */
  tabla: string;
  /** Por qué se la señala. */
  motivo: "sin_operacion_a_mano" | "sin_filtro_de_operacion";
}

/** Una consulta encontrada en el código, acote o no. */
export interface ConsultaAnalizada extends ConsultaSinAlcance {
  /** La función tiene una operación con la que acotar. */
  tieneOperacion: boolean;
  /** La consulta la nombra. */
  acota: boolean;
}

/**
 * Las tablas cuyas filas **son de una operación**, sacadas del esquema y no de
 * una lista escrita a mano.
 *
 * Es lo que hace que la red no envejezca: una tabla nueva con `operation_id`
 * entra sola el día que alguien la agrega, sin que nadie se acuerde de venir
 * aquí. Una lista a mano se queda vieja exactamente en el caso que importa —
 * la tabla que alguien acaba de agregar.
 */
export const TABLAS_CON_DUENO: readonly string[] = Object.entries(schema)
  .filter(([, valor]) => {
    if (typeof valor !== "object" || valor === null) return false;
    return "operationId" in valor;
  })
  .map(([nombre]) => nombre)
  .sort();

/**
 * Las tablas que no llevan la columna y cuyas filas son de una operación
 * igualmente, a través de la conversación.
 *
 * `messages` y `message_media` cuelgan de la conversación y filtrar la
 * conversación alcanza. `contacts` no la lleva **a propósito**: una persona
 * puede existir en las dos operaciones y eso no es un error. Pero las tres se
 * leen y se escriben por id desde el panel, así que la pertenencia hay que
 * verificarla igual — y por eso están en la lista.
 *
 * **`outbound_messages` entró con PRO-16**, y su ausencia era un agujero de los
 * que esta red existe para no tener: sus filas son de una operación —a través
 * del `to_wa_id`, que es para lo que existe `waIdOfOperation`— y las tres
 * consultas que el panel le hace pasaban sin que nadie las mirara. Se descubrió
 * al fusionar dos de ellas en una: la consulta nueva no aparecía en el
 * inventario, y una consulta que la red no ve pasa en verde sin mirar nada.
 * Su `conversation_id` **no serviría** para acotarla —está en `null` en 316 de
 * los 352 salientes manuales de producción—, que es justo por lo que el alcance
 * de esta tabla va por el `wa_id`.
 */
export const TABLAS_CON_DUENO_INDIRECTO: readonly string[] = [
  "contacts",
  "messages",
  "messageMedia",
  "outboundMessages",
];

/**
 * Lo que cuenta como «acota por operación».
 *
 * Los **cinco** ayudantes de `apps/web/src/lib/operation-scope.ts` y, además,
 * `operationId` a secas: escribir `eq(conversations.operationId, op.id)` a mano
 * acota igual de bien, y una red que exige *una forma* en vez de *un efecto*
 * termina rechazando código correcto.
 *
 * Decía «los cuatro» y enumeraba cuatro, y el que faltaba era `waIdOfOperation`
 * — el único que acota la tabla que tampoco estaba en la lista de tablas. Los
 * dos olvidos se tapaban entre sí: sin la tabla nadie miraba esas consultas, y
 * sin el marcador mirarlas habría dado falsos positivos. Es la forma en que una
 * red se queda corta sin ponerse roja.
 */
export const MARCADORES_DE_ALCANCE: readonly string[] = [
  "ofOperation",
  "rowOfOperation",
  "throughConversationOfOperation",
  "contactOfOperation",
  "waIdOfOperation",
  "operationId",
];

/**
 * Cómo una función puede tener la operación a mano: por parámetro —el mecanismo
 * del contract— o resolviéndola ella misma, que es lo que hacen las acciones de
 * servidor de las pantallas, donde no hay quién se la pase.
 */
const MARCADORES_DE_OPERACION: readonly string[] = [
  ":\\s*Operation\\b",
  "\\bresolvePanelOperation\\b",
];

/** Dónde empieza una consulta: la tabla que la maneja, no las que se le unen. */
const ATAQUE_A_TABLA = /\.(?:from|update|insert|delete)\(\s*([A-Za-z0-9_$]+)/g;

/** Declaración de función de nivel superior, exportada o no. */
const DECLARACION =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm;

/**
 * El código sin comentarios: un `operationId` prometido en una nota no acota
 * nada.
 *
 * El `//` tiene que venir después de un espacio o de un salto de línea, para no
 * confundirse con el de una URL (`https://`) ni con el de una expresión regular
 * (`/^\//`), que si se recortaran se llevarían por delante código real.
 */
function sinComentarios(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1 ");
}

/** Si un identificador aparece como palabra entera y no dentro de otra. */
function mencionA(texto: string, identificador: string): boolean {
  return new RegExp(`\\b${identificador}\\b`).test(texto);
}

/** Desde el primer `(`, hasta su paréntesis de cierre. Los `= {}` no lo engañan. */
function firmaDeParametros(chunk: string): string {
  const inicio = chunk.indexOf("(");
  if (inicio < 0) return "";
  let profundidad = 0;
  for (let i = inicio; i < chunk.length; i++) {
    const c = chunk[i];
    if (c === "(") profundidad++;
    else if (c === ")") {
      profundidad--;
      if (profundidad === 0) return chunk.slice(inicio, i + 1);
    }
  }
  return chunk.slice(inicio);
}

/** El texto de cada función de nivel superior, con su nombre. */
function funciones(limpio: string): Array<{ nombre: string; texto: string }> {
  const inicios: Array<{ nombre: string; desde: number }> = [];
  DECLARACION.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DECLARACION.exec(limpio))) {
    inicios.push({ nombre: m[1]!, desde: m.index });
  }
  return inicios.map((inicio, i) => ({
    nombre: inicio.nombre,
    texto: limpio.slice(inicio.desde, inicios[i + 1]?.desde ?? limpio.length),
  }));
}

/**
 * Todas las consultas sobre tablas con dueño que hay en el código.
 *
 * Corta por declaración de función y, dentro de cada una, por sentencia: una
 * cadena de Drizzle no lleva `;` adentro, así que el punto y coma separa una
 * consulta de la siguiente. No es un parser, y no hace falta que lo sea: lo que
 * tiene que distinguir es «esta consulta nombra la operación» de «no la nombra».
 */
export function analizarConsultasDelPanel(source: string): ConsultaAnalizada[] {
  const limpio = sinComentarios(source);
  const conDueno = new Set([...TABLAS_CON_DUENO, ...TABLAS_CON_DUENO_INDIRECTO]);
  const consultas: ConsultaAnalizada[] = [];

  for (const fn of funciones(limpio)) {
    const firma = firmaDeParametros(fn.texto);
    const cuerpo = fn.texto.slice(firma.length);
    const tieneOperacion = MARCADORES_DE_OPERACION.some((m) =>
      new RegExp(m).test(firma + cuerpo),
    );

    for (const sentencia of cuerpo.split(";")) {
      ATAQUE_A_TABLA.lastIndex = 0;
      const atacadas = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = ATAQUE_A_TABLA.exec(sentencia))) {
        if (conDueno.has(m[1]!)) atacadas.add(m[1]!);
      }
      if (atacadas.size === 0) continue;

      const acota = MARCADORES_DE_ALCANCE.some((mk) => mencionA(sentencia, mk));
      for (const tabla of [...atacadas].sort()) {
        consultas.push({
          funcion: fn.nombre,
          tabla,
          acota,
          tieneOperacion,
          motivo: tieneOperacion
            ? "sin_filtro_de_operacion"
            : "sin_operacion_a_mano",
        });
      }
    }
  }

  return consultas;
}

/**
 * Las consultas que no acotan. **Vacío es lo único que la prueba acepta.**
 *
 * Se distinguen los dos motivos porque no son el mismo error: no tener la
 * operación a mano es una función que no puede acotar aunque quiera; tenerla y
 * no usarla es la fuga silenciosa, la que compila y devuelve filas de más.
 */
export function consultasSinAlcance(source: string): ConsultaSinAlcance[] {
  return analizarConsultasDelPanel(source)
    .filter((c) => !c.acota || !c.tieneOperacion)
    .map(({ funcion, tabla, motivo }) => ({ funcion, tabla, motivo }));
}
