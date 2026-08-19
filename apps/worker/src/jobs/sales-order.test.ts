import { describe, expect, it } from "vitest";
import {
  queuesDeclaredBeforeTheirDeadLetter,
  SALES_ORDER_DEAD_QUEUE,
  SALES_ORDER_QUEUE,
  SALES_QUEUE_SPECS,
  type SalesQueueSpec,
} from "./sales-order";

/**
 * El orden en que se crean las colas del cierre.
 *
 * No es una cuestión de estilo: la base guarda la cola de descarte como clave
 * foránea, así que crear la de reintentos apuntando a una cola que todavía no
 * existe **falla**, y con ella se cae la creación de las dos. Pasó en el primer
 * despliegue de este módulo y el arranque lo atrapó sin decir nada: el worker
 * quedó corriendo sin cola de cierres, o sea sin lo único que impide que una
 * venta fallida se pierda en silencio.
 */
describe("el orden en que se crean las colas del cierre", () => {
  it("la cola de descarte se crea antes que la que la referencia", () => {
    expect(queuesDeclaredBeforeTheirDeadLetter(SALES_QUEUE_SPECS)).toEqual([]);
  });

  it("invertirlas se detecta, que es lo que hace que este test sirva de algo", () => {
    // Sin esta comprobación el test de arriba pasaría con cualquier lista y no
    // estaría fijando nada.
    const alReves = [...SALES_QUEUE_SPECS].reverse();
    expect(queuesDeclaredBeforeTheirDeadLetter(alReves)).toEqual([
      SALES_ORDER_QUEUE,
    ]);
  });

  it("una cola que se apunta a sí misma como descarte también se detecta", () => {
    const rara: SalesQueueSpec[] = [{ name: "x", deadLetter: "x" }];
    expect(queuesDeclaredBeforeTheirDeadLetter(rara)).toEqual(["x"]);
  });

  it("una lista sin colas de descarte no tiene nada que ordenar", () => {
    expect(
      queuesDeclaredBeforeTheirDeadLetter([{ name: "a" }, { name: "b" }]),
    ).toEqual([]);
  });
});

describe("cómo quedan declaradas las colas del cierre", () => {
  it("son las dos, y la de reintentos descarta en la de casos para una persona", () => {
    const nombres = SALES_QUEUE_SPECS.map((q) => q.name);
    expect(nombres).toEqual([SALES_ORDER_DEAD_QUEUE, SALES_ORDER_QUEUE]);
    const cola = SALES_QUEUE_SPECS.find((q) => q.name === SALES_ORDER_QUEUE);
    expect(cola?.deadLetter).toBe(SALES_ORDER_DEAD_QUEUE);
  });

  it("reintenta con esperas crecientes en vez de golpear la tienda seguido", () => {
    const cola = SALES_QUEUE_SPECS.find((q) => q.name === SALES_ORDER_QUEUE);
    expect(cola?.retryBackoff).toBe(true);
    expect(cola?.retryLimit).toBeGreaterThan(0);
  });

  it("los casos que esperan a una persona se guardan un mes, no dos semanas", () => {
    // Son justamente lo que la cola existe para no perder: el default de
    // catorce días los borraría antes de que alguien los mire.
    const muertos = SALES_QUEUE_SPECS.find(
      (q) => q.name === SALES_ORDER_DEAD_QUEUE,
    );
    expect(muertos?.retentionDays).toBe(30);
    expect(muertos?.deadLetter).toBeUndefined();
  });
});
