import { describe, expect, it } from "vitest";
import {
  CAPI_QUEUE_SPECS,
  CAPI_SEND_DEAD_QUEUE,
  CAPI_SEND_QUEUE,
  CAPI_SWEEP_QUEUE,
} from "./capi-conversion";
import { queuesDeclaredBeforeTheirDeadLetter } from "./sales-order";

/**
 * El orden en que se crean las colas del reporte a Meta.
 *
 * Se reusa el comprobador de `sales-order.ts` a propósito: es **la misma
 * trampa**, y ya se pagó una vez. La base guarda la cola de descarte como clave
 * foránea, así que crear la de envío apuntando a una cola que todavía no existe
 * falla y se lleva las tres por delante — y el arranque atrapa el error y
 * sigue, así que el worker queda corriendo sin cola de conversiones.
 *
 * Acá eso sería peor que en el cierre: ninguna conversión se reportaría nunca
 * **y el estado del reporte diría que todo está bien**, porque sin cola no hay
 * fallas que contar. Es el modo de fallar silencioso que este ticket entero
 * existe para evitar.
 */
describe("el orden en que se crean las colas del reporte a Meta", () => {
  it("la cola de descarte se crea antes que la que la referencia", () => {
    expect(queuesDeclaredBeforeTheirDeadLetter(CAPI_QUEUE_SPECS)).toEqual([]);
  });

  it("invertirlas se detecta, que es lo que hace que este test sirva de algo", () => {
    const alReves = [...CAPI_QUEUE_SPECS].reverse();
    expect(queuesDeclaredBeforeTheirDeadLetter(alReves)).toEqual([
      CAPI_SEND_QUEUE,
    ]);
  });
});

describe("cómo quedan declaradas las colas del reporte", () => {
  it("son las tres: barrido, envío y descarte", () => {
    expect(CAPI_QUEUE_SPECS.map((q) => q.name)).toEqual([
      CAPI_SEND_DEAD_QUEUE,
      CAPI_SEND_QUEUE,
      CAPI_SWEEP_QUEUE,
    ]);
  });

  it("el envío reintenta con esperas crecientes y descarta en la de muertas", () => {
    const cola = CAPI_QUEUE_SPECS.find((q) => q.name === CAPI_SEND_QUEUE);
    expect(cola?.deadLetter).toBe(CAPI_SEND_DEAD_QUEUE);
    expect(cola?.retryBackoff).toBe(true);
    expect(cola?.retryLimit).toBeGreaterThan(0);
  });

  it("el barrido no descarta en ninguna: el siguiente vuelve a mirar lo mismo", () => {
    const cola = CAPI_QUEUE_SPECS.find((q) => q.name === CAPI_SWEEP_QUEUE);
    expect(cola?.deadLetter).toBeUndefined();
  });

  it("una conversión que no se reportó se guarda un mes, no dos semanas", () => {
    // Es una señal perdida: borrarla a los catorce días por defecto sería
    // perder también el rastro de que se perdió.
    const muertas = CAPI_QUEUE_SPECS.find((q) => q.name === CAPI_SEND_DEAD_QUEUE);
    expect(muertas?.retentionDays).toBe(30);
  });
});
