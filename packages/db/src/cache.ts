import type { OperationId } from "./operations";

/** El TTL que ya usaban los accesores singleton antes de la migración. */
export const OPERATION_CACHE_MS = 30_000;

/**
 * Caché por operación, con la misma forma para las conexiones del worker y para
 * las lecturas del panel que no cambian entre renders.
 *
 * La caché vieja era una variable de módulo con **una sola entrada**: al pasar a
 * resolver por operación devolvería la conexión de otro país sin fallar ni
 * compilar mal — el error silencioso más probable de toda la migración. Esta va
 * indexada por operación.
 *
 * El contract (ticket 06) le quitó la clave de «la operación única»
 * (`__operacion_unica__`), que existía porque los accesores aceptaban `null` y
 * leían la fila singleton. Sin ese caso, la clave es el uuid de la operación y
 * ya no hay dos claves que puedan apuntar a la misma fila y quedar
 * desincronizadas al invalidar.
 *
 * `get` devuelve un envoltorio `{ value }` y no el valor: un `null` cacheado es
 * un valor legítimo ("esta operación no tiene conexión") y no puede confundirse
 * con un fallo de caché, o cada lectura volvería a la base.
 *
 * **Vive en `@wa/db` y no en el worker desde PRO-15**, y no es una mudanza
 * cosmética: el panel necesita la misma caché y no puede importar del worker.
 * Copiarla habría dejado dos implementaciones de la misma idea, que es
 * exactamente el error que el contract vino a cerrar.
 *
 * **El reloj entra por parámetro.** No es para poder mentirle: es para poder
 * probarla. Un test de vencimiento contra `Date.now()` se escribe con un
 * `setTimeout` de 5 ms y un TTL de 1 ms, y eso es un test que falla los martes.
 * Con el tiempo como argumento, el vencimiento es una función pura de dos
 * números. El valor por defecto es el reloj real, así que ningún llamador de
 * producción tiene que pasarlo.
 */
export class OperationScopedCache<T> {
  private readonly entries = new Map<OperationId, { value: T; at: number }>();

  constructor(private readonly ttlMs: number = OPERATION_CACHE_MS) {}

  get(operationId: OperationId, ahora: number = Date.now()): { value: T } | null {
    const hit = this.entries.get(operationId);
    if (!hit || ahora - hit.at >= this.ttlMs) return null;
    return { value: hit.value };
  }

  set(operationId: OperationId, value: T, ahora: number = Date.now()): void {
    this.entries.set(operationId, { value, at: ahora });
  }

  /** Sin argumento borra todo; con una operación borra solo su entrada. */
  invalidate(operationId?: OperationId): void {
    if (operationId === undefined) {
      this.entries.clear();
      return;
    }
    this.entries.delete(operationId);
  }

  /**
   * El valor de esta operación, leyéndolo solo si no está fresco.
   *
   * Es `get` + `set` en un acto, y existe para que quien cachea una consulta no
   * tenga que escribir el par: la mitad de las cachés que mienten lo hacen
   * porque alguien escribió el `get` y se olvidó del `set`, o al revés.
   *
   * **No deduplica lecturas en vuelo a propósito, y eso se ve en el contador.**
   * El marco y la pantalla del panel suspenden en paralelo, así que en un render
   * frío los dos preguntan por el vendedor antes de que ninguno haya contestado
   * y las dos consultas viajan; del segundo render en adelante no viaja
   * ninguna. Compartir la promesa ahorraría esa consulta una vez por arranque y
   * a cambio dejaría una promesa rechazada cacheada — un error pegado a la
   * operación hasta que venza, que es mucho peor negocio.
   */
  async recordar(
    operationId: OperationId,
    cargar: () => Promise<T>,
    ahora: number = Date.now(),
  ): Promise<T> {
    const hit = this.get(operationId, ahora);
    if (hit) return hit.value;
    const value = await cargar();
    this.set(operationId, value, ahora);
    return value;
  }
}
