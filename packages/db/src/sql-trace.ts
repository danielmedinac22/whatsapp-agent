/**
 * **El contador de viajes a la base, apagado salvo que se lo encienda.**
 *
 * Existe porque el 20-ago-2026 se midió que un render del Inbox hace diez
 * viajes y tarda dos segundos, de los cuales menos del 1% es Postgres pensando
 * — y esa medición se hizo con instrumentación temporal que después se
 * revirtió. La próxima vez que alguien quiera el número tendría que volver a
 * montarla. Esto es esa instrumentación, ya montada y con interruptor.
 *
 * **El interruptor es `WA_SQL_TRACE=1` y está apagado.** Con la traza apagada
 * este módulo no envuelve nada, no guarda nada y `getDb()` construye el mismo
 * cliente de siempre: encendida siempre sería una regresión de rendimiento en
 * producción, que es justo lo que este archivo existe para medir.
 *
 * ## Por qué hacen falta dos hilos y no uno
 *
 * `postgres-js` acepta una opción `debug(conexión, sql, parámetros)` que dispara
 * **al poner la consulta en el cable**. Ese es el hilo que cuenta: ve todo lo
 * que sale, incluidas las consultas que la aplicación nunca pidió — con
 * `prepare: false` cada conexión nueva paga una introspección a
 * `pg_catalog.pg_type` antes de su primera consulta (`connection.js`,
 * `fetchArrayTypes`), y eso es un viaje que se paga aunque no aparezca en
 * ningún `.select()` del repo.
 *
 * Lo que `debug` **no** da es cuánto tardó: dispara al enviar y nunca al
 * recibir. Los tiempos entre envíos no sirven de reemplazo, y esa confusión
 * costó un turno la vez anterior: con `max: 10` el driver abre una conexión
 * nueva por consulta concurrente, así que el hueco entre dos envíos puede ser
 * un TCP más un TLS y no una consulta lenta.
 *
 * De ahí el segundo hilo: se envuelve `unsafe()` —el único método por el que
 * drizzle habla con el driver ({@link https://github.com/drizzle-team/drizzle-orm}
 * `postgres-js/session.js`)— y se le cambia el `resolve` a la consulta, que es
 * una propiedad de instancia que la conexión llama al llegar la respuesta.
 * Cambiarla no dispara la ejecución ni consume la promesa, que es lo que sí
 * haría un `.then()` de más.
 *
 * Los dos hilos se casan por el texto del SQL: para una consulta sin plantilla,
 * el `string` que recibe `debug` es idéntico al que se le pasó a `unsafe`
 * (`types.js`, `stringify` con un solo tramo devuelve su entrada). Lo que sale
 * en `debug` y no tiene par en `unsafe` es del driver, y así se etiqueta.
 */

/** Un viaje: una consulta que el driver puso en el cable. */
export interface ViajeSql {
  /** Orden de envío dentro de la traza, empezando en 1. */
  n: number;
  /**
   * La conexión de `postgres-js` por la que salió. Un número que no se había
   * visto antes es una conexión recién abierta, y eso es un TCP más un TLS
   * pagados dentro del tiempo de esa consulta.
   */
  conexion: number;
  sql: string;
  parametros: number;
  /**
   * Los valores de esos parámetros, tal como salieron por el cable.
   *
   * Se guardan para poder pedirle el plan a la consulta **que corrió**, con sus
   * valores, en vez de a una copia escrita a mano con valores inventados — que
   * es como se termina reportando el plan de otra consulta. Solo existen con la
   * traza encendida, así que en producción esto no guarda nada de nadie.
   */
  valores: readonly unknown[];
  /** Milisegundos desde que arrancó la traza hasta que esta consulta se envió. */
  enviadoA: number;
  /** De la llamada a la respuesta. `null` en las consultas del driver. */
  ms: number | null;
  /** Filas leídas, o filas tocadas si escribe. `null` en las del driver. */
  filas: number | null;
  /** `SELECT`, `UPDATE`, … tal como lo nombra Postgres. `null` en las del driver. */
  comando: string | null;
  /** Quién la pidió. El driver pide las suyas por su cuenta. */
  origen: "aplicación" | "driver";
}

/** Lo que una traza terminada tiene para contar. */
export interface TrazaSql {
  /** Qué se estaba haciendo mientras se trazaba. */
  etiqueta: string;
  viajes: ViajeSql[];
  /** Milisegundos de pared de todo el bloque medido, no la suma de las consultas. */
  ms: number;
}

/** El hueco que deja `unsafe()` y que llena la respuesta cuando llega. */
interface Medida {
  desde: number;
  ms: number | null;
  filas: number | null;
  comando: string | null;
}

let viajes: ViajeSql[] | null = null;
let arranque = 0;
/** Medidas todavía sin par en `debug`, en cola por texto de SQL. */
const pendientes = new Map<string, Medida[]>();

/** Si la traza está encendida. Apagada, este módulo no toca nada. */
export function sqlTraceEnabled(): boolean {
  return process.env.WA_SQL_TRACE === "1";
}

function ahora(): number {
  return performance.now();
}

/**
 * El hilo que cuenta: dispara al enviar, ve también lo que pide el driver.
 * Casa cada envío con la medida que dejó `unsafe()`, si la hay.
 */
function anotarEnvio(
  conexion: number,
  sql: string,
  parametros: readonly unknown[],
): void {
  if (viajes === null) return;
  const cola = pendientes.get(sql);
  const medida = cola?.shift();
  if (cola && cola.length === 0) pendientes.delete(sql);
  const viaje: ViajeSql = {
    n: viajes.length + 1,
    conexion,
    sql,
    parametros: parametros.length,
    valores: parametros,
    enviadoA: ahora() - arranque,
    ms: null,
    filas: null,
    comando: null,
    origen: medida ? "aplicación" : "driver",
  };
  viajes.push(viaje);
  if (medida) {
    vistos.set(medida, viaje);
    // **La respuesta puede haber llegado antes que este `debug`.** Pasa cuando
    // dos consultas de texto idéntico salen a la vez por conexiones distintas:
    // el orden en que se envían no tiene por qué ser el orden en que se
    // llamaron, así que la que vuelve primero puede encontrarse todavía sin
    // viaje al que anotarse. Sin esta línea su tiempo se perdía en silencio, y
    // la fila salía sin número — un instrumento que descarta una medición sin
    // decirlo es peor que uno que no la toma.
    if (medida.ms !== null) volcar(medida, viaje);
  }
}

/**
 * Pasa lo medido al viaje.
 *
 * **Entre dos consultas de texto idéntico que corren a la vez, cuál tiempo cae
 * en cuál fila es arbitrario**, y no se puede hacer mejor: `debug` recibe el
 * texto, no la consulta. Lo que sí es exacto es el conjunto — las dos
 * duraciones están, y su suma y su cuenta son las de verdad.
 */
function volcar(medida: Medida, viaje: ViajeSql): void {
  viaje.ms = medida.ms;
  viaje.filas = medida.filas;
  viaje.comando = medida.comando;
}

/** De qué viaje es cada medida, para volcarle el tiempo cuando resuelva. */
const vistos = new WeakMap<Medida, ViajeSql>();

/**
 * Las opciones que `getDb()` le agrega al cliente. Con la traza apagada es un
 * objeto vacío, así que el cliente queda idéntico al de siempre.
 */
export function sqlTraceOptions(): Record<string, unknown> {
  if (!sqlTraceEnabled()) return {};
  return { debug: anotarEnvio };
}

/** Lo mínimo que este módulo necesita saber de una consulta de `postgres-js`. */
interface ConsultaPendiente {
  resolve: (x: unknown) => unknown;
  reject: (x: unknown) => unknown;
}

/**
 * El hilo que cronometra: envuelve `unsafe()`, que es por donde drizzle manda
 * todo, y le cambia el `resolve` a cada consulta para saber cuándo volvió.
 *
 * **Con la traza apagada devuelve el cliente sin tocar.** Es la mitad del
 * «no deja instrumentación encendida por defecto»: la otra mitad es que
 * `sqlTraceOptions()` no ponga el `debug`.
 */
export function instrumentarTrazaSql<T>(cliente: T): T {
  if (!sqlTraceEnabled()) return cliente;
  const c = cliente as unknown as {
    unsafe: (sql: string, args?: unknown[], opts?: unknown) => unknown;
  };
  const original = c.unsafe.bind(c);
  c.unsafe = (sql: string, args?: unknown[], opts?: unknown) => {
    const consulta = original(sql, args, opts) as ConsultaPendiente;
    if (viajes === null) return consulta;

    const medida: Medida = { desde: ahora(), ms: null, filas: null, comando: null };
    const cola = pendientes.get(sql);
    if (cola) cola.push(medida);
    else pendientes.set(sql, [medida]);

    const cerrar = (x: unknown): void => {
      medida.ms = ahora() - medida.desde;
      // `Result` es un `Array` con `count` y `command` encima: en un `SELECT`
      // `count` son las filas leídas y en un `UPDATE` las filas tocadas.
      const r = x as { length?: number; count?: number; command?: string };
      medida.filas = r?.count ?? (Array.isArray(x) ? x.length : null) ?? null;
      medida.comando = r?.command ?? null;
      const viaje = vistos.get(medida);
      // Sin viaje todavía, la medida queda esperando: la recoge `anotarEnvio`
      // cuando el `debug` de esta consulta llegue.
      if (viaje) volcar(medida, viaje);
    };

    const resolve = consulta.resolve;
    const reject = consulta.reject;
    consulta.resolve = (x: unknown) => (cerrar(x), resolve(x));
    consulta.reject = (x: unknown) => (cerrar(null), reject(x));
    return consulta;
  };
  return cliente;
}

/**
 * Cuenta y cronometra los viajes que hace `fn`.
 *
 * El `ms` que devuelve es tiempo de pared del bloque entero, no la suma de las
 * consultas: son concurrentes y sumarlas contaría de más. La suma de `ms` de
 * los viajes sirve para otra pregunta —cuánto se pasó esperando la red— y esa
 * la responde quien lee, no esta función.
 */
export async function medirViajes<T>(
  etiqueta: string,
  fn: () => Promise<T>,
): Promise<{ valor: T; traza: TrazaSql }> {
  if (!sqlTraceEnabled()) {
    throw new Error(
      "la traza está apagada: hace falta WA_SQL_TRACE=1 en el entorno, y antes de la primera consulta (el cliente se arma una sola vez)",
    );
  }
  if (viajes !== null) {
    throw new Error("ya hay una traza corriendo: medirViajes no se anida");
  }
  viajes = [];
  pendientes.clear();
  arranque = ahora();
  try {
    const valor = await fn();
    const ms = ahora() - arranque;
    return { valor, traza: { etiqueta, viajes, ms } };
  } finally {
    viajes = null;
    pendientes.clear();
  }
}
