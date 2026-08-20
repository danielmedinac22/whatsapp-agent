import { describe, expect, it } from "vitest";
import { decidePanelOperation } from "@wa/db";
import type { Operation } from "@wa/db";
import { panelOperationId } from "./panel";

/**
 * La regla del selector: sobre qué operación trabaja el panel.
 *
 * Los uuid son inventados a propósito. El de producción
 * (`63937b3d-…`) no aparece en ninguna prueba porque la operación se resuelve
 * por lo que el panel eligió y por la tabla, nunca por un id escrito a mano —
 * una prueba que dependiera de ese uuid pasaría a mentir el día que la base
 * cambie.
 */
const GUATEMALA_ID = "11111111-1111-4111-8111-111111111111";
const COLOMBIA_ID = "22222222-2222-4222-8222-222222222222";
const BORRADA_ID = "33333333-3333-4333-8333-333333333333";

function operacion(over: Partial<Operation> & Pick<Operation, "id">): Operation {
  return {
    name: "Guatemala",
    countryCode: "GT",
    currency: "GTQ",
    status: "active",
    capiDatasetId: null,
    // Columna de la `0029`, por lo mismo que la de arriba: la fila la tiene.
    metaAdAccountId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  } as Operation;
}

const guatemala = operacion({ id: GUATEMALA_ID });
const colombia = operacion({
  id: COLOMBIA_ID,
  name: "Colombia",
  countryCode: "CO",
  currency: "COP",
});
const colombiaDormida = operacion({ ...colombia, status: "inactive" });

describe("con una sola operación activa, el panel se comporta como antes del selector", () => {
  it("sin elección resuelve la única activa, que es lo que mantiene Guatemala igual", () => {
    expect(
      decidePanelOperation({ requested: null, operations: [guatemala] }),
    ).toEqual({ operation: guatemala, reason: "unica_activa" });
  });

  it("una elección vacía se trata como no haber elegido, no como una elección inválida", () => {
    expect(
      decidePanelOperation({ requested: "   ", operations: [guatemala] }),
    ).toEqual({ operation: guatemala, reason: "unica_activa" });
  });

  it("elegir la única que hay devuelve esa misma, y consta que fue elegida", () => {
    expect(
      decidePanelOperation({
        requested: GUATEMALA_ID,
        operations: [guatemala],
      }),
    ).toEqual({ operation: guatemala, reason: "elegida" });
  });

  it("una operación dormida no cambia el puente: sigue resolviendo la que opera", () => {
    expect(
      decidePanelOperation({
        requested: null,
        operations: [guatemala, colombiaDormida],
      }),
    ).toEqual({ operation: guatemala, reason: "unica_activa" });
  });
});

describe("con dos operaciones, el panel tiene que decir sobre cuál trabaja", () => {
  const dos = [guatemala, colombia];

  it("cada elección resuelve la suya y no la primera de la lista", () => {
    expect(
      decidePanelOperation({ requested: COLOMBIA_ID, operations: dos })
        .operation,
    ).toBe(colombia);
    expect(
      decidePanelOperation({ requested: GUATEMALA_ID, operations: dos })
        .operation,
    ).toBe(guatemala);
  });

  it("sin elección no adivina: se queda sin operación en vez de elegir un país", () => {
    // Elegir en silencio es el error que toda esta migración existe para hacer
    // imposible: un pedido colombiano confirmado contra la logística de
    // Guatemala. Quien llama convierte esto en un error visible.
    expect(decidePanelOperation({ requested: null, operations: dos })).toEqual({
      operation: null,
      reason: "unica_activa",
    });
  });
});

describe("una elección que ya no existe no puede dejar el panel muerto", () => {
  it("con una sola operación cae al puente en vez de fallar", () => {
    // Una cookie de hace un mes que nombra una operación dada de baja. Caer al
    // puente no puede equivocarse de país: hay uno solo.
    expect(
      decidePanelOperation({
        requested: BORRADA_ID,
        operations: [guatemala],
      }),
    ).toEqual({ operation: guatemala, reason: "eleccion_desconocida" });
  });

  it("con dos operaciones no cae en ninguna: la elección desconocida no se adivina", () => {
    expect(
      decidePanelOperation({
        requested: BORRADA_ID,
        operations: [guatemala, colombia],
      }),
    ).toEqual({ operation: null, reason: "eleccion_desconocida" });
  });
});

describe("se puede trabajar sobre una operación que todavía no opera", () => {
  it("elegir la dormida la devuelve: configurar Colombia antes de activarla es el trabajo", () => {
    expect(
      decidePanelOperation({
        requested: COLOMBIA_ID,
        operations: [guatemala, colombiaDormida],
      }),
    ).toEqual({ operation: colombiaDormida, reason: "elegida" });
  });

  it("pero nunca se cae en una dormida sin elegirla", () => {
    // Sin ninguna activa no hay puente: el panel falla en vez de servir la
    // configuración de un país que no atiende como si fuera el que atiende.
    expect(
      decidePanelOperation({
        requested: null,
        operations: [colombiaDormida],
      }),
    ).toEqual({ operation: null, reason: "unica_activa" });
  });
});

describe("cómo llega la elección desde el panel al worker", () => {
  const conHeader = (valor: string | undefined) => ({
    req: { header: (n: string) => (n === "x-operation-id" ? valor : undefined) },
  });

  it("el header trae el id que eligió el admin", () => {
    expect(panelOperationId(conHeader(COLOMBIA_ID))).toBe(COLOMBIA_ID);
  });

  it("sin header no hay elección, que es distinto de una elección vacía", () => {
    expect(panelOperationId(conHeader(undefined))).toBeNull();
  });

  it("un header en blanco no viaja como elección", () => {
    expect(panelOperationId(conHeader("  "))).toBeNull();
  });
});
