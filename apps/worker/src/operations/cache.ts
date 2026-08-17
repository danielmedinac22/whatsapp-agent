import { type OperationRef, operationCacheKey } from "./resolve";

/** El TTL que ya usaban los accesores singleton antes de la migración. */
export const OPERATION_CACHE_MS = 30_000;

/**
 * Caché por operación, con la misma forma para las tres conexiones.
 *
 * La caché vieja era una variable de módulo con **una sola entrada**: al pasar a
 * resolver por operación devolvería la conexión de otro país sin fallar ni
 * compilar mal — el error silencioso más probable de toda la migración. Esta va
 * indexada por operación, y `operationCacheKey` le da a la operación única su
 * propia entrada.
 *
 * `get` devuelve un envoltorio `{ value }` y no el valor: un `null` cacheado es
 * un valor legítimo ("esta operación no tiene conexión") y no puede confundirse
 * con un fallo de caché, o cada lectura volvería a la base.
 */
export class OperationScopedCache<T> {
  private readonly entries = new Map<string, { value: T; at: number }>();

  constructor(private readonly ttlMs: number = OPERATION_CACHE_MS) {}

  get(operationId: OperationRef): { value: T } | null {
    const hit = this.entries.get(operationCacheKey(operationId));
    if (!hit || Date.now() - hit.at >= this.ttlMs) return null;
    return { value: hit.value };
  }

  set(operationId: OperationRef, value: T): void {
    this.entries.set(operationCacheKey(operationId), { value, at: Date.now() });
  }

  /**
   * Sin argumento borra todo. Con una operación borra su entrada **y la de la
   * operación única**: mientras solo haya una operación, las dos claves apuntan
   * a la misma fila, y limpiar una sin la otra deja media caché rancia.
   */
  invalidate(operationId?: OperationRef): void {
    if (operationId === undefined) {
      this.entries.clear();
      return;
    }
    this.entries.delete(operationCacheKey(operationId));
    this.entries.delete(operationCacheKey(null));
  }
}
