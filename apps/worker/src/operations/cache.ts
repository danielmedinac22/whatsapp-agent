import type { OperationId } from "@wa/db";

/** El TTL que ya usaban los accesores singleton antes de la migración. */
export const OPERATION_CACHE_MS = 30_000;

/**
 * Caché por operación, con la misma forma para las tres conexiones.
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
 */
export class OperationScopedCache<T> {
  private readonly entries = new Map<OperationId, { value: T; at: number }>();

  constructor(private readonly ttlMs: number = OPERATION_CACHE_MS) {}

  get(operationId: OperationId): { value: T } | null {
    const hit = this.entries.get(operationId);
    if (!hit || Date.now() - hit.at >= this.ttlMs) return null;
    return { value: hit.value };
  }

  set(operationId: OperationId, value: T): void {
    this.entries.set(operationId, { value, at: Date.now() });
  }

  /** Sin argumento borra todo; con una operación borra solo su entrada. */
  invalidate(operationId?: OperationId): void {
    if (operationId === undefined) {
      this.entries.clear();
      return;
    }
    this.entries.delete(operationId);
  }
}
